from pathlib import Path
import hashlib

VERSION = '0.2.1'
ROOT = Path(__file__).resolve().parent
_files = [ROOT / n for n in ('server.py', 'game_library.py', 'project_store.py', 'app_version.py')]
_files += sorted((ROOT / 'web').glob('*.js')) + sorted((ROOT / 'web').glob('*.html')) + sorted((ROOT / 'web').glob('*.css'))
ENGINE_ID = hashlib.sha256(b''.join((ROOT / 'engine' / 'Backend' / n).read_bytes() for n in ('wowsunpack.exe','native_glb_export.py','pbr_materials.py'))).hexdigest()[:16]
BUILD_ID = hashlib.sha256(b''.join(p.read_bytes() for p in _files if p.is_file())+ENGINE_ID.encode()).hexdigest()[:16]
