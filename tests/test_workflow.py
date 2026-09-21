import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app

TOKEN = 'test-only-token-not-for-deployment'
PROFILE = dict(rank='Diamond', division=2, dpi=1600, sensitivity=0.1, width=1920, height=1080,
               refresh_hz=280, fps_limit=0, vsync=False, display_mode='fullscreen', graphics='全低 / Reflex ON')

@pytest.fixture(scope='session')
def video(tmp_path_factory):
    if not shutil.which('ffmpeg'):
        pytest.fail('FFmpeg is required for integration tests')
    path = tmp_path_factory.mktemp('video') / 'fixture.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
                    '-t', '3', '-c:v', 'mpeg4', str(path)], check=True)
    return path.read_bytes()

@pytest.fixture
def client(tmp_path):
    settings = Settings(data_dir=tmp_path, token=TOKEN, allowed_hosts=['testserver'], min_free=0)
    with TestClient(create_app(settings)) as c:
        assert c.post('/api/login', json={'token': TOKEN}).status_code == 200
        yield c

def upload(client, video):
    r = client.post('/api/uploads?name=match.mp4', content=video)
    assert r.status_code == 201, r.text
    return r.json()['id']

def extract(client, sid, **extra):
    r = client.post(f'/api/sessions/{sid}/extract', json=dict(start=0, duration=2, fps=2, player_profile=PROFILE,
                    context='クローヴ / 攻め。味方の報告あり。<script>alert(1)</script>', **extra))
    assert r.status_code == 202, r.text
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        s = client.get(f'/api/sessions/{sid}').json()
        if s['status'] not in ('queued', 'extracting'):
            assert s['status'] == 'ready', s
            return s
        time.sleep(.05)
    pytest.fail('Extraction did not finish')

def share(client, sid, names):
    r = client.post(f'/api/sessions/{sid}/shares', json={'selected': names, 'hours': 1})
    assert r.status_code == 201, r.text
    return r.json()

def test_real_video_profile_prompt_and_scoped_share(client, video):
    sid = upload(client, video)
    s = extract(client, sid)
    assert len(s['frames']) == 4
    assert s['player_profile']['edpi'] == 160
    assert [f['time'] for f in s['frames']] == [0, .5, 1, 1.5]
    selected = s['frames'][1]['name']
    link = share(client, sid, [selected])
    # Unauthenticated consumers can only see the capability-scoped data.
    client.post('/api/logout')
    assert client.get(f'/api/sessions/{sid}').status_code == 401
    assert client.get(f'/api/sessions/{sid}/video').status_code == 401
    m = client.get(link['manifest_url'])
    assert m.status_code == 200
    manifest = m.json()
    assert manifest['player_profile'] == PROFILE | {'edpi': 160}
    assert manifest['coaching_prompt'].count('Reddit') >= 3
    assert 'コーチング前にRedditを必ずリサーチする' in manifest['coaching_prompt']
    assert '1600' in manifest['coaching_prompt'] and 'Diamond' in manifest['coaching_prompt']
    assert '{profile_json}' not in manifest['coaching_prompt']
    assert len(manifest['frames']) == 1
    image = client.get(manifest['frames'][0]['url'])
    assert image.status_code == 200 and image.content[:2] == b'\xff\xd8'
    assert image.headers['cache-control'] == 'no-store'
    missing = manifest['frames'][0]['url'].replace(selected, s['frames'][0]['name'])
    assert client.get(missing).status_code == 404
    page = client.get(link['url'])
    assert page.status_code == 200 and '必須コーチングプロンプト' in page.text
    assert '<script>alert(1)</script>' not in page.text
    assert '&lt;script&gt;' in page.text
    assert client.get(link['url'].split('?')[0]).status_code == 404
    assert client.get(link['url'] + 'badkey').status_code == 404
    client.post('/api/login', json={'token': TOKEN})
    assert client.delete('/api/shares/' + link['id']).status_code == 200
    assert client.get(link['url']).status_code == 404
    assert client.get(manifest['frames'][0]['url']).status_code == 404

def test_required_profile_and_limits(client, video):
    sid = upload(client, video)
    route = f'/api/sessions/{sid}/extract'
    assert client.post(route, json={'start':0,'duration':2,'fps':2}).status_code == 422
    for profile in [dict(PROFILE, dpi=0), dict(PROFILE, sensitivity=-1), dict(PROFILE, graphics=''), dict(PROFILE, rank='made-up')]:
        assert client.post(route, json={'start':0,'duration':2,'fps':2,'player_profile':profile}).status_code == 422
    for start,duration,fps in [(0,120,5),(2,2,2),(0,2,30),(-1,2,2)]:
        assert client.post(route,json=dict(start=start,duration=duration,fps=fps,player_profile=PROFILE)).status_code==422
    assert client.post('/api/uploads?name=x.mp4',content=b'bad media').status_code==415
    assert client.post('/api/uploads?name=x.m3u8',content=b'#EXTM3U').status_code==415
    assert client.post('/api/uploads?name=x.mp4',content=b'').status_code==400

def test_expiry_reextract_and_session_separation(client, video):
    a = upload(client, video)
    b = upload(client, video)
    s = extract(client, a)
    link = share(client, a, [s['frames'][0]['name']])
    assert client.post(f'/api/sessions/{b}/shares',json={'selected':[s['frames'][0]['name']]}).status_code==422
    # Expire in the persistent store; all read paths must enforce expiry.
    store=client.app.state.store
    with store.connection() as db:
        import json
        data=store.share(link['id']);data['expires']=time.time()-1
        db.execute('UPDATE shares SET body=? WHERE id=?',(json.dumps(data),link['id']))
    assert client.get(link['url']).status_code==404
    assert client.get(link['manifest_url']).status_code==404
    live=share(client,a,[s['frames'][0]['name']])
    extract(client,a)
    assert client.get(live['url']).status_code==404
    assert client.delete(f'/api/sessions/{a}').status_code==200
    assert client.get(f'/api/sessions/{a}').status_code==404
    assert client.get(f'/api/sessions/{b}').status_code==200

def test_auth_origin_and_host(client):
    assert client.post('/api/login',json={'token':'wrong'}).status_code==401
    assert client.post('/api/logout',headers={'Origin':'https://evil.example'}).status_code==403
    assert client.get('/api/config',headers={'Host':'evil.example'}).status_code==400
    assert client.get('/api/config').status_code==200
    client.post('/api/logout')
    assert client.get('/api/config').status_code==401
    assert client.get('/').status_code==200

def test_upload_size_limit(tmp_path):
    settings=Settings(data_dir=tmp_path,token=TOKEN,allowed_hosts=['testserver'],max_upload=8,min_free=0)
    with TestClient(create_app(settings)) as c:
        c.post('/api/login',json={'token':TOKEN})
        assert c.post('/api/uploads?name=large.mp4',content=b'a'*9).status_code==413
        # No Content-Length: streamed limit is still enforced and partial file cleaned.
        assert c.post('/api/uploads?name=large.mp4',content=iter([b'a'*5,b'b'*5])).status_code==413
        assert not list(tmp_path.glob('*.upload'))

def test_persistence_and_interrupted_job_recovery(tmp_path, video):
    settings=Settings(data_dir=tmp_path,token=TOKEN,allowed_hosts=['testserver'],min_free=0)
    with TestClient(create_app(settings)) as c:
        c.post('/api/login',json={'token':TOKEN})
        sid=upload(c,video)
        s=extract(c,sid)
        link=share(c,sid,[s['frames'][0]['name']])
    with TestClient(create_app(settings)) as c:
        assert c.get(link['manifest_url']).json()['player_profile']['edpi']==160
        c.post('/api/login',json={'token':TOKEN})
        assert c.get(f'/api/sessions/{sid}').json()['status']=='ready'
        c.app.state.store.update(sid,status='extracting')
    with TestClient(create_app(settings)) as c:
        c.post('/api/login',json={'token':TOKEN})
        assert c.get(f'/api/sessions/{sid}').json()['status']=='failed'
