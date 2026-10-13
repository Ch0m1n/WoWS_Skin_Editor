"""Portable entry point; the release includes its own CPython and Pillow."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

root = Path(__file__).resolve().parent
port = int(os.environ.get('WOWS_WORKSHOP_PORT', '8766'))
url = f'http://127.0.0.1:{port}'
def ready():
    try:
        with urllib.request.urlopen(url + '/api/health', timeout=1) as response:
            return json.load(response).get('app') == 'wows-skin-workshop'
    except (OSError, ValueError): return False

if not ready():
    env = os.environ.copy()
    env.setdefault('WOWS_WORKSHOP_CACHE', str(Path(os.environ.get('LOCALAPPDATA', str(root))) / 'WoWSSkinWorkshop' / 'Cache'))
    env['PYTHONUTF8'] = '1'
    logs = Path(env['WOWS_WORKSHOP_CACHE']).parent
    logs.mkdir(parents=True, exist_ok=True)
    with (logs / 'server.log').open('ab') as log:
        process = subprocess.Popen([sys.executable, str(root / 'server.py'), '--port', str(port)], cwd=root,
            env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=0x08000000 if os.name == 'nt' else 0)
    for _ in range(60):
        if ready(): break
        if process.poll() is not None: raise SystemExit(f'서버를 시작하지 못했어요. {logs / "server.log"}를 확인하세요.')
        time.sleep(.2)
    else: raise SystemExit('서버 시작 시간이 초과됐어요.')
webbrowser.open(url)
