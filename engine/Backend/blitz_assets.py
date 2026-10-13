from __future__ import annotations

from dataclasses import dataclass
import json
import re
from pathlib import Path
from typing import Any, Iterable


BODY_RE = re.compile(
    r"^(?P<ship>[a-z]{2}_(?:dd|ca|bb|cv|ss)_[a-z0-9_]+?)"
    r"(?:_(?P<variant>paint_\d+))?\.ab$",
    re.IGNORECASE,
)

NATION_BY_PREFIX = {
    "cn": "PanAsia",
    "cw": "Commonwealth",
    "eu": "Europe",
    "fr": "France",
    "ge": "Germany",
    "it": "Italy",
    "jp": "Japan",
    "nl": "Netherlands",
    "pa": "PanAmerica",
    "pl": "Europe",
    "ru": "Russia",
    "sp": "Spain",
    "uk": "UK",
    "us": "USA",
}

NATION_KO = {
    "Commonwealth": "영연방",
    "Europe": "유럽",
    "France": "프랑스",
    "Germany": "독일",
    "Italy": "이탈리아",
    "Japan": "일본",
    "Netherlands": "네덜란드",
    "PanAmerica": "범아메리카",
    "PanAsia": "범아시아",
    "Russia": "소련",
    "Spain": "스페인",
    "UK": "영국",
    "USA": "미국",
}

CLASS_BY_TOKEN = {
    "bb": "Battleship",
    "ca": "Cruiser",
    "cv": "AirCarrier",
    "dd": "Destroyer",
    "ss": "Submarine",
}

CLASS_KO = {
    "AirCarrier": "항공모함",
    "Battleship": "전함",
    "Cruiser": "순양함",
    "Destroyer": "구축함",
    "Submarine": "잠수함",
}


@dataclass(frozen=True)
class BlitzLayout:
    selected_root: Path
    bundle_root: Path
    obb_path: Path | None
    design_data: Path | None

    @property
    def body_root(self) -> Path:
        return self.bundle_root / "prefab" / "ship" / "body"


def _first_file(candidates: Iterable[Path]) -> Path | None:
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    return None


def resolve_blitz_layout(game_dir: Path, *, require_obb: bool = False) -> BlitzLayout:
    selected = game_dir.resolve()
    bundle_candidates = (
        selected,
        selected / "full_bundle",
        selected / "bundle",
        selected / "files" / "bundle",
    )
    bundle_root = next(
        (
            candidate.resolve()
            for candidate in bundle_candidates
            if (candidate / "prefab" / "ship" / "body").is_dir()
        ),
        None,
    )
    if bundle_root is None:
        raise FileNotFoundError(
            "WoWS Blitz 함선 번들 폴더를 찾지 못했어요. "
            "prefab/ship/body가 들어 있는 full_bundle 또는 bundle 폴더를 선택해 주세요."
        )

    search_roots = tuple(dict.fromkeys((selected, bundle_root.parent)))
    explicit_obb = [
        root / "main.obb"
        for root in search_roots
    ]
    explicit_obb.extend(
        root / "downloads" / "main.obb"
        for root in search_roots
    )
    obb = _first_file(explicit_obb)
    if obb is None:
        discovered: list[Path] = []
        for root in search_roots:
            discovered.extend(root.glob("main.*.obb"))
            downloads = root / "downloads"
            if downloads.is_dir():
                discovered.extend(downloads.glob("main.*.obb"))
        obb = _first_file(sorted(discovered, key=lambda item: item.name.casefold()))

    design_candidates: list[Path] = []
    for root in search_roots:
        design_candidates.extend(
            (
                root / "DesignData",
                root / "live_external" / "DesignData",
                root / "analysis" / "live_external" / "DesignData",
            )
        )
    design_data = _first_file(design_candidates)
    if require_obb and obb is None:
        raise FileNotFoundError(
            "WoWS Blitz 기본 OBB를 찾지 못했어요. full_bundle과 함께 "
            "main.*.net.wargaming.wows.blitz.obb를 선택 폴더나 downloads 폴더에 넣어 주세요."
        )
    return BlitzLayout(selected, bundle_root, obb, design_data)


def _load_unitypy() -> Any:
    try:
        import UnityPy
    except ImportError as exc:
        raise RuntimeError(
            "WoWS Blitz Unity 런타임이 설치되지 않았어요. "
            "WoWS Toolbox 정식 런타임에서 다시 실행해 주세요."
        ) from exc
    return UnityPy


def serialized_files(environment: Any) -> list[tuple[str, Any]]:
    found: list[tuple[str, Any]] = []
    visited: set[int] = set()

    def visit(name: str, item: Any) -> None:
        identity = id(item)
        if identity in visited:
            return
        visited.add(identity)
        if item.__class__.__name__ == "SerializedFile":
            found.append((name, item))
            return
        children = getattr(item, "files", None)
        if isinstance(children, dict):
            for child_name, child in children.items():
                visit(str(child_name), child)

    for name, item in getattr(environment, "files", {}).items():
        visit(str(name), item)
    return found


def reader_name(reader: Any) -> str:
    try:
        return str(reader.peek_name())
    except Exception:
        try:
            return str(reader.parse_as_object().m_Name)
        except Exception:
            return "unnamed"


def dereference(pointer: Any) -> Any | None:
    try:
        return pointer.deref()
    except Exception:
        return None


def _named_monobehaviours(design_data: Path) -> dict[str, Any]:
    environment = _load_unitypy().load(str(design_data))
    result: dict[str, Any] = {}
    for reader in environment.objects:
        if reader.type.name != "MonoBehaviour":
            continue
        name = reader_name(reader)
        if name:
            result[name] = reader
    return result


def _localization(reader: Any | None) -> dict[str, str]:
    if reader is None:
        return {}
    payload = reader.parse_as_dict()
    result: dict[str, str] = {}
    for group in payload.get("SerializableDataList", []):
        keys = group.get("Keys", [])
        values = group.get("Values", [])
        for key, value in zip(keys, values):
            token = str(key)
            if token and token not in result:
                result[token] = str(value)
    return result


def _body_variants(layout: BlitzLayout) -> dict[str, list[tuple[str, Path]]]:
    result: dict[str, list[tuple[str, Path]]] = {}
    for path in sorted(layout.body_root.glob("*.ab"), key=lambda item: item.name.casefold()):
        match = BODY_RE.match(path.name)
        if not match:
            continue
        ship = match.group("ship").lower()
        variant = (match.group("variant") or "default").lower()
        result.setdefault(ship, []).append((variant, path.resolve()))
    return result


def _ship_tokens(prefab: str) -> tuple[str, str]:
    parts = prefab.lower().split("_")
    nation = NATION_BY_PREFIX.get(parts[0], parts[0].upper()) if parts else ""
    ship_class = CLASS_BY_TOKEN.get(parts[1], parts[1].upper()) if len(parts) > 1 else ""
    return nation, ship_class


def _variant_choices(
    ship: str,
    variants: list[tuple[str, Path]],
    language: str,
) -> tuple[Path, list[dict[str, Any]]]:
    default_path = next((path for variant, path in variants if variant == "default"), variants[0][1])
    choices: list[dict[str, Any]] = []
    for variant, path in variants:
        if variant == "default":
            name = "기본 도색" if language == "ko" else "Default paint"
        else:
            number = variant.rsplit("_", 1)[-1]
            name = f"도색 {number}" if language == "ko" else f"Paint {number}"
        choices.append(
            {
                "Id": variant,
                "Name": name,
                "Scheme": path.name,
                "Index": "",
                "Species": "",
                "Nation": "",
                "ColorSchemes": [],
            }
        )
    choices.sort(key=lambda item: (item["Id"] != "default", item["Id"]))
    return default_path, choices


def _fallback_rows(
    layout: BlitzLayout,
    variants_by_ship: dict[str, list[tuple[str, Path]]],
    language: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for number, (ship, variants) in enumerate(variants_by_ship.items(), start=1):
        nation_raw, class_raw = _ship_tokens(ship)
        default_path, choices = _variant_choices(ship, variants, language)
        display = ship
        rows.append(
            {
                "Source": "blitz",
                "Build": "",
                "ShipCode": ship,
                "LocalizedName": display,
                "LocalizedLanguage": "internal",
                "InternalName": ship,
                "VariantLabel": display,
                "ShipResource": ship,
                "Nation": NATION_KO.get(nation_raw, nation_raw) if language == "ko" else nation_raw,
                "NationRaw": nation_raw,
                "ShipClass": CLASS_KO.get(class_raw, class_raw) if language == "ko" else class_raw,
                "ShipClassRaw": class_raw,
                "Tier": 0,
                "GameParamsKey": ship,
                "GameParamsIndex": str(number),
                "ModelPath": default_path.relative_to(layout.bundle_root).as_posix(),
                "Id": ship,
                "Supported": True,
                "ArchiveHullVerified": True,
                "CamouflageCatalogVersion": 2,
                "Camouflages": choices,
                "UnsupportedReason": "",
            }
        )
    return rows


def blitz_catalog(game_dir: Path, language: str) -> list[dict[str, Any]]:
    layout = resolve_blitz_layout(game_dir)
    variants_by_ship = _body_variants(layout)
    if not variants_by_ship:
        return []
    if layout.design_data is None:
        rows = _fallback_rows(layout, variants_by_ship, language)
        rows.sort(key=lambda item: item["LocalizedName"].casefold())
        return rows

    objects = _named_monobehaviours(layout.design_data)
    ship_database = objects.get("ShipDatabase")
    if ship_database is None:
        return _fallback_rows(layout, variants_by_ship, language)
    localization_name = "LocalizationDatabaseKOR" if language == "ko" else "LocalizationDatabaseEN"
    translations = _localization(objects.get(localization_name))
    payload = ship_database.parse_as_dict()
    database = payload.get("SerializableShipBaseInfo", {})
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for database_id, record in zip(database.get("Keys", []), database.get("Values", [])):
        introduction = record.get("Introduction", {})
        for level in record.get("LevelInfoList", []):
            prefab = str(level.get("Prefab") or "").strip()
            ship = prefab.lower()
            if not ship:
                continue
            identity = (str(level.get("ShipID") or database_id), ship)
            if identity in seen:
                continue
            seen.add(identity)
            variants = variants_by_ship.get(ship, [])
            supported = bool(variants)
            nation_raw, class_raw = _ship_tokens(ship)
            name_key = str(introduction.get("Name") or "")
            localized = translations.get(name_key, "").strip()
            if not localized:
                localized = str(level.get("DDNAName") or prefab).strip() or prefab
            default_path: Path | None = None
            choices: list[dict[str, Any]] = []
            if variants:
                default_path, choices = _variant_choices(ship, variants, language)
            rows.append(
                {
                    "Source": "blitz",
                    "Build": "",
                    "ShipCode": str(level.get("ShipID") or database_id),
                    "LocalizedName": localized,
                    "LocalizedLanguage": language if name_key in translations else "internal",
                    "InternalName": prefab,
                    "VariantLabel": prefab,
                    "ShipResource": ship,
                    "Nation": NATION_KO.get(nation_raw, nation_raw) if language == "ko" else nation_raw,
                    "NationRaw": nation_raw,
                    "ShipClass": CLASS_KO.get(class_raw, class_raw) if language == "ko" else class_raw,
                    "ShipClassRaw": class_raw,
                    "Tier": int(level.get("DescLevel") or level.get("Level") or 0),
                    "GameParamsKey": prefab,
                    "GameParamsIndex": str(level.get("ShipID") or database_id),
                    "ModelPath": (
                        default_path.relative_to(layout.bundle_root).as_posix()
                        if default_path is not None
                        else ""
                    ),
                    "Id": str(level.get("ShipID") or database_id),
                    "Supported": supported,
                    "ArchiveHullVerified": supported,
                    "CamouflageCatalogVersion": 2,
                    "Camouflages": choices,
                    "UnsupportedReason": "" if supported else "현재 번들에 함선 body가 없어요",
                }
            )
    rows.sort(
        key=lambda item: (
            item["LocalizedName"].casefold(),
            item["Tier"],
            item["ShipCode"],
        )
    )
    return rows


def layout_signature(layout: BlitzLayout) -> str:
    def stat_token(path: Path | None) -> str:
        if path is None or not path.exists():
            return ""
        stat = path.stat()
        return f"{path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}"

    marker = layout.bundle_root / "BundlePackInfo.bytes"
    return json.dumps(
        {
            "bundle": stat_token(marker if marker.is_file() else layout.body_root),
            "obb": stat_token(layout.obb_path),
        },
        sort_keys=True,
        ensure_ascii=False,
    )
