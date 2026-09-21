import asyncio
from contextlib import asynccontextmanager, suppress
import fcntl
import hashlib
import html
import hmac
import json
import logging
from pathlib import Path
import secrets
import shutil
import time
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings
from .store import Store
from .media import probe, extract
from .prompting import render_prompt
from typing import Literal

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / 'static'
BUSY = {'queued', 'extracting'}

class PlayerProfile(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    rank: Literal['Unranked', 'Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant', 'Immortal', 'Radiant']
    division: int = Field(ge=1, le=3, default=1)
    dpi: int = Field(ge=50, le=64000)
    sensitivity: float = Field(gt=0, le=20)
    width: int = Field(ge=320, le=7680)
    height: int = Field(ge=240, le=4320)
    refresh_hz: int = Field(ge=30, le=1000)
    fps_limit: int = Field(ge=0, le=2000)
    vsync: bool
    display_mode: Literal['fullscreen', 'borderless', 'windowed']
    graphics: str = Field(min_length=1, max_length=1000)

class ExtractInput(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    player_profile: PlayerProfile
    context: str = Field(default='', max_length=6000)
    start: float = Field(default=0, ge=0)
    duration: float = Field(default=20, ge=1, le=120)
    fps: float = Field(default=2)

    @field_validator('fps')
    @classmethod
    def valid_fps(cls, value):
        if value not in (0.5, 1, 2, 5):
            raise ValueError('fps must be 0.5, 1, 2, or 5')
        return value

class ShareInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    selected: list[str] = Field(min_length=1, max_length=300)
    hours: int = Field(default=24, ge=1, le=168)

class LoginInput(BaseModel):
    token: str = Field(max_length=256)

def create_app(settings=None):
    settings = settings or Settings()
    settings.data_dir = settings.data_dir.resolve()

    def session_cookie():
        expiry = str(int(time.time()) + 12 * 3600)
        signature = hmac.new(settings.token.encode(), expiry.encode(), hashlib.sha256).hexdigest()
        return f'{expiry}.{signature}'

    def authenticated(request):
        value = request.cookies.get('frame_session', '')
        try:
            expiry, signature = value.split('.', 1)
            expected = hmac.new(settings.token.encode(), expiry.encode(), hashlib.sha256).hexdigest()
            return int(expiry) > time.time() and hmac.compare_digest(signature, expected)
        except (ValueError, TypeError):
            return False

    async def worker():
        while True:
            jobs = [s for s in app.state.store.all()[::-1] if s['status'] == 'queued']
            if not jobs:
                await asyncio.sleep(0.3)
                continue
            session = jobs[0]
            sid = session['id']
            app.state.store.update(sid, status='extracting', error=None)
            try:
                frames = await extract(settings.data_dir / sid, session['extraction'])
                app.state.store.update(sid, status='ready', frames=frames)
            except asyncio.CancelledError:
                app.state.store.update(sid, status='failed', error='サーバー停止で中断しました。再実行できます。')
                raise
            except Exception as exc:
                log.warning('Job %s failed: %s', sid, type(exc).__name__)
                message = 'フレーム抽出に失敗しました。区間や動画形式を確認してください。'
                if isinstance(exc, asyncio.TimeoutError):
                    message = '処理が制限時間を超えました。短い区間で再実行してください。'
                app.state.store.update(sid, status='failed', error=message)

    @asynccontextmanager
    async def lifespan(app):
        if settings.public_base_url:
            from urllib.parse import urlsplit
            u = urlsplit(settings.public_base_url)
            if u.scheme not in ('http', 'https') or not u.netloc or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
                raise RuntimeError('PUBLIC_BASE_URLはパスやキーを含まないhttp(s)のoriginにしてください。')
        if len(settings.token) < 16:
            raise RuntimeError('APP_TOKEN に16文字以上のランダムな値を設定してください。')
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        lock = (settings.data_dir / 'worker.lock').open('a')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise RuntimeError('同じDATA_DIRでの多重起動は禁止です。--workers 1で起動してください。')
        app.state.store = Store(settings.data_dir / 'sessions.sqlite3')
        for item in app.state.store.all():
            if item['status'] == 'extracting':
                app.state.store.update(item['id'], status='failed', error='前回の処理が中断されました。再実行してください。')
        for partial in settings.data_dir.glob('*.upload'):
            partial.unlink(missing_ok=True)
        app.state.upload_lock = asyncio.Lock()
        app.state.login_failures = []
        task = asyncio.create_task(worker())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            lock.close()

    app = FastAPI(title='Valostudy', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def security(request, call_next):
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            origin = request.headers.get('origin')
            # Browser mutations must come from this origin. CLI clients may omit Origin.
            if origin and origin != str(request.base_url).rstrip('/'):
                return JSONResponse({'detail': '別のオリジンからの操作は許可されていません。'}, status_code=403)
            if request.headers.get('sec-fetch-site') == 'cross-site':
                return JSONResponse({'detail': 'Cross-site request rejected'}, status_code=403)
            length = request.headers.get('content-length')
            try:
                limit = settings.max_upload if request.url.path == '/api/uploads' else 65536
                if length and (int(length) < 0 or int(length) > limit):
                    return JSONResponse({'detail': 'リクエストが大きすぎます。'}, status_code=413)
            except ValueError:
                return JSONResponse({'detail': 'Invalid Content-Length'}, status_code=400)
        if request.url.path.startswith('/api/') and request.url.path not in ('/api/login', '/api/health') and not authenticated(request):
            return JSONResponse({'detail': 'ログインしてください。'}, status_code=401)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

    def get_session(sid):
        try:
            if str(UUID(sid)) != sid:
                raise ValueError()
        except ValueError:
            raise HTTPException(404, 'セッションが見つかりません。')
        result = app.state.store.get(sid)
        if result is None:
            raise HTTPException(404, 'セッションが見つかりません。')
        return result

    def require_idle(session):
        if session['status'] in BUSY:
            raise HTTPException(409, 'このセッションは処理中です。')

    @app.get('/api/health')
    async def health():
        return {'ok': True}

    @app.post('/api/login')
    async def login(body: LoginInput):
        now = time.time()
        app.state.login_failures = [t for t in app.state.login_failures if now - t < 60]
        if len(app.state.login_failures) >= 10:
            raise HTTPException(429, '試行回数が多すぎます。1分後に再試行してください。')
        if not secrets.compare_digest(body.token.encode(), settings.token.encode()):
            app.state.login_failures.append(now)
            raise HTTPException(401, 'アクセストークンが違います。')
        response = JSONResponse({'ok': True})
        response.set_cookie('frame_session', session_cookie(), httponly=True, samesite='strict', secure=settings.secure_cookie, max_age=43200)
        return response

    @app.post('/api/logout')
    async def logout():
        response = JSONResponse({'ok': True})
        response.delete_cookie('frame_session')
        return response

    @app.get('/api/config')
    async def config():
        return {'max_upload_mb': settings.max_upload // (1024 * 1024), 'max_frames': 300, 'max_review_frames': 300,
                'ffmpeg_available': bool(shutil.which('ffmpeg') and shutil.which('ffprobe'))}

    @app.get('/api/sessions')
    async def sessions():
        return [{k: v for k, v in s.items() if k not in ('result', 'context', 'selected', 'frames')} | {'frame_count': len(s['frames'])} for s in app.state.store.all()]

    @app.get('/api/sessions/{sid}')
    async def session(sid: str):
        return get_session(sid)

    @app.post('/api/uploads', status_code=201)
    async def upload(request: Request, name: str = 'recording.mp4'):
        if not shutil.which('ffprobe'):
            raise HTTPException(503, 'サーバーにFFmpegをインストールしてください。')
        # Serialize uploads to make disk reservations and probing predictable.
        if app.state.upload_lock.locked():
            raise HTTPException(429, '別の動画を受信中です。完了後に再試行してください。')
        async with app.state.upload_lock:
            name = Path(name.replace('\\', '/')).name[:160]
            if Path(name).suffix.lower() not in ('.mp4', '.mkv', '.mov', '.webm', '.avi'):
                raise HTTPException(415, 'MP4 / MKV / MOV / WebM / AVIを選んでください。')
            sid = str(uuid4())
            partial = settings.data_dir / f'{sid}.upload'
            size = 0
            try:
                async with asyncio.timeout(1800):
                    with partial.open('xb') as out:
                        async for chunk in request.stream():
                            size += len(chunk)
                            if size > settings.max_upload:
                                raise HTTPException(413, '動画がアップロード上限を超えています。')
                            if shutil.disk_usage(settings.data_dir).free < settings.min_free + len(chunk):
                                raise HTTPException(507, 'サーバーの空き容量が不足しています。')
                            await asyncio.to_thread(out.write, chunk)
                if size == 0:
                    raise HTTPException(400, '動画が空です。')
                try:
                    metadata = await probe(partial)
                except (ValueError, RuntimeError, asyncio.TimeoutError, KeyError, IndexError):
                    raise HTTPException(415, '動画を読み込めません。対応形式・4K相当以下・8時間以内を確認してください。')
                directory = settings.data_dir / sid
                directory.mkdir()
                partial.replace(directory / 'source')
                return app.state.store.create(dict(id=sid, name=name, size=size, **metadata, status='uploaded', frames=[], selected=[], context='', extraction=None, result=None, error=None))
            except asyncio.TimeoutError:
                raise HTTPException(408, 'アップロードがタイムアウトしました。')
            finally:
                partial.unlink(missing_ok=True)

    @app.post('/api/sessions/{sid}/extract', status_code=202)
    async def start_extract(sid: str, body: ExtractInput):
        s = get_session(sid)
        require_idle(s)
        if not shutil.which('ffmpeg'):
            raise HTTPException(503, 'FFmpegが見つかりません。')
        if body.duration * body.fps > 300 or body.start + body.duration > s['duration'] + 0.01:
            raise HTTPException(422, '動画内の区間かつ300枚以下になる設定にしてください。')
        if shutil.disk_usage(settings.data_dir).free < settings.min_free:
            raise HTTPException(507, '抽出用の空き容量が不足しています。')
        app.state.store.revoke_for_session(sid)
        profile = body.player_profile.model_dump()
        profile['edpi'] = round(profile['dpi'] * profile['sensitivity'], 3)
        extraction = body.model_dump(exclude={'player_profile', 'context'})
        return app.state.store.update(sid, status='queued', extraction=extraction, player_profile=profile, context=body.context, frames=[], selected=[], result=None, error=None)

    @app.get('/api/sessions/{sid}/frames/{name}')
    async def frame(sid: str, name: str):
        s = get_session(sid)
        if name not in {f['name'] for f in s['frames']}:
            raise HTTPException(404, '画像が見つかりません。')
        return FileResponse(settings.data_dir / sid / 'frames' / name, media_type='image/jpeg')

    @app.get('/api/sessions/{sid}/video')
    async def video(sid: str):
        s = get_session(sid)
        mime = {'.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo'}[Path(s['name']).suffix.lower()]
        return FileResponse(settings.data_dir / sid / 'source', media_type=mime)

    @app.delete('/api/sessions/{sid}')
    async def delete(sid: str):
        s = get_session(sid)
        require_idle(s)
        shutil.rmtree(settings.data_dir / sid, ignore_errors=False)
        app.state.store.revoke_for_session(sid)
        app.state.store.delete(sid)
        return {'ok': True}

    @app.get('/api/sessions/{sid}/shares')
    async def shares(sid: str):
        get_session(sid)
        return app.state.store.shares(sid)

    @app.post('/api/sessions/{sid}/shares', status_code=201)
    async def create_share(sid: str, body: ShareInput, request: Request):
        s = get_session(sid)
        require_idle(s)
        available = {f['name'] for f in s['frames']}
        if len(set(body.selected)) != len(body.selected) or not set(body.selected) <= available:
            raise HTTPException(422, 'このセッションにある画像を重複なく選択してください。')
        if sum(not r['revoked'] and r['expires'] > time.time() for r in app.state.store.shares(sid)) >= 20:
            raise HTTPException(409, 'このセッションのURLが20件あります。不要なURLを無効化してください。')
        share_id, key = str(uuid4()), secrets.token_urlsafe(32)
        selected = set(body.selected)
        frames = [f for f in s['frames'] if f['name'] in selected]
        app.state.store.create_share(dict(id=share_id, session_id=sid, key_hash=hashlib.sha256(key.encode()).hexdigest(),
            expires=time.time() + body.hours * 3600, context=s['context'], player_profile=s['player_profile'], extraction=s['extraction'],
            prompt=render_prompt(s['player_profile'], s['context'], s['extraction']), frames=frames, revoked=False))
        app.state.store.update(sid, selected=body.selected)
        base = (settings.public_base_url or str(request.base_url)).rstrip('/')
        url = f'{base}/review/{share_id}?key={key}'
        manifest = f'{base}/review/{share_id}/manifest?key={key}'
        prompt = ('以下のValostudy識別URLを直接取得し、ページに掲載された「必須コーチングプロンプト」を読んで順番どおり実行してください。'
            'Redditのコミュニティ議論の本文を調査する前にコーチングを開始しないでください。'
            'ページにはプレイヤー設定・画像一覧・JSONマニフェストがあります。必要な画像をダウンロードして実際に確認してください。'
            'URLは認証キーを含むため外部検索に送らず、ネットワークアクセスが許可された環境で直接取得してください。\n' + url)
        return {'id': share_id, 'url': url, 'manifest_url': manifest, 'prompt': prompt}

    @app.delete('/api/shares/{share_id}')
    async def revoke(share_id: str):
        if not app.state.store.share(share_id):
            raise HTTPException(404, 'URLが見つかりません。')
        app.state.store.revoke(share_id)
        return {'ok': True}

    def authorized_share(share_id, key):
        share = app.state.store.share(share_id)
        if not share or share['revoked'] or share['expires'] <= time.time() or not secrets.compare_digest(
            share['key_hash'], hashlib.sha256(key.encode()).hexdigest()):
            raise HTTPException(404, 'URLが無効、または期限切れです。')
        return share

    @app.get('/review/{share_id}/manifest')
    async def manifest(share_id: str, request: Request, key: str = ''):
        share = authorized_share(share_id, key)
        base = (settings.public_base_url or str(request.base_url)).rstrip('/')
        return JSONResponse({'schema_version': 1, 'id': share_id, 'context': share['context'], 'player_profile': share['player_profile'],
            'extraction': share['extraction'], 'coaching_prompt': share['prompt'], 'prompt_template_version': 1,
            'expires_at': share['expires'], 'time_note': 'approx_secondsは元動画内の時刻の目安です。fps抽出の丸めを含みます。',
            'frames': [{'index': i + 1, 'name': f['name'], 'approx_seconds': f['time'],
                'url': f"{base}/review/{share_id}/frames/{f['name']}?key={key}"} for i, f in enumerate(share['frames'])]},
            headers={'Cache-Control': 'no-store'})

    @app.get('/review/{share_id}/frames/{name}')
    async def shared_frame(share_id: str, name: str, key: str = ''):
        share = authorized_share(share_id, key)
        if name not in {f['name'] for f in share['frames']}:
            raise HTTPException(404, '画像が見つかりません。')
        return FileResponse(settings.data_dir / share['session_id'] / 'frames' / name, media_type='image/jpeg',
            headers={'Cache-Control': 'no-store'})

    @app.get('/review/{share_id}', response_class=HTMLResponse)
    async def review_page(share_id: str, key: str = ''):
        share = authorized_share(share_id, key)
        escaped_key = html.escape(key, quote=True)
        profile_html = ''.join(f'<tr><th scope="row">{html.escape(str(k))}</th><td>{html.escape(str(v))}</td></tr>' for k, v in share['player_profile'].items())
        frame_html = ''.join(f'<figure><a href="/review/{share_id}/frames/{f["name"]}?key={escaped_key}"><img loading="lazy" src="/review/{share_id}/frames/{f["name"]}?key={escaped_key}" alt="Frame {i+1}, approx {f["time"]} seconds"></a><figcaption>Frame {i+1} · {f["time"]:.2f}s（目安）</figcaption></figure>' for i, f in enumerate(share['frames']))
        return HTMLResponse('<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Valostudy — レビュー用フレーム</title><link rel="stylesheet" href="/style.css"></head><body><main class="shared"><div class="eyebrow">VALOSTUDY / REVIEW SESSION</div><h1>レビュー用フレーム</h1><p>画像と状況メモを共有する期限付きページです。音声は含まれません。</p>'
            + f'<a class="button" href="/review/{share_id}/manifest?key={escaped_key}">JSONマニフェスト</a><h2>プレイヤー設定</h2><table class="profile-table"><tbody>{profile_html}</tbody></table><h2>必須コーチングプロンプト</h2><p>コーチング前にRedditの議論を調査してください。以下はテンプレートに実際の設定を埋め込んだプロンプトです。</p><pre class="review-prompt">{html.escape(share["prompt"])}</pre><div class="shared-grid">{frame_html}</div></main></body></html>', headers={'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'})

    app.mount('/', StaticFiles(directory=STATIC, html=True), name='web')
    return app

app = create_app()
