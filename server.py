"""Local WoWS texture workshop. Source folders are read-only; exports are downloads."""
from __future__ import annotations
import argparse
import base64
import hashlib
import gzip
import io
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import struct
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse
import zipfile
import threading
import subprocess
import sys
import time
from PIL import Image
import game_library
import project_store
from app_version import VERSION, BUILD_ID

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'
DEFAULT_LIBRARY = Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'WoWS Toolbox' / 'output'
SOURCES: dict[str, Path] = {}
MAX_BODY = 96 * 1024 * 1024
MAX_PIXELS = 4096 * 4096
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def safe_relative(value: str) -> str:
    value = value.replace('\\', '/')
    path = PurePosixPath(value)
    if not value or path.is_absolute() or '..' in path.parts or ':' in value or '\x00' in value:
        raise ValueError('상대 경로만 사용하세요. 상위 폴더 이동은 허용하지 않아요.')
    return str(path)


def contained(root: Path, relative: str) -> Path:
    target = (root / safe_relative(relative)).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError('허용된 폴더 밖의 파일이에요.')
    return target


def register_source(folder: Path) -> dict:
    folder = folder.expanduser().resolve()
    if not folder.is_dir():
        raise ValueError('모델 폴더를 찾을 수 없어요.')
    objs = sorted(folder.glob('*.obj'))
    glbs = sorted(folder.glob('*.glb'))
    models = objs + glbs
    if not models:
        raise ValueError('폴더에 OBJ 또는 GLB 모델이 없어요.')
    ident = hashlib.sha256(str(folder).encode()).hexdigest()[:16]
    SOURCES[ident] = folder
    model = models[0]
    mtl = model.with_suffix('.mtl')
    return {'id': ident, 'name': model.stem, 'folder': str(folder), 'model': model.name,
            'format': model.suffix[1:], 'mtl': mtl.name if mtl.exists() else None,
            'manifest': 'texture_manifest.json' if (folder / 'texture_manifest.json').exists() else None}


def discover_library() -> list[dict]:
    if not DEFAULT_LIBRARY.is_dir():
        return []
    result = []
    for folder in sorted(DEFAULT_LIBRARY.iterdir()):
        if folder.is_dir() and not folder.is_symlink():
            try:
                result.append(register_source(folder))
            except ValueError:
                pass
    return result


def decode_png(value: str) -> Image.Image:
    if not isinstance(value, str) or not value.startswith('data:image/png;base64,'):
        raise ValueError('PNG 이미지 데이터가 필요해요.')
    raw = base64.b64decode(value.partition(',')[2], validate=True)
    if len(raw) > 96 * 1024 * 1024:
        raise ValueError('텍스처 파일이 너무 커요.')
    with Image.open(io.BytesIO(raw)) as image:
        if image.width * image.height > MAX_PIXELS or max(image.size) > 4096:
            raise ValueError('첫 버전은 최대 4096 × 4096 텍스처를 지원해요.')
        return image.convert('RGBA')

def resolve_source(payload):
    source=payload.get('source',{})
    source=dict(source)
    stem=Path(source.get('model','')).stem
    import re
    if not source.get('code') and re.fullmatch(r'[A-Z]{4,5}[0-9]{3,4}[A-Z0-9_]*',stem):source['code']=stem
    if payload.get('folder'):return {'source':register_source(Path(payload['folder']))}
    if source.get('folder') and Path(source['folder']).is_dir():
        original=register_source(Path(source['folder']))
        if source.get('name'):original['name']=source['name']
        original.update({k:source[k] for k in ('code','gameFolder','gameBuild','language','game') if k in source})
        if not source.get('code'):return {'source':original}
        info=game_library.install_info(source.get('gameFolder',''))
        if info and info['build']==source.get('gameBuild'):return {'source':original}
    code=source.get('code')
    if not code:raise ValueError('모델 폴더를 다시 연결해주세요.')
    info=game_library.install_info(source.get('gameFolder',''))
    if not info:
        games=game_library.discover_games()
        if len(games)!=1:raise ValueError('게임 또는 모델 폴더를 다시 연결해주세요.')
        info=games[0]
    language=source.get('language','ko')
    def work(progress):
        key=game_library.catalog_job(info['id'],language=language)
        while game_library.JOBS[key]['status']=='running':time.sleep(.1)
        if game_library.JOBS[key]['status']!='done':raise ValueError(game_library.JOBS[key]['message'])
        key=game_library.extract_job(info['id'],code,language)
        while game_library.JOBS[key]['status'] in ('queued','running','paused','cancelling'):time.sleep(.2)
        job=game_library.JOBS[key]
        if job['status']!='done':raise ValueError(job['message'])
        result=register_source(Path(job['result']['folder']));result.update(code=code,game=info['id'],gameFolder=info['folder'],gameBuild=info['build'],language=language)
        return result
    return {'job':game_library.start_job('resolve:'+code+':'+str(info['build']),work)}


def import_texture(payload):
    raw = base64.b64decode(payload['data'], validate=True)
    if len(raw) > 96 * 1024 * 1024: raise ValueError('텍스처 파일은 96 MiB 이하로 선택하세요.')
    with Image.open(io.BytesIO(raw)) as source:
        if source.format not in ('PNG', 'DDS'): raise ValueError('PNG 또는 DDS 텍스처를 선택하세요.')
        if max(source.size) > 4096 or source.width * source.height > MAX_PIXELS: raise ValueError('최대 4096 × 4096 텍스처를 지원해요.')
        image = source.convert('RGBA')
    output = io.BytesIO(); image.save(output, format='PNG')
    return {'data':'data:image/png;base64,'+base64.b64encode(output.getvalue()).decode(), 'width':image.width, 'height':image.height}


def encode_dds(image: Image.Image, compression: str, mipmaps: bool) -> bytes:
    if compression not in ('rgba', 'dxt5'):
        raise ValueError('DDS 형식을 확인하세요.')
    header = None
    chunks = []
    level = image.convert('RGBA')
    while True:
        output = io.BytesIO()
        level.save(output, format='DDS', **({'pixel_format': 'DXT5'} if compression == 'dxt5' else {}))
        data = output.getvalue()
        if header is None:
            header = bytearray(data[:128])
        chunks.append(data[128:])
        if not mipmaps or level.size == (1, 1):
            break
        level = level.resize((max(1, level.width // 2), max(1, level.height // 2)), Image.Resampling.LANCZOS)
    if len(chunks) > 1:
        struct.pack_into('<I', header, 8, struct.unpack_from('<I', header, 8)[0] | 0x20000)
        struct.pack_into('<I', header, 28, len(chunks))
        struct.pack_into('<I', header, 108, struct.unpack_from('<I', header, 108)[0] | 0x400008)
    return bytes(header) + b''.join(chunks)


def export_zip(payload: dict) -> bytes:
    fmt = payload.get('format', 'png')
    if fmt not in ('png', 'dds'):
        raise ValueError('PNG 또는 DDS를 선택하세요.')
    textures = payload.get('textures', [])
    if not isinstance(textures, list) or len(textures) > 64:
        raise ValueError('텍스처 수가 너무 많아요.')
    if not textures and not payload.get('xml'):
        raise ValueError('출력할 변경 사항이 없어요.')
    output = io.BytesIO()
    manifest = {'schema': 'wows-skin-workshop-export/v1', 'format': fmt, 'textures': [],
                'note': '편집 패키지예요. 게임 경로와 DDS 형식은 원본과 비교해서 확인하세요.'}
    names = set()
    total_pixels = 0
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for row in textures:
            image = decode_png(row['data'])
            total_pixels += image.width * image.height
            if total_pixels > MAX_PIXELS * 8:
                raise ValueError('한 번에 출력하는 픽셀 수가 너무 많아요. 나눠서 출력하세요.')
            filename = safe_relative(row.get('target') or f"textures/{row['name']}")
            filename = str(PurePosixPath(filename).with_suffix('.' + fmt))
            if filename in names:
                raise ValueError('두 텍스처의 출력 경로가 같아요. 경로를 구분하세요.')
            names.add(filename)
            if fmt == 'dds':
                data = encode_dds(image, payload.get('compression', 'dxt5'), bool(payload.get('mipmaps', True)))
            else:
                stream = io.BytesIO()
                image.save(stream, format='PNG')
                data = stream.getvalue()
            archive.writestr(filename, data)
            manifest['textures'].append({'file': filename, 'source': row.get('name'), 'width': image.width,
                                         'height': image.height, 'compression': payload.get('compression') if fmt == 'dds' else None})
        if payload.get('xml'):
            xml = payload['xml']
            if not isinstance(xml, str) or len(xml) > 8 * 1024 * 1024:
                raise ValueError('XML 크기가 너무 커요.')
            xml_name = safe_relative(payload.get('xmlName', 'camouflages.xml'))
            if xml_name in names or xml_name == 'workshop-export.json':
                raise ValueError('XML 출력 경로가 다른 파일과 겹쳐요.')
            archive.writestr(xml_name, xml)
        archive.writestr('workshop-export.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith(('GET /api', 'POST')):
            super().log_message(fmt, *args)

    def send(self, data: bytes, mime: str, status: int = 200, filename: str | None = None):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        if filename:
            self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)

    def json(self, value, status=200):
        self.send(json.dumps(value, ensure_ascii=False).encode(), 'application/json; charset=utf-8', status)

    def check_host(self):
        expected = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if self.headers.get('Host') not in expected:
            raise ValueError('로컬 주소로 접속하세요.')
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{value}' for value in expected}:
            raise ValueError('다른 사이트에서 이 편집기에 요청할 수 없어요.')

    def do_GET(self):
        try:
            self.check_host()
            path = unquote(urlparse(self.path).path)
            if path == '/api/health':
                return self.json({'app': 'wows-skin-workshop', 'version': VERSION, 'build':BUILD_ID, 'root':str(ROOT), 'pid':os.getpid()})
            if path == '/api/backups':
                return self.json({'backups':project_store.list_backups()})
            if path == '/api/cache':
                return self.json({'models':game_library.list_model_cache()})
            if path.startswith('/api/prepared-ships/'):
                return self.json({'ships':game_library.prepared_ships(path.rsplit('/',1)[-1])})
            if path == '/api/queue-state':
                return self.json({'paused':game_library.PAUSED, 'order':game_library.QUEUE_ORDER})
            if path == '/api/library':
                return self.json({'models': discover_library()})
            if path == '/api/games':
                return self.json({'games': game_library.discover_games()})
            if path == '/api/preparations':
                with game_library.LOCK:
                    jobs = [{'id':key, **{field:job.get(field) for field in ('game','code','name','status','message','percent','started','estimated_total_seconds')}}
                            for key,job in game_library.JOBS.items() if job.get('code')]
                return self.json({'jobs': jobs})
            if path.startswith('/api/jobs/'):
                job = game_library.JOBS.get(path.rsplit('/', 1)[-1])
                if not job: return self.json({'error': '작업을 찾지 못했어요.'}, 404)
                return self.json({k: v for k, v in job.items() if k != 'signature'})
            if path.startswith('/api/ship-icon/'):
                key, code = path[len('/api/ship-icon/'):].split('/')
                return self.send(game_library.thumbnail(key, code).read_bytes(), 'image/png')
            if path.startswith('/api/assets/'):
                ident, _, relative = path[len('/api/assets/'):].partition('/')
                if ident not in SOURCES:
                    return self.json({'error': '모델 폴더를 다시 열어주세요.'}, 404)
                target = contained(SOURCES[ident], relative)
                if target.suffix.lower() not in {'.obj', '.mtl', '.png', '.jpg', '.jpeg', '.webp', '.glb', '.bin', '.json', '.dds'}:
                    raise ValueError('지원하지 않는 모델 파일이에요.')
            else:
                target = contained(WEB, path.lstrip('/') or 'index.html')
            if not target.is_file():
                return self.json({'error': '파일을 찾을 수 없어요.'}, 404)
            mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary',
                    '.obj': 'text/plain', '.mtl': 'text/plain'}.get(target.suffix, mimetypes.guess_type(target)[0] or 'application/octet-stream')
            return self.send(target.read_bytes(), mime)
        except (ValueError, OSError) as error:
            self.json({'error': str(error)}, 400)

    def do_POST(self):
        try:
            self.check_host()
            if not self.headers.get('Content-Type', '').startswith('application/json'):
                raise ValueError('JSON 요청이 필요해요.')
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > MAX_BODY:
                raise ValueError('요청 크기가 너무 커요.')
            raw=self.rfile.read(length)
            if self.headers.get('Content-Encoding')=='gzip':
                with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:raw=stream.read(512*1024*1024+1)
                if len(raw)>512*1024*1024:raise ValueError('프로젝트 데이터가 512 MiB를 넘어요. 텍스처를 평면화하세요.')
            elif self.headers.get('Content-Encoding'):raise ValueError('지원하지 않는 압축 형식이에요.')
            payload = json.loads(raw)
            path = urlparse(self.path).path
            if path == '/api/open-folder':
                return self.json(register_source(Path(payload['folder'])))
            if path == '/api/import-texture':
                return self.json(import_texture(payload))
            if path == '/api/save-backup':
                return self.json(project_store.save_backup(payload))
            if path == '/api/read-backup':
                return self.json(project_store.read_backup(payload['id']))
            if path == '/api/cache-control':
                return self.json(game_library.cache_control(payload))
            if path == '/api/queue-control':
                return self.json(game_library.queue_control(payload))
            if path == '/api/resolve-source':
                return self.json(resolve_source(payload))
            if path == '/api/server-control':
                action=payload.get('action')
                if action not in ('restart','stop'): raise ValueError('지원하지 않는 서버 동작이에요.')
                if any(j['status'] in ('running','paused','cancelling') for j in game_library.JOBS.values()): raise ValueError('진행 중인 준비 작업을 먼저 취소하세요.')
                game_library.persist_queue()
                self.json({'action':action})
                def finish():
                    time.sleep(.2);self.server.shutdown();self.server.server_close()
                    if action=='restart': subprocess.Popen([sys.executable,str(ROOT/'server.py'),'--port',str(self.server.server_port)],cwd=ROOT,creationflags=0x08000000 if os.name=='nt' else 0)
                threading.Thread(target=finish,daemon=False).start();return
            if path == '/api/game-folder':
                info = game_library.install_info(payload['folder'])
                if not info: raise ValueError('idx와 res_packages가 있는 워쉽 설치 폴더를 선택하세요.')
                return self.json(info)
            if path == '/api/catalog':
                return self.json({'job': game_library.catalog_job(payload['game'], payload.get('refresh', False), payload.get('language','ko'))})
            if path == '/api/camouflage-xml':
                return self.json(game_library.camouflage_xml(payload['game'],payload.get('language','ko')))
            if path == '/api/camouflage-labels':
                result=game_library.camouflage_xml(payload['game'],payload.get('language','ko'))
                return self.json({'labels':result['labels'],'language':result['language']})
            if path == '/api/ship-model':
                return self.json({'job': game_library.extract_job(payload['game'], payload['code'],payload.get('language','ko'))})
            if path == '/api/cancel-preparation':
                return self.json({'status': game_library.cancel_job(payload['job'])})
            if path == '/api/job-model':
                job = game_library.JOBS.get(payload['job'])
                if not job or job['status'] != 'done' or not job['signature'].startswith('extract:'): raise ValueError('모델 준비가 끝나지 않았어요.')
                source = register_source(Path(job['result']['folder']))
                source['name'] = job['result']['name']
                source.update({k:job.get(k) for k in ('code','game','language')})
                source['gameFolder']=game_library.GAMES[job['game']]['folder'];source['gameBuild']=game_library.GAMES[job['game']]['build']
                return self.json(source)
            if path == '/api/export':
                return self.send(export_zip(payload), 'application/zip', filename='wows-skin.zip')
            return self.json({'error': '지원하지 않는 요청이에요.'}, 404)
        except (ValueError, KeyError, TypeError, OSError, EOFError, Image.DecompressionBombError) as error:
            self.json({'error': str(error)}, 400)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    discover_library()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    game_library.restore_queue()
    print(f'WoWS Skin Workshop: http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        game_library.persist_queue()
        for process in list(game_library.JOB_PROCESSES.values()):game_library.stop_job_process(process)
        server.server_close()
