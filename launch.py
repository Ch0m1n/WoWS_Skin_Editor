"""Version-aware launcher; existing work is never stopped to open a new build."""
import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path
from app_version import VERSION,BUILD_ID,ROOT

def health(port):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1) as response:return json.load(response)
    except (OSError,ValueError):return None

def same_build(value):
    return bool(value and value.get('app')=='wows-skin-workshop' and value.get('version')==VERSION and value.get('build')==BUILD_ID and os.path.normcase(value.get('root',''))==os.path.normcase(str(ROOT)))

def choose_port(start):
    for port in range(start,start+30):
        value=health(port)
        if same_build(value):return port,True
        with socket.socket() as probe:
            try:probe.bind(('127.0.0.1',port));return port,False
            except OSError:continue
    raise RuntimeError('편집기 실행에 사용할 로컬 포트를 찾지 못했어요.')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=int(os.environ.get('WOWS_WORKSHOP_PORT','8766')));parser.add_argument('--no-browser',action='store_true');args=parser.parse_args()
    port,reuse=choose_port(args.port)
    if not reuse:
        env=os.environ.copy();env.setdefault('WOWS_WORKSHOP_CACHE',str(Path(os.environ.get('LOCALAPPDATA',str(ROOT)))/'WoWSSkinWorkshop'/'Cache'));env['PYTHONUTF8']='1'
        logs=Path(env['WOWS_WORKSHOP_CACHE']).parent;logs.mkdir(parents=True,exist_ok=True)
        with (logs/'server.log').open('ab') as log:process=subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--port',str(port)],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=log,creationflags=0x08000000 if os.name=='nt' else 0)
        try:(ROOT/'workshop.pid').write_text(str(process.pid))
        except OSError:pass
        for _ in range(60):
            if same_build(health(port)):break
            if process.poll() is not None:raise RuntimeError(f'서버 시작 실패: {logs/"server.log"}')
            time.sleep(.2)
        else:raise RuntimeError('서버 시작 시간이 초과됐어요.')
    url=f'http://127.0.0.1:{port}';print(f'WoWS Skin Editor {VERSION}: {url}')
    if not args.no_browser:webbrowser.open(url)

if __name__=='__main__':main()
