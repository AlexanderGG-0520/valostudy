import asyncio
import json
import math
import os
from pathlib import Path
import signal

# Only self-contained video containers; never HLS, concat, or arbitrary URLs.
INPUT_OPTIONS = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi', '-probesize', '10000000', '-analyzeduration', '10000000']

async def run_process(args, *, timeout, cwd=None, stdin=None, output=None):
    with open(os.devnull, 'wb') as null:
        proc = await asyncio.create_subprocess_exec(
            *args, cwd=cwd, stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=output if output is not None else asyncio.subprocess.PIPE,
            stderr=null, start_new_session=True,
        )
        try:
            out, _ = await asyncio.wait_for(proc.communicate(stdin), timeout)
            if proc.returncode != 0:
                raise RuntimeError(f'{Path(args[0]).name} が終了コード {proc.returncode} で失敗しました。')
            return out or b''
        except BaseException:
            if proc.returncode is None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await proc.wait()
            raise

async def probe(path):
    data = await run_process(['ffprobe', '-v', 'error', *INPUT_OPTIONS,
        '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
        '-of', 'json', str(path)], timeout=30)
    result = json.loads(data)
    stream = result.get('streams', [{}])[0]
    duration = float(result.get('format', {}).get('duration', 0))
    w, h = stream.get('width', 0), stream.get('height', 0)
    if not math.isfinite(duration) or not 0 < duration <= 8 * 3600 or not 0 < w * h <= 3840 * 2160:
        raise ValueError('8時間以内・4K相当以下の動画を選んでください。')
    return dict(duration=duration, width=w, height=h)

async def extract(directory, settings):
    directory = Path(directory)
    frames = directory / 'frames'
    frames.mkdir(exist_ok=True)
    for path in frames.glob('frame_*.jpg'):
        path.unlink()
    with open(os.devnull, 'wb') as null:
        await run_process(['ffmpeg', '-nostdin', '-v', 'error', '-threads', '2', *INPUT_OPTIONS,
            '-ss', str(settings['start']), '-i', str(directory / 'source'),
            '-t', str(settings['duration']), '-map', '0:v:0', '-an', '-sn', '-dn',
            '-vf', f"fps={settings['fps']},scale=w='min(1920,iw)':h=-2",
            '-threads', '2', '-frames:v', '300', '-q:v', '2', '-n', str(frames / 'frame_%04d.jpg')],
            timeout=300, output=null)
    paths = sorted(frames.glob('frame_*.jpg'))
    if not paths:
        raise ValueError('この区間からフレームを抽出できませんでした。開始時刻を確認してください。')
    return [{'name': p.name, 'time': round(settings['start'] + i / settings['fps'], 3)} for i, p in enumerate(paths)]
