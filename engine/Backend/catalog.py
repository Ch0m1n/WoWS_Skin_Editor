from __future__ import annotations

import argparse
import json
import re
import subprocess
import xml.etree.ElementTree as ET
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

from blitz_assets import blitz_catalog  # noqa: E402
from mo_reader import MoCatalog, read_mo  # noqa: E402
from ship_materials import annotate_ship_materials  # noqa: E402
from game_archive import (  # noqa: E402
    decode_game_params,
    extract_entry,
    find_entry,
    latest_build,
    read_archive_index,
    root_params,
)


NATION_KO = {
    "USA": "미국",
    "Japan": "일본",
    "USSR": "소련",
    "Russia": "소련",
    "Germany": "독일",
    "UK": "영국",
    "United_Kingdom": "영국",
    "France": "프랑스",
    "Italy": "이탈리아",
    "PanAsia": "범아시아",
    "Pan_Asia": "범아시아",
    "PanAmerica": "범아메리카",
    "Pan_America": "범아메리카",
    "Europe": "유럽",
    "Commonwealth": "영연방",
    "Netherlands": "네덜란드",
    "Spain": "스페인",
    "Soviet_Russia": "소련",
}

CLASS_KO = {
    "Battleship": "전함",
    "Cruiser": "순양함",
    "Destroyer": "구축함",
    "AirCarrier": "항공모함",
    "AircraftCarrier": "항공모함",
    "Submarine": "잠수함",
    "Auxiliary": "보조함",
}


# Increment when the per-ship camouflage payload changes. Cached catalog rows
# carry this marker so the GUI can rebuild old files that already contained an
# empty Camouflages array and would otherwise look current.
CAMOUFLAGE_CATALOG_VERSION = 2


def _translation(game_dir: Path, language: str) -> tuple[MoCatalog, str]:
    build, _ = latest_build(game_dir)
    languages = [language, "ko", "en", "ru"]
    seen: set[str] = set()
    for token in languages:
        if token in seen:
            continue
        seen.add(token)
        mo = (
            game_dir
            / "bin"
            / str(build)
            / "res"
            / "texts"
            / token
            / "LC_MESSAGES"
            / "global.mo"
        )
        if mo.is_file():
            return read_mo(mo), token
    return MoCatalog(), "internal"


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _model_path(value: Any) -> str:
    if isinstance(value, str) and value.lower().endswith(".model"):
        return value
    if isinstance(value, dict):
        preferred = value.get("model")
        if isinstance(preferred, str) and preferred.lower().endswith(".model"):
            return preferred
        for item in value.values():
            found = _model_path(item)
            if found:
                return found
    if isinstance(value, (list, tuple)):
        for item in value:
            found = _model_path(item)
            if found:
                return found
    return ""


def _string_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (list, tuple)):
        return [item for item in value if isinstance(item, str) and item]
    return []


def _pc_hull_candidates(data: dict[str, Any]) -> list[tuple[str, str, str]]:
    """Return (upgrade, component, model path) in deterministic loadout order."""
    candidates: list[tuple[str, str, str]] = []
    upgrades = _dict(data.get("ShipUpgradeInfo"))
    for upgrade_name, upgrade_value in sorted(
        upgrades.items(), key=lambda item: str(item[0])
    ):
        upgrade = _dict(upgrade_value)
        if upgrade.get("ucType") != "_Hull":
            continue
        components = _dict(upgrade.get("components"))
        for component_name in _string_values(components.get("hull")):
            component = _dict(data.get(component_name))
            model_path = component.get("model")
            if isinstance(model_path, str) and model_path.lower().endswith(".model"):
                candidates.append((str(upgrade_name), component_name, model_path))

    # A few special/event records do not expose ShipUpgradeInfo. Only accept a
    # direct ship model here; recursively scanning the whole record can mistake
    # a finder, director, or weapon model for the hull.
    if not candidates:
        direct_model = data.get("model")
        if (
            isinstance(direct_model, str)
            and direct_model.lower().endswith(".model")
            and "/ship/" in direct_model.replace("\\", "/").lower()
        ):
            candidates.append(("", "", direct_model))

    seen: set[tuple[str, str]] = set()
    result: list[tuple[str, str, str]] = []
    for upgrade_name, component_name, model_path in candidates:
        marker = (upgrade_name.casefold(), model_path.replace("\\", "/").casefold())
        if marker not in seen:
            seen.add(marker)
            result.append((upgrade_name, component_name, model_path))
    return result


def _model_geometry_directory(model_path: str) -> str:
    normalized = model_path.replace("\\", "/").strip().lower()
    if not normalized:
        return ""
    directory = normalized.rsplit("/", 1)[0]
    return "/" + directory.lstrip("/")


def _fallback_name(param_key: str, index: str) -> str:
    tail = param_key
    if tail.startswith(index + "_"):
        tail = tail[len(index) + 1 :]
    elif "_" in tail:
        tail = tail.split("_", 1)[1]
    return tail.replace("_", " ").strip() or index


def _rgba_values(value: str | None) -> list[float]:
    if not value:
        return []
    try:
        return [float(item) for item in value.split()[:4]]
    except ValueError:
        return []


def _rgb_hex(values: list[float]) -> str:
    if len(values) < 3:
        return ""
    channels = [max(0, min(255, round(channel * 255))) for channel in values[:3]]
    return "#" + "".join(f"{channel:02X}" for channel in channels)


def _camouflage_database(raw: bytes) -> dict[str, Any]:
    try:
        root = ET.fromstring(raw)
    except (ET.ParseError, ValueError):
        return {"Groups": {}, "Entries": {}}

    groups: dict[str, set[str]] = {}
    groups_node = root.find("shipgroups.xml")
    if groups_node is not None:
        for group_node in groups_node:
            ships = group_node.findtext("ships") or ""
            groups[group_node.tag] = {
                ship.casefold() for ship in ships.split() if ship
            }

    palettes: dict[str, list[str]] = {}
    palettes_node = root.find("colorschemes.xml")
    if palettes_node is not None:
        for scheme_node in palettes_node.findall("colorScheme"):
            name = (scheme_node.findtext("name") or "").strip()
            if not name:
                continue
            palette = [
                _rgb_hex(_rgba_values(scheme_node.findtext(f"color{index}")))
                for index in range(4)
            ]
            palettes[name.casefold()] = [color for color in palette if color]

    entries: dict[str, list[dict[str, Any]]] = {}
    camos_node = root.find("camouflages.xml")
    if camos_node is None:
        return {"Groups": groups, "Entries": entries}

    for camo_node in camos_node.findall("camouflage"):
        name = (camo_node.findtext("name") or "").strip()
        if not name:
            continue
        targets = {
            ship.casefold()
            for node in camo_node.findall("targetShip")
            for ship in (node.text or "").split()
            if ship
        }
        ship_groups = {
            group
            for group in (camo_node.findtext("shipGroups") or "").split()
            if group
        }
        color_schemes: list[dict[str, Any]] = []
        seen_colors: set[str] = set()
        for order, color_node in enumerate(camo_node.findall("colorSchemes"), 1):
            color_id = ((color_node.text or "").strip().split() or [""])[0]
            marker = color_id.casefold()
            if not color_id or marker in seen_colors:
                continue
            seen_colors.add(marker)
            palette = palettes.get(marker, [])
            preview = _rgb_hex(_rgba_values(color_node.findtext("colorUI")))
            if not preview and palette:
                preview = palette[0]
            color_schemes.append(
                {
                    "Id": color_id,
                    "Order": order,
                    "PreviewColor": preview,
                    "Palette": palette,
                }
            )
        tiled = (camo_node.findtext("tiled") or "").strip().casefold() == "true"
        uses_palette = (
            (camo_node.findtext("useColorScheme") or "").strip().casefold()
            == "true"
        )
        if not tiled and not uses_palette:
            color_schemes = []

        entries.setdefault(name.casefold(), []).append(
            {
                "Targets": targets,
                "Groups": ship_groups,
                "ColorSchemes": color_schemes,
            }
        )

    return {"Groups": groups, "Entries": entries}


def _camouflage_color_schemes(
    database: dict[str, Any] | None,
    camouflage_name: str,
    ship_param_name: str,
) -> list[dict[str, Any]]:
    if not database or not camouflage_name:
        return []
    variants = _dict(database.get("Entries")).get(camouflage_name.casefold(), [])
    if not isinstance(variants, list):
        return []
    selector = ship_param_name.casefold()

    if selector:
        for variant in variants:
            if selector in variant.get("Targets", set()):
                return list(variant.get("ColorSchemes", []))

        groups = _dict(database.get("Groups"))
        for variant in variants:
            for group in variant.get("Groups", set()):
                members = groups.get(group, set())
                if selector in members:
                    return list(variant.get("ColorSchemes", []))

    for variant in variants:
        if not variant.get("Targets") and not variant.get("Groups"):
            return list(variant.get("ColorSchemes", []))
    return []


def _pc_camouflages(
    vehicle: dict[str, Any],
    params_by_name: dict[str, dict[str, Any]],
    params_by_index: dict[str, dict[str, Any]],
    translations: MoCatalog,
    ship_param_name: str = "",
    camouflage_database: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Return permanent camouflage choices attached to one ship.

    GameParams vehicle records reference Exterior records through
    permoflages. The Exterior parameter name is the stable identifier passed
    to the native exporter; the translated display name is UI-only.
    """
    choices: list[dict[str, Any]] = []
    seen: set[str] = set()
    for reference in _string_values(vehicle.get("permoflages")):
        exterior = params_by_name.get(reference) or params_by_index.get(reference)
        if not exterior:
            continue

        stable_id = str(exterior.get("name") or reference).strip()
        if not stable_id or stable_id.casefold() in seen:
            continue
        seen.add(stable_id.casefold())

        scheme = str(exterior.get("camouflage") or "").strip()
        ids = f"IDS_{stable_id.upper()}"
        localized = translations.gettext(ids)
        if not localized or not localized.strip() or localized == ids:
            localized = _fallback_name(stable_id, str(exterior.get("index") or ""))
        else:
            localized = localized.strip()

        type_info = _dict(exterior.get("typeinfo"))
        choices.append(
            {
                "Id": stable_id,
                "Name": localized,
                "Scheme": scheme,
                "Index": str(exterior.get("index") or ""),
                "Species": str(type_info.get("species") or ""),
                "Nation": str(type_info.get("nation") or ""),
                "ColorSchemes": _camouflage_color_schemes(
                    camouflage_database,
                    scheme,
                    ship_param_name,
                ),
            }
        )

    choices.sort(key=lambda item: (item["Name"].casefold(), item["Id"].casefold()))
    return choices


def pc_catalog(game_dir: Path, language: str, source: str, *, cache_root: Path | None = None, refresh_materials: bool = False, refresh_models: set[str] | None = None) -> list[dict[str, Any]]:
    build, entries = read_archive_index(game_dir)
    entry = find_entry(entries, ("GameParams.data", "GameParams_py2.data"))
    raw = extract_entry(game_dir, entry)
    params = root_params(decode_game_params(raw))
    translations, translation_language = _translation(game_dir, language)
    params_by_name: dict[str, dict[str, Any]] = {}
    camouflage_database: dict[str, Any] = {"Groups": {}, "Entries": {}}
    camouflage_entry = next(
        (
            value
            for key, value in entries.items()
            if key.casefold() == "/camouflages.xml"
        ),
        None,
    )
    if camouflage_entry is not None:
        camouflage_database = _camouflage_database(
            extract_entry(game_dir, camouflage_entry)
        )
    params_by_index: dict[str, dict[str, Any]] = {}
    for param_key, param_value in params.items():
        param_data = _dict(param_value)
        param_name = str(param_data.get("name") or param_key).strip()
        param_index = str(param_data.get("index") or "").strip()
        if param_name:
            params_by_name.setdefault(param_name, param_data)
        if param_index:
            params_by_index.setdefault(param_index, param_data)
    geometry_directories = {
        key.rsplit("/", 1)[0]
        for key in entries
        if key.endswith(".geometry") and "/ship/" in key
    }

    rows: list[dict[str, Any]] = []
    for param_key, param_value in params.items():
        data = _dict(param_value)
        type_info = _dict(data.get("typeinfo"))
        if type_info.get("type") != "Ship":
            continue

        index = str(data.get("index") or str(param_key).split("_", 1)[0])
        internal_name = str(data.get("name") or param_key)
        ids = f"IDS_{index}"
        localized = translations.gettext(ids)
        if not localized or not localized.strip() or localized == ids:
            localized = _fallback_name(str(param_key), index)
        else:
            localized = localized.strip()

        nation_raw = str(type_info.get("nation") or "")
        class_raw = str(type_info.get("species") or "")
        tier_value = data.get("level")
        try:
            tier = int(tier_value)
        except (TypeError, ValueError):
            tier = 0

        hull_candidates = _pc_hull_candidates(data)
        selected_hull = next(
            (
                candidate
                for candidate in hull_candidates
                if _model_geometry_directory(candidate[2]) in geometry_directories
            ),
            None,
        )
        supported = selected_hull is not None
        diagnostic_hull = selected_hull or (
            hull_candidates[0] if hull_candidates else ("", "", "")
        )
        hull_upgrade, hull_component, model_path = diagnostic_hull
        resource = ""
        if model_path:
            normalized = model_path.replace("\\", "/")
            parts = normalized.rsplit("/", 2)
            resource = parts[-2] if len(parts) >= 2 else Path(normalized).stem

        rows.append(
            {
                "Source": source,
                "Build": build,
                "ShipCode": index,
                "LocalizedName": localized,
                "LocalizedLanguage": translation_language,
                "InternalName": internal_name,
                "VariantLabel": _fallback_name(str(param_key), index),
                "ShipResource": resource or internal_name,
                "Nation": NATION_KO.get(nation_raw, nation_raw or "기타"),
                "NationRaw": nation_raw,
                "ShipClass": CLASS_KO.get(class_raw, class_raw or "기타"),
                "ShipClassRaw": class_raw,
                "Tier": tier,
                "GameParamsKey": str(param_key),
                "GameParamsIndex": index,
                "ModelPath": model_path,
                "HullUpgrade": hull_upgrade,
                "HullComponent": hull_component,
                "Id": data.get("id"),
                "Supported": supported,
                "ArchiveHullVerified": supported,
                "CamouflageCatalogVersion": CAMOUFLAGE_CATALOG_VERSION,
                "Camouflages": _pc_camouflages(
                    data,
                    params_by_name,
                    params_by_index,
                    translations,
                    ship_param_name=internal_name,
                    camouflage_database=camouflage_database,
                ),
                "UnsupportedReason": (
                    "현재 게임 빌드에 선체 geometry가 없어요"
                    if hull_candidates and not supported
                    else "선체 모델 정보를 찾지 못했어요"
                    if not hull_candidates
                    else ""
                ),
            }
        )

    if source == "korabli":
        annotate_ship_materials(rows, game_dir, build, entries, cache_root=cache_root, refresh=refresh_materials, refresh_models=refresh_models)

    rows.sort(
        key=lambda row: (
            row["LocalizedName"].casefold(),
            row["Tier"],
            row["ShipCode"],
        )
    )
    return rows


def legends_catalog(
    toolbox_root: Path, game_dir: Path, language: str
) -> list[dict[str, Any]]:
    script = toolbox_root / "BlenderExtractor" / "geometry_decoder" / "ship_catalog.py"
    process = subprocess.run(
        [
            sys.executable,
            "-B",
            str(script),
            "--game-dir",
            str(game_dir),
            "--language",
            language,
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    legacy_rows = json.loads(process.stdout)
    rows: list[dict[str, Any]] = []
    for legacy in legacy_rows:
        ship_code = str(legacy.get("ship_code") or "")
        resource = str(legacy.get("hull_resource") or "")
        game_params_key = str(legacy.get("game_params_key") or "").strip()
        if not game_params_key:
            suffix_match = re.match(r"^[A-Z]S[A-Z]\d+_(.+)$", resource)
            suffix = suffix_match.group(1) if suffix_match else resource
            game_params_key = (
                f"{ship_code}_{suffix}" if ship_code and suffix else ship_code
            )
        variant = str(
            legacy.get("variant_label")
            or legacy.get("display_label")
            or resource
            or ship_code
        )
        localized = str(legacy.get("localized_name") or "").strip() or variant
        nation_raw = str(legacy.get("nation") or "")
        class_raw = str(legacy.get("class") or "")
        nation = NATION_KO.get(nation_raw, nation_raw or "기타")
        ship_class = CLASS_KO.get(class_raw, class_raw or "기타")
        tier_value = legacy.get("tier")
        try:
            tier = int(tier_value) if tier_value is not None else 0
        except (TypeError, ValueError):
            tier = 0
        rows.append(
            {
                "Source": "legends",
                "Build": "",
                "ShipCode": ship_code,
                "LocalizedName": localized,
                "LocalizedLanguage": str(legacy.get("localized_language") or language),
                "InternalName": game_params_key or resource,
                "VariantLabel": variant,
                "ShipResource": resource,
                "Nation": nation,
                "NationRaw": str(legacy.get("nation_code") or nation_raw),
                "ShipClass": ship_class,
                "ShipClassRaw": str(legacy.get("class_code") or class_raw),
                "Tier": tier,
                "GameParamsKey": game_params_key,
                "GameParamsIndex": ship_code,
                "ModelPath": str(
                    legacy.get("model_path") or legacy.get("hull_resource_path") or ""
                ),
                "Id": legacy.get("id"),
                "Supported": bool(legacy.get("selectable")),
                "ArchiveHullVerified": bool(legacy.get("selectable")),
                "HullComponent": str(legacy.get("hull_component") or ""),
                "UnsupportedReason": str(legacy.get("support_reason") or ""),
                "CamouflageCatalogVersion": CAMOUFLAGE_CATALOG_VERSION,
                "Camouflages": [],
            }
        )
    rows.sort(
        key=lambda row: (
            row["LocalizedName"].casefold(),
            row["Tier"],
            row["ShipCode"],
        )
    )
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description="WoWS Toolbox unified ship catalog")
    parser.add_argument("--source", choices=("legends", "pc", "korabli", "blitz"), required=True)
    parser.add_argument("--game-dir", type=Path, required=True)
    parser.add_argument("--toolbox-root", type=Path, required=True)
    parser.add_argument("--language", default="ko")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--cache-root", type=Path)
    parser.add_argument("--refresh-materials", action="store_true")
    parser.add_argument("--material-models", type=Path)
    args = parser.parse_args()

    if args.source == "legends":
        rows = legends_catalog(args.toolbox_root, args.game_dir, args.language)
    elif args.source == "blitz":
        rows = blitz_catalog(args.game_dir, args.language)
    else:
        selected = None
        if args.material_models:
            selected = json.loads(args.material_models.read_text(encoding="utf-8"))
            if not isinstance(selected, list) or not all(isinstance(path, str) for path in selected):
                raise ValueError("Invalid selected material model list")
        rows = pc_catalog(args.game_dir, args.language, args.source, cache_root=args.cache_root,
                          refresh_materials=args.refresh_materials, refresh_models=set(selected) if selected is not None else None)

    if args.cache_root:
        from workbench import save_snapshot
        try:
            save_snapshot(rows, args.cache_root.parent, args.source)
        except (OSError, ValueError) as error:
            print(f"[WARN] Catalog snapshot unavailable: {error}", file=sys.stderr)

    encoded = json.dumps(rows, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
        print(
            json.dumps(
                {"ok": True, "count": len(rows), "output": str(args.output)},
                ensure_ascii=False,
            )
        )
    else:
        print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
