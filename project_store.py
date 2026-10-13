"""Atomic disk backups, independent of browser storage and release location."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import threading
import time
import uuid

HOME = Path(os.environ.get('WOWS_WORKSHOP_DATA', Path(os.environ.get('LOCALAPPDATA', str(Path(__file__).parent))) / 'WoWSSkinWorkshop'))
LOCK = threading.RLock()

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)

def source_key(source):
    identity = source.get('code') or source.get('folder') or source.get('name') or 'imported'
    return hashlib.sha256(str(identity).encode()).hexdigest()[:24]

def save_backup(project):
    if project.get('schema') != 'wows-skin-workshop/v1' or not isinstance(project.get('documents'),list) or not isinstance(project.get('source'),dict):
        raise ValueError('프로젝트 형식이 올바르지 않아요.')
    source = project['source']; key = source_key(source)
    with LOCK:
        folder = HOME / 'Backups' / key; folder.mkdir(parents=True, exist_ok=True)
        stamp = str(time.time_ns())
        while (folder/(stamp+'.wowskin.gz')).exists():stamp=str(int(stamp)+1)
        file = folder / (stamp + '.wowskin.gz'); temporary = file.with_suffix('.tmp')
        try:
            with gzip.open(temporary, 'wt', encoding='utf-8', compresslevel=3) as stream: json.dump(project, stream, ensure_ascii=False)
            temporary.replace(file)
        finally: temporary.unlink(missing_ok=True)
        metadata = {'id':key+'/'+stamp, 'name':source.get('name','Ship'), 'code':source.get('code'), 'saved':time.time(), 'saved_ns':int(stamp), 'size':file.stat().st_size}
        atomic_json(file.with_suffix('.json'),metadata)
        old = sorted(folder.glob('*.wowskin.gz'),reverse=True)[5:]
        for path in old: path.unlink(); path.with_suffix('.json').unlink(missing_ok=True)
    return metadata

def list_backups():
    result=[]
    for path in (HOME/'Backups').glob('*/*.json'):
        try: result.append(json.loads(path.read_text(encoding='utf-8')))
        except (OSError,ValueError): pass
    return sorted(result,key=lambda row:row.get('saved_ns',int(row['id'].split('/')[-1])),reverse=True)

def read_backup(identity):
    import re
    if not re.fullmatch(r'[a-f0-9]{24}/[0-9]{10,24}',str(identity)): raise ValueError('백업 ID가 올바르지 않아요.')
    path = HOME / 'Backups' / (identity+'.wowskin.gz')
    if path.is_symlink() or path.parent.is_symlink(): raise ValueError('백업 경로가 올바르지 않아요.')
    with gzip.open(path,'rt',encoding='utf-8') as stream:return json.load(stream)
