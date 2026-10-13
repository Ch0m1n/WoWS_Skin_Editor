from __future__ import annotations

import builtins
import ctypes
import io
import json
import os
import pickle
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from runtime_i18n import translate_text
from cache_retention import prune_old_build_caches


IDX_MAGIC = 0x50465349
ROOT_PARENT_ID = 0xDBB1A1D1B108B927


@dataclass(frozen=True)
class ArchiveEntry:
    path: str
    volume: str
    offset: int
    packed_size: int
    unpacked_size: int
    compression_info: int


def progress(stage: str, percent: int, message: str) -> None:
    print(
        "[PROGRESS] "
        + json.dumps(
            {"stage": stage, "percent": percent, "message": translate_text(message)},
            ensure_ascii=False,
        ),
        flush=True,
    )


def latest_build(game_dir: Path) -> tuple[int, Path]:
    bin_dir = game_dir / "bin"
    builds: list[tuple[int, Path]] = []
    if bin_dir.is_dir():
        for child in bin_dir.iterdir():
            if child.is_dir() and child.name.isdigit() and (child / "idx").is_dir():
                builds.append((int(child.name), child))
    if not builds:
        raise FileNotFoundError(f"idx가 있는 게임 빌드를 찾지 못했어요: {bin_dir}")
    return max(builds, key=lambda item: item[0])


def _cstring(data: bytes, offset: int) -> str:
    end = data.find(b"\0", offset)
    if end < 0:
        end = len(data)
    return data[offset:end].decode("utf-8", "replace")


def read_archive_index(game_dir: Path) -> tuple[int, dict[str, ArchiveEntry]]:
    build, build_dir = latest_build(game_dir)
    resources: dict[int, tuple[str, int]] = {}
    file_infos: dict[int, tuple[int, int, int, int, int]] = {}
    volumes: dict[int, str] = {}

    for idx_path in sorted((build_dir / "idx").glob("*.idx")):
        data = idx_path.read_bytes()
        if len(data) < 56 or struct.unpack_from("<I", data, 0)[0] != IDX_MAGIC:
            continue

        resource_count, file_count, volume_count, _ = struct.unpack_from("<IIII", data, 16)
        resources_ptr, file_infos_ptr, volumes_ptr = struct.unpack_from("<QQQ", data, 32)
        base = 16

        for i in range(resource_count):
            off = base + resources_ptr + i * 32
            _, filename_ptr, resource_id, parent_id = struct.unpack_from("<QQQQ", data, off)
            resources[resource_id] = (_cstring(data, off + filename_ptr), parent_id)

        for i in range(file_count):
            off = base + file_infos_ptr + i * 48
            (
                resource_id,
                volume_id,
                pkg_offset,
                compression_info,
                packed_size,
                _crc32,
                unpacked_size,
                _padding,
            ) = struct.unpack_from("<QQQQIIII", data, off)
            file_infos[resource_id] = (
                volume_id,
                pkg_offset,
                packed_size,
                unpacked_size,
                compression_info,
            )

        for i in range(volume_count):
            off = base + volumes_ptr + i * 24
            _, name_ptr, volume_id = struct.unpack_from("<QQQ", data, off)
            volumes[volume_id] = _cstring(data, off + name_ptr)

    path_cache: dict[int, str] = {}

    def resolve_path(resource_id: int) -> str:
        cached = path_cache.get(resource_id)
        if cached is not None:
            return cached
        name, parent_id = resources[resource_id]
        if parent_id == ROOT_PARENT_ID:
            result = "/" + name
        else:
            result = resolve_path(parent_id).rstrip("/") + "/" + name
        path_cache[resource_id] = result
        return result

    entries: dict[str, ArchiveEntry] = {}
    for resource_id, info in file_infos.items():
        if resource_id not in resources:
            continue
        volume_id, offset, packed, unpacked, compression = info
        volume = volumes.get(volume_id)
        if not volume:
            continue
        path = resolve_path(resource_id)
        entries[path.lower()] = ArchiveEntry(
            path=path,
            volume=volume,
            offset=offset,
            packed_size=packed,
            unpacked_size=unpacked,
            compression_info=compression,
        )
    return build, entries


def find_entry(entries: dict[str, ArchiveEntry], names: Iterable[str]) -> ArchiveEntry:
    wanted = {name.lower().replace("\\", "/").lstrip("/") for name in names}
    matches = [
        entry
        for key, entry in entries.items()
        if key.lstrip("/") in wanted or key.rsplit("/", 1)[-1] in wanted
    ]
    if not matches:
        raise FileNotFoundError(" / ".join(names) + " 항목을 IDX에서 찾지 못했어요")
    matches.sort(key=lambda entry: (entry.path.count("/"), entry.path))
    return matches[0]


def _oodle_candidates(game_dir: Path, explicit: Path | None) -> Iterable[Path]:
    seen: set[str] = set()

    def emit(path: Path | None) -> Iterable[Path]:
        if path is None:
            return ()
        key = str(path).lower()
        if key in seen:
            return ()
        seen.add(key)
        return (path,)

    yield from emit(explicit)
    env_path = os.environ.get("WOWS_OODLE_DLL")
    yield from emit(Path(env_path) if env_path else None)

    for root in (
        game_dir,
        Path(r"D:\SteamLibrary\steamapps\common"),
        Path(r"C:\Program Files (x86)\Steam\steamapps\common"),
        Path(r"C:\Program Files\Steam\steamapps\common"),
    ):
        if not root.is_dir():
            continue
        try:
            for pattern in ("oo2core_9_win64.dll", "oo2core_8_win64.dll"):
                for candidate in root.rglob(pattern):
                    yield from emit(candidate)
        except OSError:
            continue


def find_oodle_dll(game_dir: Path, explicit: Path | None = None) -> Path:
    for candidate in _oodle_candidates(game_dir, explicit):
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "코라블리의 Oodle 압축을 풀 런타임을 찾지 못했어요. "
        "설정에서 oo2core_9_win64.dll 경로를 골라주세요."
    )


def _oodle_function(dll_path: Path):
    dll = ctypes.WinDLL(str(dll_path))
    func = dll.OodleLZ_Decompress
    func.restype = ctypes.c_longlong
    func.argtypes = [
        ctypes.c_void_p,
        ctypes.c_longlong,
        ctypes.c_void_p,
        ctypes.c_longlong,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_void_p,
        ctypes.c_longlong,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_longlong,
        ctypes.c_int,
    ]
    return func


def decompress_oodle_container(data: bytes, dll_path: Path) -> bytes:
    if len(data) < 56:
        raise ValueError("Oodle 컨테이너 헤더가 너무 짧아요")
    header_tail_size = struct.unpack_from("<Q", data, 0)[0]
    header_size = header_tail_size + 8
    version, container_type = struct.unpack_from("<II", data, 8)
    raw_total, packed_total = struct.unpack_from("<QQ", data, 16)
    chunk_count, chunk_raw_size = struct.unpack_from("<II", data, 32)
    if version not in range(8, 14) or container_type != 1:
        raise ValueError(f"지원하지 않는 Oodle 컨테이너예요: v{version}, type {container_type}")
    if header_size < 56 + chunk_count * 4 or header_size > len(data):
        raise ValueError("Oodle 청크 테이블이 올바르지 않아요")
    sizes = struct.unpack_from("<" + "I" * chunk_count, data, 56)
    if sum(sizes) != packed_total or header_size + packed_total > len(data):
        raise ValueError("Oodle 청크 크기가 파일과 맞지 않아요")

    decompress = _oodle_function(dll_path)
    result = bytearray()
    cursor = header_size
    remaining = raw_total
    for index, packed_size in enumerate(sizes):
        packed = data[cursor : cursor + packed_size]
        raw_size = min(chunk_raw_size, remaining)
        source = ctypes.create_string_buffer(packed)
        target = ctypes.create_string_buffer(raw_size)
        decoded = decompress(
            source,
            packed_size,
            target,
            raw_size,
            1,
            0,
            0,
            None,
            0,
            None,
            None,
            None,
            0,
            0,
        )
        if decoded != raw_size:
            raise RuntimeError(
                f"Oodle 청크 {index + 1}/{chunk_count} 복원 실패: {decoded} / {raw_size}"
            )
        result.extend(target.raw[:raw_size])
        cursor += packed_size
        remaining -= raw_size
    if remaining != 0:
        raise RuntimeError(f"Oodle 복원 후 {remaining}바이트가 남았어요")
    return bytes(result)


def extract_entry(
    game_dir: Path,
    entry: ArchiveEntry,
    *,
    oodle_dll: Path | None = None,
) -> bytes:
    package = game_dir / "res_packages" / entry.volume
    with package.open("rb") as stream:
        stream.seek(entry.offset)
        packed = stream.read(entry.packed_size)
    if len(packed) != entry.packed_size:
        raise OSError(f"패키지에서 {entry.path} 데이터를 끝까지 읽지 못했어요")
    if entry.packed_size == entry.unpacked_size:
        return packed

    for window_bits in (-15, 15):
        try:
            decoded = zlib.decompress(packed, window_bits)
            if len(decoded) == entry.unpacked_size:
                return decoded
        except zlib.error:
            pass

    dll = find_oodle_dll(game_dir, oodle_dll)
    decoded = decompress_oodle_container(packed, dll)
    if len(decoded) != entry.unpacked_size:
        raise ValueError(
            f"{entry.path} 복원 크기가 달라요: {len(decoded)} / {entry.unpacked_size}"
        )
    return decoded


class _Stub:
    def __new__(cls, *args, **kwargs):
        obj = object.__new__(cls)
        obj._args = args
        obj._kwargs = kwargs
        return obj

    def __setstate__(self, state):
        self._state = state


class GameParamsUnpickler(pickle.Unpickler):
    _classes: dict[tuple[str, str], type] = {}

    def find_class(self, module, name):
        module_name = module.decode("latin1") if isinstance(module, bytes) else str(module)
        class_name = name.decode("latin1") if isinstance(name, bytes) else str(name)
        if module_name in ("__builtin__", "builtins") and class_name in (
            "set",
            "frozenset",
        ):
            return getattr(builtins, class_name)
        key = (module_name, class_name)
        if key not in self._classes:
            self._classes[key] = type(class_name, (_Stub,), {})
        return self._classes[key]


def decode_game_params(raw: bytes) -> Any:
    payload = raw[4:] if raw.startswith(b"%bin") else raw
    try:
        pickle_bytes = zlib.decompress(payload[::-1])
    except zlib.error:
        pickle_bytes = payload
    return GameParamsUnpickler(io.BytesIO(pickle_bytes), encoding="bytes").load()


def to_plain(value: Any, memo: dict[int, Any] | None = None) -> Any:
    if memo is None:
        memo = {}
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    object_id = id(value)
    if object_id in memo:
        return memo[object_id]
    if isinstance(value, dict):
        result: dict[Any, Any] = {}
        memo[object_id] = result
        for key, item in value.items():
            result[to_plain(key, memo)] = to_plain(item, memo)
        return result
    if isinstance(value, list):
        result: list[Any] = []
        memo[object_id] = result
        result.extend(to_plain(item, memo) for item in value)
        return result
    if isinstance(value, tuple):
        return tuple(to_plain(item, memo) for item in value)
    if isinstance(value, (set, frozenset)):
        return [to_plain(item, memo) for item in value]
    if isinstance(value, _Stub):
        state = getattr(value, "_state", None)
        if state is not None:
            placeholder: dict[Any, Any] = {}
            memo[object_id] = placeholder
            converted = to_plain(state, memo)
            if isinstance(converted, dict):
                placeholder.update(converted)
                return placeholder
            return converted
        return [to_plain(item, memo) for item in getattr(value, "_args", ())]
    return str(value)


def root_params(decoded: Any) -> dict[str, Any]:
    if isinstance(decoded, (list, tuple)) and decoded and isinstance(decoded[0], dict):
        source = decoded[0]
    elif isinstance(decoded, dict):
        if "" in decoded and isinstance(decoded[""], dict):
            source = decoded[""]
        elif b"" in decoded and isinstance(decoded[b""], dict):
            source = decoded[b""]
        else:
            source = decoded
    else:
        raise ValueError("알 수 없는 GameParams 루트 구조예요")
    plain = to_plain(source)
    if not isinstance(plain, dict):
        raise ValueError("GameParams 루트가 사전 형식이 아니에요")
    return plain


def write_compat_game_params(params: dict[str, Any], destination: Path) -> None:
    payload = pickle.dumps((params, []), protocol=2)
    encoded = b"%bin" + zlib.compress(payload, 3)[::-1]
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + f".{os.getpid()}.part")
    temporary.write_bytes(encoded)
    try:
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def prepare_korabli_cache(
    game_dir: Path,
    cache_root: Path,
    *,
    oodle_dll: Path | None = None,
) -> dict[str, Any]:
    build, entries = read_archive_index(game_dir)
    cache_dir = cache_root / str(build)
    cache_dir.mkdir(parents=True, exist_ok=True)
    params_path = cache_dir / "GameParams_compat.data"
    assets_path = cache_dir / "assets.bin"
    manifest_path = cache_dir / "cache.json"

    source_stamp = max(
        path.stat().st_mtime_ns
        for path in (game_dir / "bin" / str(build) / "idx").glob("*.idx")
    )
    if manifest_path.is_file() and params_path.is_file() and assets_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            cached_oodle = Path(str(manifest.get("oodle_dll") or ""))
            if (
                manifest.get("build") == build
                and manifest.get("source_stamp") == source_stamp
                and params_path.stat().st_size == manifest.get("params_size")
                and assets_path.stat().st_size == manifest.get("assets_size")
                and cached_oodle.is_file()
            ):
                progress("cache", 100, "코라블리 변환 캐시를 재사용해요")
                prune_old_build_caches(cache_root, build)
                return {
                    "build": build,
                    "game_params": str(params_path),
                    "assets_bin": str(assets_path),
                    "oodle_dll": manifest.get("oodle_dll", ""),
                    "cached": True,
                }
        except (OSError, ValueError):
            pass

    progress("cache", 5, "코라블리 GameParams를 읽는 중")
    game_params_entry = find_entry(entries, ("GameParams_py2.data", "GameParams.data"))
    raw_params = extract_entry(game_dir, game_params_entry, oodle_dll=oodle_dll)
    params = root_params(decode_game_params(raw_params))
    progress("cache", 38, f"함선/장비 데이터 {len(params):,}개를 변환하는 중")
    write_compat_game_params(params, params_path)

    progress("cache", 44, "코라블리 assets.bin의 Oodle 청크를 복원하는 중")
    assets_entry = find_entry(entries, ("assets.bin",))
    assets = extract_entry(game_dir, assets_entry, oodle_dll=oodle_dll)
    assets_temporary = assets_path.with_suffix(
        assets_path.suffix + f".{os.getpid()}.part"
    )
    assets_temporary.write_bytes(assets)
    try:
        os.replace(assets_temporary, assets_path)
    finally:
        assets_temporary.unlink(missing_ok=True)
    dll = find_oodle_dll(game_dir, oodle_dll)

    manifest = {
        "build": build,
        "source_stamp": source_stamp,
        "params_size": params_path.stat().st_size,
        "assets_size": len(assets),
        "oodle_dll": str(dll),
    }
    manifest_temporary = manifest_path.with_suffix(
        manifest_path.suffix + f".{os.getpid()}.part"
    )
    manifest_temporary.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    try:
        os.replace(manifest_temporary, manifest_path)
    finally:
        manifest_temporary.unlink(missing_ok=True)
    progress("cache", 100, "코라블리 변환 캐시 준비 완료")
    prune_old_build_caches(cache_root, build)
    return {
        "build": build,
        "game_params": str(params_path),
        "assets_bin": str(assets_path),
        "oodle_dll": str(dll),
        "cached": False,
    }
