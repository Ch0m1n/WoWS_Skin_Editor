from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from cache_retention import prune_old_build_caches

from game_archive import (
    decode_game_params,
    extract_entry,
    find_entry,
    progress,
    read_archive_index,
    root_params,
    write_compat_game_params,
)


def prepare_game_params_cache(
    game_dir: Path,
    cache_root: Path,
    source: str,
) -> dict[str, Any]:
    build, entries = read_archive_index(game_dir)
    cache_dir = cache_root / source / str(build)
    cache_dir.mkdir(parents=True, exist_ok=True)
    destination = cache_dir / "GameParams_compat.data"
    manifest_path = cache_dir / "params_cache.json"
    source_stamp = max(
        path.stat().st_mtime_ns
        for path in (game_dir / "bin" / str(build) / "idx").glob("*.idx")
    )
    if destination.is_file() and manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            if (
                manifest.get("build") == build
                and manifest.get("source_stamp") == source_stamp
                and destination.stat().st_size == manifest.get("size")
            ):
                progress("cache", 100, "GameParams 변환 캐시를 재사용해요")
                if source == "pc":
                    prune_old_build_caches(cache_root / source, build)
                return {
                    "build": build,
                    "game_params": str(destination),
                    "cached": True,
                }
        except (OSError, ValueError):
            pass

    progress("cache", 12, "GameParams 호환 캐시를 만드는 중")
    entry = find_entry(entries, ("GameParams.data", "GameParams_py2.data"))
    raw = extract_entry(game_dir, entry)
    params = root_params(decode_game_params(raw))
    write_compat_game_params(params, destination)
    manifest = {
        "build": build,
        "source_stamp": source_stamp,
        "size": destination.stat().st_size,
        "param_count": len(params),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if source == "pc":
        prune_old_build_caches(cache_root / source, build)
    progress("cache", 100, f"GameParams {len(params):,}개 변환 완료")
    return {
        "build": build,
        "game_params": str(destination),
        "cached": False,
    }
