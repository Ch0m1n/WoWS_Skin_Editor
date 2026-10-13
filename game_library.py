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
import shutil
import project_store
from app_version import ENGINE_ID

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT / 'engine' / 'Backend'
BASE_CACHE = Path(os.environ.get('WOWS_WORKSHOP_CACHE', ROOT / '.cache'))
CACHE = BASE_CACHE / ('engine-' + ENGINE_ID)
QUEUE_FILE = project_store.HOME / 'queues' / (hashlib.sha256(str(ROOT).encode()).hexdigest()[:16] + '.json')
GAMES = {}
JOBS = {}
JOB_PROCESSES = {}
LOCK = threading.RLock()
INDEX_LOCK = threading.RLock()
EXTRACTION_QUEUE = queue.Queue()
EXTRACTION_WORKER = None
QUEUE_ORDER = []
QUEUE_TASKS = {}
PAUSED = False
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
        if job['status'] not in ('queued', 'running', 'paused', 'cancelling'): return job['status']
        job['cancel_requested'] = True
        job.update(status='cancelled' if job['status'] == 'queued' else 'cancelling', message='함선 준비를 취소했어요.')
        if job['status']=='cancelled' and key in QUEUE_ORDER:QUEUE_ORDER.remove(key);QUEUE_TASKS.pop(key,None)
        process = JOB_PROCESSES.get(key)
    if process: stop_job_process(process)
    persist_queue()
    return job['status']

def persist_queue():
    with LOCK:
        rows=[]
        active=[k for k,j in JOBS.items() if j.get('code') and j['status'] in ('running','paused')]
        for key in active+list(QUEUE_ORDER):
            job=JOBS.get(key)
            if job and job.get('code') and job['status'] in ('queued','running','paused'):
                rows.append({'folder':GAMES[job['game']]['folder'],'code':job['code'],'language':job.get('language','ko')})
        queue_file=project_store.HOME/'queues'/QUEUE_FILE.name
        project_store.atomic_json(queue_file,{'paused':PAUSED,'jobs':rows})

def suspend_process(process, suspend):
    if process.poll() is not None:return
    if os.name=='nt':
        import ctypes
        from ctypes import wintypes
        class Entry(ctypes.Structure):
            _fields_=[('size',wintypes.DWORD),('usage',wintypes.DWORD),('pid',wintypes.DWORD),('heap',ctypes.c_size_t),('module',wintypes.DWORD),('threads',wintypes.DWORD),('parent',wintypes.DWORD),('priority',wintypes.LONG),('flags',wintypes.DWORD),('exe',wintypes.WCHAR*260)]
        kernel=ctypes.windll.kernel32;kernel.CreateToolhelp32Snapshot.restype=wintypes.HANDLE;kernel.OpenProcess.restype=wintypes.HANDLE;kernel.CloseHandle.argtypes=[wintypes.HANDLE]
        snapshot=kernel.CreateToolhelp32Snapshot(2,0);entry=Entry();entry.size=ctypes.sizeof(entry);parents={}
        try:
            more=kernel.Process32FirstW(wintypes.HANDLE(snapshot),ctypes.byref(entry))
            while more:parents[entry.pid]=entry.parent;more=kernel.Process32NextW(wintypes.HANDLE(snapshot),ctypes.byref(entry))
        finally:kernel.CloseHandle(snapshot)
        owned={process.pid}
        while True:
            expanded=owned|{pid for pid,parent in parents.items() if parent in owned}
            if expanded==owned:break
            owned=expanded
        function=ctypes.windll.ntdll.NtSuspendProcess if suspend else ctypes.windll.ntdll.NtResumeProcess;function.argtypes=[wintypes.HANDLE]
        for pid in owned:
            handle=kernel.OpenProcess(0x0800,False,pid)
            if not handle:
                if pid==process.pid and process.poll() is None:raise OSError('추출 일시정지 권한을 얻지 못했어요.')
                continue
            try:
                if function(handle)!=0 and pid==process.pid and process.poll() is None:raise OSError('추출 일시정지를 적용하지 못했어요.')
            finally:kernel.CloseHandle(handle)
    else:
        import signal
        os.killpg(process.pid,signal.SIGSTOP if suspend else signal.SIGCONT)

def queue_control(payload):
    global PAUSED
    with LOCK:
        if 'order' in payload:
            order=payload['order']
            if not isinstance(order,list) or len(order)!=len(QUEUE_ORDER) or set(order)!=set(QUEUE_ORDER):raise ValueError('대기열이 변경됐어요. 다시 확인하세요.')
            QUEUE_ORDER[:]=order
        if 'paused' in payload and bool(payload['paused'])!=PAUSED:
            value=bool(payload['paused'])
            for key,process in JOB_PROCESSES.items():
                if JOBS[key].get('code') and JOBS[key]['status'] in ('running','paused'):
                    suspend_process(process,value)
                    JOBS[key]['status']='paused' if value else 'running'
            PAUSED=value
        persist_queue()
    return {'paused':PAUSED,'order':list(QUEUE_ORDER)}

def restore_queue():
    global PAUSED
    try: saved=json.loads((project_store.HOME/'queues'/QUEUE_FILE.name).read_text(encoding='utf-8'))
    except (OSError,ValueError):return
    PAUSED=bool(saved.get('paused'))
    rows=saved.get('jobs',[])[:100]
    def restore():
        for row in rows:
            try:
                info=install_info(row['folder'])
                if not info:continue
                key=catalog_job(info['id'],language=row.get('language','ko'))
                while JOBS[key]['status']=='running':time.sleep(.1)
                if JOBS[key]['status']=='done':extract_job(info['id'],row['code'],row.get('language','ko'))
            except (OSError,ValueError,KeyError):continue
    threading.Thread(target=restore,daemon=True).start()

def list_model_cache():
    rows=[]
    root=BASE_CACHE if CACHE.parent==BASE_CACHE else CACHE
    folders=list(root.glob('*/*/models/*'))+list(root.glob('engine-*/*/*/models/*'))
    for folder in folders:
        if not folder.is_dir() or folder.is_symlink():continue
        files=[p for p in folder.rglob('*') if p.is_file() and not p.is_symlink()]
        marker=folder/'ready.json'
        try:metadata=json.loads(marker.read_text(encoding='utf-8'))
        except (OSError,ValueError):metadata={}
        rows.append({'id':folder.relative_to(root).as_posix(),'folder':str(folder),'code':folder.name,'build':folder.parent.parent.name,'bytes':sum(p.stat().st_size for p in files),'ready':metadata.get('engine')==ENGINE_ID,'name':metadata.get('name',folder.name)})
    return rows

def cache_control(payload):
    if payload.get('action') not in ('delete','reextract'):raise ValueError('캐시 작업이 올바르지 않아요.')
    identity=payload.get('id','')
    if not re.fullmatch(r'(?:engine-[a-f0-9]{16}/)?[a-f0-9]{16}/[0-9]+/models/[A-Z0-9_]{4,40}',identity):raise ValueError('캐시 ID가 올바르지 않아요.')
    root=BASE_CACHE if CACHE.parent==BASE_CACHE else CACHE
    folder=root/identity
    if not folder.resolve().is_relative_to(root.resolve()) or any(p.is_symlink() for p in [folder,*folder.parents] if p!=root.parent):raise ValueError('캐시 경로가 올바르지 않아요.')
    if payload.get('protected') and Path(payload['protected']).resolve()==folder.resolve():raise ValueError('현재 편집 중인 모델은 삭제할 수 없어요.')
    key,build,_,code=identity.split('/')[-4:]
    with LOCK:
        if any(j.get('game')==key and j.get('code')==code and j['status'] in ('queued','running','paused','cancelling') for j in JOBS.values()):raise ValueError('준비 중인 모델은 먼저 취소하세요.')
        if folder.exists():shutil.rmtree(folder)
        for job in JOBS.values():
            if job.get('game')==key and job.get('code')==code and job['status']=='done':job['status']='invalidated'
    if payload.get('action')=='reextract':
        if key not in GAMES:discover_games()
        if key not in GAMES:raise ValueError('게임 설치 폴더를 다시 지정하세요.')
        language=payload.get('language','ko')
        if language not in GAMES[key].get('catalogs',{}):raise ValueError('함선 목록을 먼저 열어주세요.')
        return {'job':extract_job(key,code,language)}
    return {'deleted':identity}


def start_job(signature, work, serial=False, metadata=None):
    global EXTRACTION_WORKER
    with LOCK:
        for key, job in JOBS.items():
            if job['signature'] == signature and job['status'] in ('queued', 'running', 'paused', 'cancelling', 'done'): return key
        key = uuid.uuid4().hex
        JOBS[key] = {'signature': signature, 'status': 'queued' if serial else 'running', 'message': '대기열에서 기다리는 중이에요.' if serial else '준비 중', 'started': time.time(), 'percent': None, **(metadata or {})}
    def progress(message, **details):
        check_cancel()
        with LOCK:
            JOBS[key].update(message=message, **details)
    def check_cancel():
        if JOBS[key].get('cancel_requested'): raise JobCancelled()
        if serial:
            while PAUSED:
                JOBS[key]['status']='paused';time.sleep(.1)
                if JOBS[key].get('cancel_requested'):raise JobCancelled()
            if JOBS[key]['status']=='paused':JOBS[key]['status']='running'
    def set_process(process):
        with LOCK:
            if process is None: JOB_PROCESSES.pop(key, None)
            else:
                JOB_PROCESSES[key] = process
                if serial and PAUSED:suspend_process(process,True)
        if process and JOBS[key].get('cancel_requested'): stop_job_process(process)
    progress.check_cancel = check_cancel
    progress.set_process = set_process
    def run():
        try:
            check_cancel()
            with LOCK:
                if JOBS[key].get('cancel_requested'):raise JobCancelled()
                JOBS[key].update(status='running', started=time.time(), message='준비 중')
            result = work(progress)
            check_cancel()
            with LOCK:
                if JOBS[key].get('cancel_requested'):raise JobCancelled()
                JOBS[key].update(status='done', percent=100, result=result, seconds=round(time.time() - JOBS[key]['started'], 2))
        except Exception as error:
            with LOCK:
                JOBS[key].update(status='cancelled' if JOBS[key].get('cancel_requested') else 'error',
                                 message='함선 준비를 취소했어요.' if JOBS[key].get('cancel_requested') else str(error))
        finally:
            with LOCK: JOB_PROCESSES.pop(key, None)
            if metadata and metadata.get('code'):persist_queue()
    if serial:
        with LOCK:
            if EXTRACTION_WORKER is None:
                def consume():
                    while True:
                        EXTRACTION_QUEUE.get()
                        while PAUSED:time.sleep(.1)
                        with LOCK:
                            selected=QUEUE_ORDER.pop(0) if QUEUE_ORDER else None
                            task=QUEUE_TASKS.pop(selected,None)
                        try:
                            if task:task()
                        finally: EXTRACTION_QUEUE.task_done()
                EXTRACTION_WORKER = threading.Thread(target=consume, daemon=True)
                EXTRACTION_WORKER.start()
            QUEUE_ORDER.append(key);QUEUE_TASKS[key]=run;EXTRACTION_QUEUE.put(key)
            if metadata and metadata.get('code'):persist_queue()
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

def camouflage_labels(key, raw, language):
    if language not in ('ko','en'): raise ValueError('지원하지 않는 언어예요.')
    from mo_reader import read_mo
    from game_archive import find_entry, decode_game_params, root_params, extract_entry
    import xml.etree.ElementTree as ET
    folder=game_dir(key)
    translation=folder/'bin'/str(GAMES[key]['build'])/'res/texts'/language/'LC_MESSAGES/global.mo'
    if not translation.is_file(): return {}
    target=cache_dir(key)/f'camouflage-labels-v1-{language}.json'
    if target.is_file(): return json.loads(target.read_text(encoding='utf-8'))
    translations=read_mo(translation)
    entry=find_entry(GAMES[key]['entries'],('GameParams.data','GameParams_py2.data'))
    params=root_params(decode_game_params(extract_entry(folder,entry)))
    names={}
    for value in params.values():
        if not isinstance(value,dict) or not value.get('camouflage'): continue
        ids='IDS_'+str(value.get('name','')).upper()
        label=translations.gettext(ids).strip()
        if not label or label==ids: continue
        names.setdefault(str(value['camouflage']).casefold(),set()).add(label)
    labels={}
    for camo in ET.fromstring(raw).findall('camouflages.xml/camouflage'):
        localized=names.get((camo.findtext('name') or '').strip().casefold(),())
        for scheme in camo.findall('colorSchemes'):
            code=((scheme.text or '').strip().split() or [''])[0]
            if code: labels.setdefault(code,set()).update(localized)
    labels={code:sorted(values) for code,values in labels.items() if values}
    pending=target.with_suffix('.'+uuid.uuid4().hex+'.tmp')
    pending.write_text(json.dumps(labels,ensure_ascii=False),encoding='utf-8');pending.replace(target)
    return labels


def camouflage_xml(key, language='ko'):
    """Read only the installed build's original archive entry, never res_mods."""
    folder = game_dir(key)
    install_info(folder)  # Discard a stale archive index after a game update.
    from game_archive import read_archive_index, extract_entry
    with INDEX_LOCK:
        if 'entries' not in GAMES[key]: GAMES[key]['entries'] = read_archive_index(folder)[1]
        entry = GAMES[key]['entries'].get('/camouflages.xml')
        if not entry: raise FileNotFoundError('게임 원본 camouflages.xml을 찾지 못했어요.')
        if entry.unpacked_size > 32 * 1024 * 1024: raise ValueError('위장 XML이 32 MiB를 넘어요.')
        data = extract_entry(folder, entry)
    return {'name': 'camouflages.xml', 'xml': data.decode('utf-8-sig'),
            'game': install_info(folder), 'labels':camouflage_labels(key,data,language), 'language':language}


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
                          text=True, encoding='utf-8', errors='replace', start_new_session=os.name != 'nt', creationflags=0x08004000 if os.name == 'nt' else 0) as process:
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
        try: ready=json.loads(marker.read_text(encoding='utf-8'))
        except (OSError,ValueError):ready={}
        if ready.get('engine')==ENGINE_ID and (target / f'{code}.obj').is_file(): return {'folder': str(target), 'name': row['LocalizedName']}
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
        if ready.get('engine')!=ENGINE_ID or not glb.is_file() or glb.stat().st_size < 24:
            pending = target / f'{code}.pending.glb'
            run_command([str(exporter), '--game-dir', str(folder), 'export-ship', code, '--lod', '0',
                         *(['--hull', row['HullUpgrade']] if row.get('HullUpgrade') else []), '--output', str(pending)], env, progress)
            progress.check_cancel()
            pending.replace(glb)
        progress('원본 크기의 텍스처와 편집용 부품을 준비하고 있어요.', stage='texture', percent=0, stage_started=time.time())
        run_command([sys.executable, str(ENGINE / 'native_glb_export.py'), '--input', str(glb), '--output', str(target / f'{code}.obj'),
                     '--report', str(target / 'export.json'), '--formats', 'obj', '--texture-max-size', '0',
                     '--pbr-exporter', str(exporter), '--pbr-game-dir', str(folder), '--pbr-cache', str(root / 'PBRMaps')], env, progress, measured=True)
        progress.check_cancel()
        with LOCK:
            marker.write_text(json.dumps({'build': GAMES[key]['build'], 'code': code,'engine':ENGINE_ID,'name':row['LocalizedName']}), encoding='utf-8')
            try: history = json.loads(timings.read_text(encoding='utf-8'))
            except (OSError, ValueError): history = {}
            history[code] = round(time.time() - started, 2)
            timings.write_text(json.dumps(history), encoding='utf-8')
        return {'folder': str(target), 'name': row['LocalizedName']}
    return start_job(f'extract:{key}:{GAMES[key]["build"]}:{code}:{language}', work, serial=True,
                     metadata={'game':key, 'code':code, 'name':row['LocalizedName'],'language':language})
