"""Standalone installed-game discovery and on-demand extraction. No Toolbox install needed."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import queue
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT / 'engine' / 'Backend'
CACHE = Path(os.environ.get('WOWS_WORKSHOP_CACHE', ROOT / '.cache'))
GAMES = {}
JOBS = {}
JOB_PROCESSES = {}
LOCK = threading.RLock()
INDEX_LOCK = threading.RLock()
EXTRACTION_QUEUE = queue.Queue()
EXTRACTION_WORKER = None
sys.path.insert(0, str(ENGINE))

def install_info(folder):
    folder = Path(folder).expanduser().resolve()
    if not (folder / 'res_packages').is_dir() or not (folder / 'bin').is_dir():
        return None
    from game_archive import latest_build
    try:
        build, _ = latest_build(folder)
    except OSError:
        return None
    key = hashlib.sha256(str(folder).encode()).hexdigest()[:16]
    GAMES.setdefault(key, {'id': key, 'folder': str(folder), 'build': build, 'name': folder.name})
    if GAMES[key]['build'] != build:
        GAMES[key] = {'id': key, 'folder': str(folder), 'build': build, 'name': folder.name}
    return {k: GAMES[key][k] for k in ('id','folder','build','name')}

def discover_games():
    candidates = [os.environ.get('WOWS_GAME_DIR', '')]
    # Bounded common paths, plus registered installs and Steam library roots.
    for drive in 'CDEFGHIJKLMNOPQRSTUVWXYZ':
        for parent in ('Games', 'Games/Wargaming', 'Program Files (x86)/Steam/steamapps/common', 'SteamLibrary/steamapps/common', ''):
            for name in ('World_of_Warships', 'World of Warships'):
                candidates.append(f'{drive}:/{parent}/{name}')
    if os.name == 'nt':
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for branch in (r'Software\Microsoft\Windows\CurrentVersion\Uninstall', r'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'):
                try:
                    with winreg.OpenKey(hive, branch) as key:
                        for i in range(winreg.QueryInfoKey(key)[0]):
                            try:
                                with winreg.OpenKey(key, winreg.EnumKey(key, i)) as item:
                                    name = winreg.QueryValueEx(item, 'DisplayName')[0]
                                    if 'warships' in name.lower(): candidates.append(winreg.QueryValueEx(item, 'InstallLocation')[0])
                            except OSError: pass
                except OSError: pass
        for steam in (Path('C:/Program Files (x86)/Steam'), Path('C:/Program Files/Steam')):
            vdf = steam / 'steamapps/libraryfolders.vdf'
            if vdf.is_file():
                for path in re.findall(r'"path"\s+"([^"]+)"', vdf.read_text(errors='replace')):
                    candidates.append(str(Path(path.replace('\\\\', '\\')) / 'steamapps/common/World of Warships'))
    result = {}
    for candidate in candidates:
        if candidate:
            info = install_info(candidate)
            if info: result[info['id']] = info
    return list(result.values())

def game_dir(key):
    if key not in GAMES: raise ValueError('게임 설치 폴더를 먼저 선택하세요.')
    return Path(GAMES[key]['folder'])

def cache_dir(key):
    root = CACHE / key / str(GAMES[key]['build'])
    root.mkdir(parents=True, exist_ok=True)
    return root

class JobCancelled(Exception):
    pass


def stop_job_process(process):
    if process.poll() is not None: return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, creationflags=0x08000000)
    else:
        import signal
        try: os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError: pass


def cancel_job(key):
    with LOCK:
        job = JOBS.get(key)
        if not job or not job['signature'].startswith('extract:'): raise ValueError('추출 작업을 찾지 못했어요.')
        if job['status'] not in ('queued', 'running', 'cancelling'): return job['status']
        job['cancel_requested'] = True
        job.update(status='cancelled' if job['status'] == 'queued' else 'cancelling', message='함선 준비를 취소했어요.')
        process = JOB_PROCESSES.get(key)
    if process: stop_job_process(process)
    return job['status']


def start_job(signature, work, serial=False, metadata=None):
    global EXTRACTION_WORKER
    with LOCK:
        for key, job in JOBS.items():
            if job['signature'] == signature and job['status'] in ('queued', 'running', 'cancelling', 'done'): return key
        key = uuid.uuid4().hex
        JOBS[key] = {'signature': signature, 'status': 'queued' if serial else 'running', 'message': '대기열에서 기다리는 중이에요.' if serial else '준비 중', 'started': time.time(), 'percent': None, **(metadata or {})}
    def progress(message, **details):
        check_cancel()
        with LOCK:
            JOBS[key].update(message=message, **details)
    def check_cancel():
        if JOBS[key].get('cancel_requested'): raise JobCancelled()
    def set_process(process):
        with LOCK:
            if process is None: JOB_PROCESSES.pop(key, None)
            else: JOB_PROCESSES[key] = process
        if process and JOBS[key].get('cancel_requested'): stop_job_process(process)
    progress.check_cancel = check_cancel
    progress.set_process = set_process
    def run():
        try:
            with LOCK:
                check_cancel()
                JOBS[key].update(status='running', started=time.time(), message='준비 중')
            result = work(progress)
            with LOCK:
                check_cancel()
                JOBS[key].update(status='done', percent=100, result=result, seconds=round(time.time() - JOBS[key]['started'], 2))
        except Exception as error:
            with LOCK:
                JOBS[key].update(status='cancelled' if JOBS[key].get('cancel_requested') else 'error',
                                 message='함선 준비를 취소했어요.' if JOBS[key].get('cancel_requested') else str(error))
        finally:
            with LOCK: JOB_PROCESSES.pop(key, None)
    if serial:
        with LOCK:
            if EXTRACTION_WORKER is None:
                def consume():
                    while True:
                        task = EXTRACTION_QUEUE.get()
                        try: task()
                        finally: EXTRACTION_QUEUE.task_done()
                EXTRACTION_WORKER = threading.Thread(target=consume, daemon=True)
                EXTRACTION_WORKER.start()
            EXTRACTION_QUEUE.put(run)
    else: threading.Thread(target=run, daemon=True).start()
    return key

def catalog_job(key, refresh=False, language='ko'):
    if language not in ('ko','en'): raise ValueError('지원하지 않는 언어예요.')
    folder = game_dir(key); root = cache_dir(key)
    def work(progress):
        target = root / f'catalog-{language}.json'
        translation = folder / 'bin' / str(GAMES[key]['build']) / 'res/texts' / language / 'LC_MESSAGES/global.mo'
        if not translation.is_file(): raise FileNotFoundError(f'{language} global.mo 파일이 없어요. 게임의 해당 언어 리소스를 설치해주세요.')
        if target.is_file() and not refresh:
            rows = json.loads(target.read_text(encoding='utf-8'))
        else:
            progress('게임 패키지에서 함선 목록과 한국어 global.mo를 읽고 있어요.')
            from catalog import pc_catalog
            rows = pc_catalog(folder, language, 'pc', cache_root=root / 'EngineCache')
            target.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
        GAMES[key].setdefault('catalogs', {})[language] = rows
        return {'game': install_info(folder), 'ships': rows, 'language': language, 'translation': str(translation)}
    return start_job(f'catalog:{key}:{GAMES[key]["build"]}:{language}:{uuid.uuid4().hex if refresh else "cache"}', work)

def thumbnail(key, code):
    folder = game_dir(key)
    if not re.fullmatch(r'[A-Z0-9_]{4,40}', code): raise ValueError('함선 코드가 올바르지 않아요.')
    # Reading the archive works even when the player has never unpacked the game.
    target = cache_dir(key) / 'previews-v2' / (code + '.png')
    if target.is_file(): return target
    from game_archive import read_archive_index, extract_entry
    with INDEX_LOCK:
        if 'entries' not in GAMES[key]: GAMES[key]['entries'] = read_archive_index(folder)[1]
        entries = GAMES[key]['entries']
        code_lower = code.lower()
        entry = next((entries.get(f'/gui/{name}/{code_lower}.png') for name in ('ship_preview', 'ship_previews', 'ship_icons', 'ships_silhouettes', 'ship_dead_icons') if entries.get(f'/gui/{name}/{code_lower}.png')), None)
        target.parent.mkdir(parents=True, exist_ok=True)
        if entry: target.write_bytes(extract_entry(folder, entry))
        else:
            # Some event-only catalog rows have no GUI image in the installed build.
            from PIL import Image
            Image.new('RGBA', (214,126)).save(target)
    return target

def run_command(command, env, progress, measured=False):
    progress.check_cancel()
    tail = []
    with subprocess.Popen(command, cwd=ENGINE, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, encoding='utf-8', errors='replace', start_new_session=os.name != 'nt', creationflags=0x08000000 if os.name == 'nt' else 0) as process:
        progress.set_process(process)
        for line in process.stdout:
            line = line.strip(); tail.append(line); tail = tail[-8:]
            if line.startswith('[PROGRESS] ') and measured:
                try:
                    value = json.loads(line[len('[PROGRESS] '):])
                    progress(value['message'], percent=value['percent'], stage=value['stage'])
                except (ValueError, KeyError, TypeError): pass
        result = process.wait()
        progress.set_process(None)
        progress.check_cancel()
        if result: raise RuntimeError('\n'.join(tail))

def extract_job(key, code, language='ko'):
    folder = game_dir(key); root = cache_dir(key)
    rows = GAMES[key].get('catalogs', {}).get(language, [])
    row = next((r for r in rows if r['ShipCode'] == code and r.get('Supported')), None)
    if not row: raise ValueError('함선 목록에서 지원되는 함선을 선택하세요.')
    target = root / 'models' / code
    def work(progress):
        marker = target / 'ready.json'
        if marker.is_file() and (target / f'{code}.obj').is_file(): return {'folder': str(target), 'name': row['LocalizedName']}
        started = time.time()
        # Previous completed preparations provide an honest estimate on later runs.
        timings = root / 'preparation-times.json'
        try: history = json.loads(timings.read_text(encoding='utf-8'))
        except (OSError, ValueError): history = {}
        samples = [v for v in history.values() if isinstance(v, (int, float)) and v > 0]
        estimate = history.get(code) or (sorted(samples)[len(samples)//2] if samples else None)
        progress('선택한 함선의 패키지를 준비하고 있어요.', estimated_total_seconds=estimate)
        target.mkdir(parents=True, exist_ok=True)
        from compat_cache import prepare_game_params_cache
        progress('선택한 함선의 패키지를 준비하고 있어요.', stage='package', percent=None, stage_started=time.time())
        info = prepare_game_params_cache(folder, root / 'EngineCache', 'pc')
        env = os.environ.copy(); env['WOWS_GAME_PARAMS_OVERRIDE'] = str(info['game_params']); env['PYTHONUTF8'] = '1'; env['WOWS_TOOLBOX_LANGUAGE'] = language
        glb = target / f'{code}.glb'; exporter = ENGINE / 'wowsunpack.exe'
        if not glb.is_file() or glb.stat().st_size < 24:
            pending = target / f'{code}.pending.glb'
            run_command([str(exporter), '--game-dir', str(folder), 'export-ship', code, '--lod', '0',
                         *(['--hull', row['HullUpgrade']] if row.get('HullUpgrade') else []), '--output', str(pending)], env, progress)
            progress.check_cancel()
            pending.replace(glb)
        progress('원본 크기의 텍스처와 편집용 부품을 준비하고 있어요.', stage='texture', percent=0, stage_started=time.time())
        run_command([sys.executable, str(ENGINE / 'native_glb_export.py'), '--input', str(glb), '--output', str(target / f'{code}.obj'),
                     '--report', str(target / 'export.json'), '--formats', 'obj', '--texture-max-size', '0',
                     '--pbr-exporter', str(exporter), '--pbr-game-dir', str(folder), '--pbr-cache', str(root / 'PBRMaps')], env, progress, measured=True)
        with LOCK:
            progress.check_cancel()
            marker.write_text(json.dumps({'build': GAMES[key]['build'], 'code': code}), encoding='utf-8')
            try: history = json.loads(timings.read_text(encoding='utf-8'))
            except (OSError, ValueError): history = {}
            history[code] = round(time.time() - started, 2)
            timings.write_text(json.dumps(history), encoding='utf-8')
        return {'folder': str(target), 'name': row['LocalizedName']}
    return start_job(f'extract:{key}:{GAMES[key]["build"]}:{code}:{language}', work, serial=True,
                     metadata={'game':key, 'code':code, 'name':row['LocalizedName']})
