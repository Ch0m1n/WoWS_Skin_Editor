"""Build-specific hull material classification; code names are never a detector."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from game_archive import extract_entry, find_entry

SHIP_MATERIAL_CATALOG_VERSION = 2


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".part", delete=False) as file:
        temporary = Path(file.name)
        file.write(json.dumps(value, ensure_ascii=False).encode("utf-8"))
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _source_identity(game: Path, build: int) -> dict[str, Any]:
    indexes = sorted((game / "bin" / str(build) / "idx").glob("*.idx"))
    return {
        "game": str(game.resolve()).casefold(),
        "build": build,
        "indexes": [[p.name, p.stat().st_size, p.stat().st_mtime_ns] for p in indexes],
    }


def annotate_ship_materials(
    rows: list[dict[str, Any]], game: Path, build: int, entries: dict,
    *, cache_root: Path | None = None, backend_root: Path | None = None,
    refresh: bool = False, refresh_models: set[str] | None = None,
) -> None:
    """Failure preserves a usable catalog with explicit unknown status.

    Cache identity includes install path, build, all IDX stamps, requested models
    and probe binary hash. Explicit refresh retries unresolved models as well.
    """
    for row in rows:
        row.update(ShipMaterialCatalogVersion=SHIP_MATERIAL_CATALOG_VERSION,
                   ShipMaterialStatus="unknown", ShipMaterialEvidence=[],
                   ShipMaterialReason="Material scan unavailable",
                   ShipMaterialDiagnostic="scan_unavailable", ShipMaterialErrors=[],
                   ShipMaterialCheckedCount=0, ShipMaterialVisualCount=0)
        row.update(ShipMaterialIndexStamp="", ShipMaterialProbeHash="")
    models = sorted({row.get("ModelPath", "") for row in rows if row.get("ModelPath")})
    if not models:
        return
    phase = "source_unavailable"
    try:
        backend = backend_root or Path(__file__).resolve().parent
        probe = backend / "ship_material_probe.exe"
        source = _source_identity(game, build)
        install_token = hashlib.sha256(source["game"].replace("\\", "/").rstrip("/").encode("utf-8")).hexdigest()
        stamp = "|".join(f"{name}:{size}:{mtime // 1000000}" for name, size, mtime in source["indexes"])
        for row in rows:
            row["ShipMaterialIndexStamp"] = stamp
            row["ShipMaterialInstallToken"] = install_token
        root = cache_root or Path(os.environ.get("LOCALAPPDATA", str(game.parent))) / "WoWSToolbox" / "Cache"
        directory = root / "Korabli" / str(build)
        directory.mkdir(parents=True, exist_ok=True)
        phase = "helper_missing"
        identity = dict(source, version=SHIP_MATERIAL_CATALOG_VERSION, models=models,
                        probe=hashlib.sha256(probe.read_bytes()).hexdigest())
        stamp = "|".join(f"{name}:{size}:{mtime // 1000000}" for name, size, mtime in source["indexes"])
        for row in rows:
            row.update(ShipMaterialProbeHash=identity["probe"], ShipMaterialIndexStamp=stamp)
        cache = directory / "ship_materials.json"
        results = None
        if cache.is_file() and (not refresh or refresh_models is not None):
            try:
                saved = json.loads(cache.read_text(encoding="utf-8"))
                if saved.get("identity") == identity:
                    _validate_results(saved["models"], models)
                    results = saved["models"]
            except (OSError, ValueError, KeyError, TypeError):
                pass
        if results is None or refresh_models is not None:
            scan_models = sorted(set(models) & refresh_models) if refresh_models is not None else models
            baseline = results or {model: {"status": "unknown", "errors": ["not inspected"], "materials_checked": 0} for model in models}
            # Decode from this installation on the first scan of a new identity.
            # Only the small classification JSON persists; avoid a second 200+ MB
            # assets cache and stale same-build data from another installation.
            with tempfile.TemporaryDirectory(dir=directory, prefix="material-probe-") as request_dir:
                request = Path(request_dir) / "models.json"
                request.write_text(json.dumps(scan_models), encoding="utf-8")
                assets = Path(request_dir) / "assets.bin"
                phase = "assets_failed"
                assets.write_bytes(extract_entry(game, find_entry(entries, ("assets.bin",))))
                phase = "probe_failed"
                process = subprocess.run([str(probe), str(assets), str(request)],
                                         capture_output=True, text=True, encoding="utf-8",
                                         check=True, timeout=120)
            phase = "response_invalid"
            payload = json.loads(process.stdout)
            if payload.get("schema") != "ship-material-probe/v1":
                raise ValueError("Unsupported material probe response")
            scanned = payload["models"]
            _validate_results(scanned, scan_models)
            results = dict(baseline, **scanned)
            if any(value["status"] != "unknown" for value in results.values()):
                _atomic_json(cache, {"identity": identity, "models": results})
        _validate_results(results, models)
        for row in rows:
            result = results.get(row.get("ModelPath", ""))
            if result is None:
                row["ShipMaterialReason"] = "Hull model unavailable"
                row["ShipMaterialDiagnostic"] = "model_missing"
                continue
            errors = result.get("errors", [])
            diagnostic = "partial_inspection" if errors and result["status"] == "indexed" else (
                "inspection_incomplete" if result["status"] == "unknown" else "verified")
            if result["status"] == "unknown" and "model not found" in errors:
                diagnostic = "model_missing"
            elif result["status"] == "unknown" and "unsupported material prototype" in errors:
                diagnostic = "layout_unsupported"
            row.update(ShipMaterialStatus=result["status"],
                       ShipMaterialInspectionScope=result.get("inspection_scope", "selected_visual"),
                       ShipMaterialEvidence=result.get("indexed_materials", []),
                       ShipMaterialReason="; ".join(errors),
                       ShipMaterialErrors=errors, ShipMaterialDiagnostic=diagnostic,
                       ShipMaterialCheckedCount=result.get("materials_checked", 0),
                       ShipMaterialVisualCount=result.get("visuals_checked", 0))
    except (OSError, RuntimeError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        for row in rows:
            if refresh_models is not None and row.get("ModelPath") not in refresh_models and 'baseline' in locals():
                previous = baseline.get(row.get("ModelPath"), {})
                row.update(ShipMaterialStatus=previous.get("status", "unknown"),
                           ShipMaterialReason="; ".join(previous.get("errors", [])),
                           ShipMaterialErrors=previous.get("errors", []),
                           ShipMaterialDiagnostic="verified" if not previous.get("errors") and previous.get("status") != "unknown" else "inspection_incomplete",
                           ShipMaterialInspectionScope=previous.get("inspection_scope", "selected_visual"),
                           ShipMaterialVisualCount=previous.get("visuals_checked", 0),
                           ShipMaterialEvidence=previous.get("indexed_materials", []),
                           ShipMaterialCheckedCount=previous.get("materials_checked", 0))
                continue
            row.update(ShipMaterialStatus="unknown", ShipMaterialEvidence=[],
                       ShipMaterialDiagnostic=phase,
                       ShipMaterialReason="Material scan unavailable",
                       ShipMaterialErrors=[], ShipMaterialCheckedCount=0, ShipMaterialVisualCount=0)
        print(f"[WARN] Ship 2.0 material scan unavailable: {error}", file=sys.stderr)


def _validate_results(results: Any, models: list[str]) -> None:
    if not isinstance(results, dict) or set(results) != set(models):
        raise ValueError("Incomplete material probe response")
    for result in results.values():
        if not isinstance(result, dict) or result.get("status") not in {"indexed", "legacy", "unknown"}:
            raise ValueError("Invalid material probe status")
        evidence = result.get("indexed_materials", [])
        if not isinstance(evidence, list) or not all(isinstance(p, str) for p in evidence):
            raise ValueError("Invalid material evidence")
        if result["status"] == "indexed" and not evidence:
            raise ValueError("Indexed material status needs evidence")
        count = result.get("materials_checked", 0)
        errors = result.get("errors", [])
        if not isinstance(count, int) or count < 0 or not isinstance(errors, list) or not all(isinstance(e, str) for e in errors):
            raise ValueError("Invalid material diagnostics")
        if result["status"] == "legacy" and (count == 0 or errors):
            raise ValueError("Traditional status needs a complete material inspection")
