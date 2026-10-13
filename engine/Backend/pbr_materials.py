from __future__ import annotations

"""Supplement wowsunpack ship GLBs with the game's full-resolution PBR maps.

The bundled exporter deliberately embeds only base color images in its GLB.  This
module resolves the corresponding MFM asset paths, extracts the sibling `_n`,
`_mg`, and `_ao` textures, and publishes viewer/DCC friendly PNG channels.
"""

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import time
import tempfile
from pathlib import Path, PurePosixPath
from typing import Iterable

from PIL import Image, ImageChops, ImageFile, ImageOps, ImageStat

# Streamed WoWS/Korabli DDS payloads can omit a few tail bytes that the game
# decoder tolerates. Pillow is stricter by default, so accept those payloads
# instead of discarding every PBR channel for the material.
ImageFile.LOAD_TRUNCATED_IMAGES = True


MFM_LINE = re.compile(r"^\(A\)\s+(/.+\.mfm)\s+\d+\s+bytes\s*$", re.IGNORECASE)
MFM_STRIP_SUFFIXES = ("_skinned", "_wire", "_dead", "_blaze", "_alpha")
CHANNEL_SUFFIXES = {"normal": ("_n", "_alpha_n"), "metallic_gloss": ("_mg",), "ao": ("_ao",)}
SCHEMA = "wows-toolbox-pbr-materials/v6"
SELECTION_SCHEMA = "wows-toolbox-pbr-selection/v2"
PORTABLE_PBR_ROLES = frozenset(
    {"normal", "specular", "roughness", "metalness", "ao"}
)


def safe_name(value: str, fallback: str = "Texture") -> str:
    cleaned = re.sub(r"[^0-9A-Za-z가-힣_.()\[\] -]+", "_", value).strip(" ._")
    return (cleaned or fallback)[:120]


def readable_publish_stem(image_stem: str, material_name: str) -> str:
    """Prefer semantic material names whenever an exporter exposes a hash."""

    generic = bool(re.fullmatch(r"[0-9a-f]{24,64}", image_stem, re.IGNORECASE))
    generic = generic or bool(re.fullmatch(r"Texture_?\d+", image_stem, re.IGNORECASE))
    stem = material_name if generic else image_stem
    stem = re.sub(
        r"(?:[_ .-](?:albedo|basecolou?r|diffuse|color|a|n|ao|mg))+$",
        "",
        stem,
        flags=re.IGNORECASE,
    )
    return safe_name(stem, "Texture")


def texture_base_names(stem: str) -> list[str]:
    names = [stem]
    folded = stem.casefold()
    for suffix in MFM_STRIP_SUFFIXES:
        if folded.endswith(suffix):
            stripped = stem[: -len(suffix)]
            if stripped and stripped not in names:
                names.append(stripped)
    return names

def mfm_lookup_stems(image_stem: str, material_name: str) -> list[str]:
    """Build ordered MFM aliases without trusting a hash-only image name."""

    result: list[str] = []
    seen: set[str] = set()
    for value in (
        image_stem,
        material_name,
        readable_publish_stem(image_stem, material_name),
    ):
        stem = PurePosixPath(str(value).replace("\\", "/")).stem.strip()
        for candidate in texture_base_names(stem):
            key = candidate.casefold()
            if candidate and key not in seen:
                seen.add(key)
                result.append(candidate)
    return result


def parse_mfm_index(output: str) -> list[str]:
    paths: list[str] = []
    for line in output.splitlines():
        match = MFM_LINE.match(line.strip())
        if match:
            paths.append(match.group(1).replace("\\", "/"))
    return sorted(set(paths), key=str.casefold)


def mfm_alias_index(paths: Iterable[str]) -> dict[str, list[str]]:
    aliases: dict[str, list[str]] = defaultdict(list)
    for path in paths:
        stem = PurePosixPath(path).stem
        for alias in texture_base_names(stem):
            key = alias.casefold()
            if path not in aliases[key]:
                aliases[key].append(path)
    return dict(aliases)


def image_name(document: dict, index: int) -> str:
    image = document.get("images", [])[index]
    value = str(image.get("name") or image.get("uri") or f"Texture_{index:03d}")
    return PurePosixPath(value.replace("\\", "/")).stem


def material_image_index(document: dict, material: dict) -> int | None:
    info = material.get("pbrMetallicRoughness", {}).get("baseColorTexture")
    if not isinstance(info, dict) or "index" not in info:
        return None
    textures = document.get("textures", [])
    texture_index = int(info["index"])
    if texture_index < 0 or texture_index >= len(textures):
        return None
    texture = textures[texture_index]
    if "source" in texture:
        return int(texture["source"])
    basis = texture.get("extensions", {}).get("KHR_texture_basisu", {})
    return int(basis["source"]) if "source" in basis else None


def candidate_sets(mfm_path: str, preferred_stem: str) -> list[dict[str, list[str]]]:
    """Return ordered, coherent PBR path sets for one material."""

    path = PurePosixPath(mfm_path)
    directory = path.parent
    directories: list[PurePosixPath] = []
    if directory.name.casefold() == "textures":
        directories.append(directory)
    else:
        directories.append(directory.parent / "textures")
        directories.append(directory)
        directories.append(directory / "TILED")

    bases: list[str] = []
    for value in [preferred_stem, *texture_base_names(path.stem)]:
        if value and value.casefold() not in {item.casefold() for item in bases}:
            bases.append(value)

    result: list[dict[str, list[str]]] = []
    seen: set[tuple[str, str]] = set()
    for base in bases:
        for candidate_dir in directories:
            key = (candidate_dir.as_posix().casefold(), base.casefold())
            if key in seen:
                continue
            seen.add(key)
            result.append(
                {
                    channel: [
                        f"/{candidate_dir.as_posix().lstrip('/')}/{base}{suffix}.{extension}"
                        for suffix in suffixes
                        for extension in ("dd0", "dds")
                    ]
                    for channel, suffixes in CHANNEL_SUFFIXES.items()
                }
            )
    return result


def _normal_square_lookup() -> list[int]:
    return [min(255, round(((value / 127.5 - 1.0) ** 2) * 255.0)) for value in range(256)]


def _normal_sqrt_lookup() -> list[int]:
    return [round((0.5 + 0.5 * math.sqrt(value / 255.0)) * 255.0) for value in range(256)]


def reconstruct_tangent_normal(image: Image.Image) -> Image.Image:
    """Preserve signed tangent X/Y and reconstruct the conventional positive Z."""

    red, green, _blue, alpha = image.convert("RGBA").split()
    x_squared = red.point(_normal_square_lookup())
    y_squared = green.point(_normal_square_lookup())
    remaining = ImageChops.invert(ImageChops.add(x_squared, y_squared))
    z_axis = remaining.point(_normal_sqrt_lookup())
    return Image.merge("RGBA", (red, green, z_axis, alpha))


def split_metallic_gloss(image: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Return source MG, roughness, and metalness images.

    Observed WoWS PBS `_mg` maps use red as gloss/smoothness and green as
    metalness. DCC roughness is therefore `1-R`; metalness is copied from G.
    The untouched MG map remains in the conversion cache, while portable
    output publishes the lossless role channels needed by MTL/DCC consumers.
    """

    source = image.convert("RGBA")
    red, green, _blue, _alpha = source.split()
    roughness = ImageOps.invert(red)
    metalness = green
    return source, roughness, metalness


def specular_from_metallic_gloss(image: Image.Image) -> Image.Image:
    """Return the legacy WoWS/GM3D specular-gloss view of an `_mg` map."""

    return image.convert("RGBA").getchannel("R")


def extract_ambient_occlusion(image: Image.Image) -> tuple[Image.Image, str]:
    """Extract AO from the RGB channel that actually contains image data.

    Standard PC/Legends textures normally store AO in R. Newer indexed
    Korabli materials have been observed with an almost constant R/B pair and
    their AO payload in G, so select the channel with the largest variance.
    """

    channels = image.convert("RGBA").split()[:3]
    deviations = [float(ImageStat.Stat(channel).stddev[0]) for channel in channels]
    index = max(range(3), key=lambda item: deviations[item])
    return channels[index], "RGB"[index]


def _resize(image: Image.Image, max_size: int) -> tuple[Image.Image, bool]:
    if max_size <= 0 or max(image.size) <= max_size:
        return image, False
    scale = max_size / max(image.size)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS), True


def _cache_prefix(cache_root: Path, logical_path: str) -> Path:
    digest = hashlib.sha256(logical_path.casefold().encode("utf-8")).hexdigest()[:20]
    return cache_root / "maps" / digest


def _cache_outputs(cache_root: Path, logical_path: str, channel: str) -> dict[str, Path]:
    prefix = _cache_prefix(cache_root, logical_path)
    if channel == "normal":
        return {"normal": prefix.with_name(prefix.name + "_normal_v6.png")}
    if channel == "ao":
        # v4 stores lossless single-channel maps with maximum PNG compression.
        return {"ao": prefix.with_name(prefix.name + "_ao_l_v6.png")}
    return {
        "metallic_gloss": prefix.with_name(prefix.name + "_metallic_gloss_v6.png"),
        "specular": prefix.with_name(prefix.name + "_specular_l_v6.png"),
        "roughness": prefix.with_name(prefix.name + "_roughness_l_v6.png"),
        "metalness": prefix.with_name(prefix.name + "_metalness_l_v6.png"),
    }


def _valid_cached(cache_root: Path, logical_path: str, channel: str) -> bool:
    outputs = _cache_outputs(cache_root, logical_path, channel)
    return all(path.is_file() and path.stat().st_size > 0 for path in outputs.values())


def load_unavailable_paths(availability_file: Path) -> set[str]:
    """Ignore negative-cache entries written by an older conversion schema."""

    try:
        payload = json.loads(availability_file.read_text(encoding="utf-8"))
        values = payload.get("unavailable", [])
        if payload.get("schema") != SCHEMA or not isinstance(values, list):
            return set()
        return {str(item) for item in values}
    except (
        OSError,
        json.JSONDecodeError,
        AttributeError,
        TypeError,
    ):
        return set()

def pbr_worker_count(item_count: int) -> int:
    configured = os.environ.get("WOWS_TOOLBOX_TEXTURE_WORKERS", "").strip()
    try:
        requested = int(configured) if configured else min(4, os.cpu_count() or 1)
    except ValueError:
        requested = min(4, os.cpu_count() or 1)
    return max(1, min(8, requested, max(1, item_count)))


def _run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def load_mfm_paths(exporter: Path, game_dir: Path, cache_root: Path) -> tuple[list[str], bool]:
    cache_file = cache_root / "mfm-paths.json"
    if cache_file.is_file():
        try:
            payload = json.loads(cache_file.read_text(encoding="utf-8"))
            paths = payload.get("paths")
            if payload.get("schema") == SCHEMA and isinstance(paths, list) and paths:
                return [str(item) for item in paths], True
        except (OSError, json.JSONDecodeError):
            pass

    result = _run([str(exporter), "--game-dir", str(game_dir), "list", "", "--assets"])
    paths = parse_mfm_index(result.stdout)
    if not paths:
        raise RuntimeError("The asset index did not return any MFM material paths")
    cache_root.mkdir(parents=True, exist_ok=True)
    temporary = cache_file.with_suffix(f".json.{os.getpid()}.part")
    temporary.write_text(
        json.dumps({"schema": SCHEMA, "paths": paths}, ensure_ascii=False),
        encoding="utf-8",
    )
    os.replace(temporary, cache_file)
    return paths, False


def _chunks(paths: Iterable[str], max_characters: int = 22000, max_items: int = 140):
    chunk: list[str] = []
    characters = 0
    for path in paths:
        extra = len(path) + 3
        if chunk and (len(chunk) >= max_items or characters + extra > max_characters):
            yield chunk
            chunk = []
            characters = 0
        chunk.append(path)
        characters += extra
    if chunk:
        yield chunk


def _extract_paths(exporter: Path, game_dir: Path, raw_root: Path, paths: Iterable[str]) -> int:
    unique = sorted(set(paths), key=str.casefold)
    chunks = list(_chunks(unique))
    if not chunks:
        return 0
    configured = os.environ.get("WOWS_TOOLBOX_PACKAGE_WORKERS", "").strip()
    try:
        requested = int(configured) if configured else 2
    except ValueError:
        requested = 2
    workers = max(1, min(4, requested, len(chunks)))

    def extract(chunk: list[str]) -> None:
        _run(
            [
                str(exporter),
                "--game-dir",
                str(game_dir),
                "extract",
                "-o",
                str(raw_root),
                *chunk,
            ]
        )

    if workers == 1:
        for chunk in chunks:
            extract(chunk)
    else:
        with ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="wows-pbr-extract"
        ) as pool:
            futures = [pool.submit(extract, chunk) for chunk in chunks]
            for future in as_completed(futures):
                future.result()
    return len(chunks)


def _raw_path(raw_root: Path, logical_path: str) -> Path:
    return raw_root.joinpath(*PurePosixPath(logical_path.lstrip("/")).parts)


def _channel_from_path(logical_path: str) -> str:
    folded = PurePosixPath(logical_path).stem.casefold()
    for channel, suffixes in CHANNEL_SUFFIXES.items():
        if any(folded.endswith(suffix) for suffix in suffixes):
            return channel
    raise ValueError(f"Unsupported PBR channel path: {logical_path}")


def _is_bc7prep_file(source: Path) -> bool:
    if not source.is_file():
        return False
    with source.open("rb") as stream:
        header = stream.read(152)
    return (header[:4] == b"DDS " and header[84:88] == b"DX10"
            and header[148:152] == b"\xbc\x07\x00\x00")


def _save_cached_png(image: Image.Image, target: Path) -> None:
    # Several materials may share a channel. A PID is not unique across workers.
    fd, name = tempfile.mkstemp(prefix=target.name + ".", suffix=".part", dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        image.save(temporary, format="PNG", compress_level=9)
        for attempt in range(10):
            try:
                os.replace(temporary, target)
                break
            except PermissionError:
                # Windows can briefly deny both replacement and reading while
                # another worker publishes this same channel.
                try:
                    with Image.open(target) as winner:
                        winner.verify()
                    break
                except (PermissionError, FileNotFoundError):
                    if attempt == 9:
                        raise
                    time.sleep(0.02)
    finally:
        temporary.unlink(missing_ok=True)


def _convert_to_cache(
    source: Path,
    cache_root: Path,
    logical_path: str,
    channel: str,
    max_size: int,
    exporter: Path | None = None,
) -> tuple[dict[str, Path], bool]:
    outputs = _cache_outputs(cache_root, logical_path, channel)
    if _valid_cached(cache_root, logical_path, channel):
        return outputs, False
    next(iter(outputs.values())).parent.mkdir(parents=True, exist_ok=True)
    # Pillow accepts the BC7Prep payload as ordinary BC7 and returns garbage.
    # Route this container through the exporter's validated inverse transform.
    is_prep = _is_bc7prep_file(source)
    with tempfile.TemporaryDirectory(prefix="wows-pbr-") as temporary:
        decoded_source = source
        fallback_reason = None
        if is_prep:
            if exporter is None:
                raise RuntimeError("BC7Prep texture requires the compatible exporter")
            decoded_source = Path(temporary) / "decoded.png"
            try:
                _run([str(exporter), "decode-texture", str(source), "--output", str(decoded_source)])
            except subprocess.CalledProcessError as error:
                # Unsupported preprocessing layouts must never reach Pillow.
                # The sibling DDS contains the game's authored standalone mip.
                fallback = source.with_suffix(".dds")
                if not fallback.is_file() or _is_bc7prep_file(fallback):
                    raise RuntimeError(f"Unsupported BC7Prep and no standalone mip: {logical_path}") from error
                decoded_source = fallback
                fallback_reason = str(error.stdout or error)
        with Image.open(decoded_source) as opened:
            converted, resized = _resize(opened.convert("RGBA"), max_size)
        if fallback_reason:
            marker = _cache_prefix(cache_root, logical_path).with_suffix(".decode_v6.json")
            marker.write_text(json.dumps({"source": logical_path, "fallback": decoded_source.name,
                                         "size": converted.size, "reason": fallback_reason}), encoding="utf-8")
        if channel == "normal":
            images = {"normal": reconstruct_tangent_normal(converted)}
        elif channel == "ao":
            ao, _source_channel = extract_ambient_occlusion(converted)
            images = {"ao": ao}
        else:
            source_mg, roughness, metalness = split_metallic_gloss(converted)
            images = {
                "metallic_gloss": source_mg,
                "specular": specular_from_metallic_gloss(source_mg),
                "roughness": roughness,
                "metalness": metalness,
            }
        for name, image in images.items():
            target = outputs[name]
            _save_cached_png(image, target)
    return outputs, resized


def _publish(
    cache_path: Path,
    texture_dir: Path,
    stem: str,
    role: str,
    allocations: dict[str, str],
    used_names: set[str],
) -> str:
    """Publish one lossless copy for each unique role-and-content pair."""

    texture_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with cache_path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    key = role + "\0" + digest.hexdigest()
    previous = allocations.get(key)
    if previous is not None:
        return previous

    base = safe_name(f"{stem}_{role}", f"Texture_{role}")
    candidate = f"{base}.png"
    serial = 2
    while candidate.casefold() in used_names:
        candidate = f"{base[:110]}_{serial:02d}.png"
        serial += 1
    used_names.add(candidate.casefold())
    target = texture_dir / candidate
    shutil.copy2(cache_path, target)
    relative = f"textures/{target.name}"
    allocations[key] = relative
    return relative


def prepare_pbr_materials(
    document: dict,
    *,
    exporter: Path,
    game_dir: Path,
    texture_dir: Path,
    work_dir: Path,
    cache_root: Path,
    max_size: int = 0,
) -> dict:
    """Extract, convert, and publish PBR maps aligned to GLB material indices."""

    total_started = time.perf_counter()
    materials = document.get("materials", [])
    contract: dict = {
        "schema": SCHEMA,
        "source_contract": {
            "normal": "WoWS signed tangent XY in RG; Ships 2.0 `_alpha_n` supported; positive Z reconstructed",
            "metallic_gloss": "source `_mg` retained in conversion cache; inferred R=gloss, G=metalness",
            "specular": "GM3D-compatible grayscale view of `_mg`.R",
            "roughness": "1 - `_mg`.R",
            "metalness": "`_mg`.G",
            "ao": "highest-information RGB channel from `_ao` (R on standard PBS, often G on indexed PBS)",
        },
        "materials": [None] * len(materials),
        "coverage": {"materials": len(materials), "pbr_materials": 0, "channels": 0},
        "cache": {},
        "warnings": [],
    }
    index_started = time.perf_counter()
    paths, index_reused = load_mfm_paths(exporter, game_dir, cache_root)
    aliases = mfm_alias_index(paths)
    index_seconds = time.perf_counter() - index_started
    contract["cache"]["mfm_index_reused"] = index_reused
    raw_root = work_dir / "pbr-raw"
    raw_root.mkdir(parents=True, exist_ok=True)
    availability_file = cache_root / "availability.json"
    unavailable = load_unavailable_paths(availability_file)
    selection_file = cache_root / "selected-sources.json"
    selection_records: dict[str, dict[str, str]] = {}
    try:
        selection_payload = json.loads(
            selection_file.read_text(encoding="utf-8")
        )
        raw_selections = selection_payload.get("selections", {})
        if (
            selection_payload.get("schema") == SELECTION_SCHEMA
            and isinstance(raw_selections, dict)
        ):
            selection_records = {
                str(key): {
                    str(channel): str(logical)
                    for channel, logical in value.items()
                }
                for key, value in raw_selections.items()
                if isinstance(value, dict)
            }
    except (OSError, json.JSONDecodeError, AttributeError, TypeError):
        pass

    resolution_started = time.perf_counter()
    resolutions: list[dict | None] = []
    for material in materials:
        source_index = material_image_index(document, material)
        if source_index is None:
            resolutions.append(None)
            continue
        stem = image_name(document, source_index)
        material_name = str(material.get("name") or "")
        lookup_stems = mfm_lookup_stems(stem, material_name)
        candidates: list[tuple[str, str]] = []
        seen_paths: set[str] = set()
        for lookup_stem in lookup_stems:
            for path in aliases.get(lookup_stem.casefold(), []):
                key = path.casefold()
                if key in seen_paths:
                    continue
                seen_paths.add(key)
                candidates.append((path, lookup_stem))
        sets = [
            item
            for path, lookup_stem in candidates
            for item in candidate_sets(path, lookup_stem)
        ]
        selection_key = hashlib.sha256(
            json.dumps(
                {"stem": stem, "sets": sets},
                ensure_ascii=True,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest()
        resolution = {
            "stem": stem,
            "image_index": source_index,
            "mfm_lookup_stems": lookup_stems,
            "sets": sets,
            "selection_key": selection_key,
        }
        # Reuse a partial source set only after a previous complete run selected
        # it. A lone channel from an interrupted conversion is not enough.
        cached_selection: dict[str, str] = {}
        stored = selection_records.get(selection_key, {})
        allowed = {
            channel: {
                logical
                for candidate in sets
                for logical in candidate[channel]
            }
            for channel in CHANNEL_SUFFIXES
        }
        if stored and all(
            channel in CHANNEL_SUFFIXES
            and logical in allowed[channel]
            and _valid_cached(cache_root, logical, channel)
            for channel, logical in stored.items()
        ):
            cached_selection = dict(stored)
        if not cached_selection:
            for candidate in sets:
                found = {
                    channel: logical
                    for channel, values in candidate.items()
                    if (
                        logical := next(
                            (
                                value
                                for value in values
                                if _valid_cached(cache_root, value, channel)
                            ),
                            None,
                        )
                    )
                    is not None
                }
                if len(found) == len(CHANNEL_SUFFIXES):
                    cached_selection = found
                    break
        resolution["cached_selection"] = cached_selection
        resolutions.append(resolution)
    resolution_seconds = time.perf_counter() - resolution_started

    extraction_started = time.perf_counter()
    # Prefer every high-resolution DD0 naming variant. A channel can have more
    # than one suffix (Ships 2.0 normals use `_alpha_n` instead of `_n`), so do
    # not assume candidate[0]/candidate[1] are the only DD0/DDS pair.
    requested_dd0 = []
    for resolution in resolutions:
        if not resolution or resolution["cached_selection"]:
            continue
        for candidate in resolution["sets"]:
            for channel, values in candidate.items():
                requested_dd0.extend(
                    value
                    for value in values
                    if value.casefold().endswith(".dd0")
                    and value not in unavailable
                    and not _valid_cached(cache_root, value, channel)
                )
    extraction_calls = (
        _extract_paths(exporter, game_dir, raw_root, requested_dd0)
        if requested_dd0
        else 0
    )
    unavailable.update(
        logical
        for logical in requested_dd0
        if not _raw_path(raw_root, logical).is_file()
        and not _valid_cached(cache_root, logical, _channel_from_path(logical))
    )

    def available(logical: str, channel: str) -> bool:
        return _valid_cached(cache_root, logical, channel) or (
            logical not in unavailable and _raw_path(raw_root, logical).is_file()
        )

    requested_dds: list[str] = []
    for resolution in resolutions:
        if not resolution or resolution["cached_selection"]:
            continue
        for channel in CHANNEL_SUFFIXES:
            if any(
                available(value, channel)
                for candidate in resolution["sets"]
                for value in candidate[channel]
                if value.casefold().endswith(".dd0")
            ) and not any(
                _is_bc7prep_file(_raw_path(raw_root, value))
                for candidate in resolution["sets"] for value in candidate[channel]
                if value.casefold().endswith(".dd0")
            ):
                continue
            requested_dds.extend(
                value
                for candidate in resolution["sets"]
                for value in candidate[channel]
                if value.casefold().endswith(".dds")
                and value not in unavailable
                and not _valid_cached(cache_root, value, channel)
            )
    if requested_dds:
        extraction_calls += _extract_paths(
            exporter, game_dir, raw_root, requested_dds
        )
        unavailable.update(
            logical
            for logical in requested_dds
            if not _raw_path(raw_root, logical).is_file()
            and not _valid_cached(cache_root, logical, _channel_from_path(logical))
        )
    extraction_seconds = time.perf_counter() - extraction_started
    cache_root.mkdir(parents=True, exist_ok=True)
    temporary_availability = availability_file.with_suffix(
        f".json.{os.getpid()}.part"
    )
    temporary_availability.write_text(
        json.dumps(
            {"schema": SCHEMA, "unavailable": sorted(unavailable)},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    os.replace(temporary_availability, availability_file)

    selection_started = time.perf_counter()
    selected_sources: list[dict[str, str]] = []
    for resolution in resolutions:
        selected: dict[str, str] = {}
        if resolution:
            selected = dict(resolution["cached_selection"])
            if not selected:
                for candidate in resolution["sets"]:
                    found = {
                        channel: logical
                        for channel, values in candidate.items()
                        if (
                            logical := next(
                                (
                                    value
                                    for value in values
                                    if available(value, channel)
                                ),
                                None,
                            )
                        )
                        is not None
                    }
                    if len(found) > len(selected):
                        selected = found
                    if len(selected) == len(CHANNEL_SUFFIXES):
                        break
        selected_sources.append(selected)
    selection_seconds = time.perf_counter() - selection_started

    conversion_started = time.perf_counter()
    conversion_jobs: dict[tuple[str, str], Path] = {}
    for selected in selected_sources:
        for channel, logical in selected.items():
            if not _valid_cached(cache_root, logical, channel):
                conversion_jobs[(logical, channel)] = _raw_path(raw_root, logical)
    conversion_results: dict[tuple[str, str], tuple[dict[str, Path], bool]] = {}
    if conversion_jobs:
        workers = pbr_worker_count(len(conversion_jobs))
        with ThreadPoolExecutor(
            max_workers=workers, thread_name_prefix="wows-pbr-png"
        ) as pool:
            futures = {
                pool.submit(
                    _convert_to_cache,
                    source,
                    cache_root,
                    logical,
                    channel,
                    max_size,
                    exporter,
                ): (logical, channel)
                for (logical, channel), source in conversion_jobs.items()
            }
            for future in as_completed(futures):
                conversion_results[futures[future]] = future.result()
    resized_count = sum(
        int(resized) for _outputs, resized in conversion_results.values()
    )
    conversion_seconds = time.perf_counter() - conversion_started

    publish_started = time.perf_counter()
    published: set[str] = set()
    publish_allocations: dict[str, str] = {}
    publish_names: set[str] = set()
    for material_index, (resolution, selected) in enumerate(
        zip(resolutions, selected_sources)
    ):
        if not resolution or not selected:
            continue
        entry = {
            "material_index": material_index,
            "material_name": str(
                materials[material_index].get("name")
                or f"Material_{material_index:03d}"
            ),
            "base_image": resolution["stem"],
            "maps": {},
            "sources": selected,
        }
        for channel, logical in selected.items():
            cache_outputs = _cache_outputs(cache_root, logical, channel)
            if not _valid_cached(cache_root, logical, channel):
                raise RuntimeError(
                    f"PBR cache conversion did not publish {channel}: {logical}"
                )
            for role, cache_path in cache_outputs.items():
                # The packed MG source is already represented losslessly by the
                # published specular/gloss and metalness channels. Keep it in
                # cache for future reinterpretation, but do not duplicate the
                # 4K source in every portable OBJ output.
                if role not in PORTABLE_PBR_ROLES:
                    continue
                relative = _publish(
                    cache_path,
                    texture_dir,
                    readable_publish_stem(
                        resolution["stem"], entry["material_name"]
                    ),
                    role,
                    publish_allocations,
                    publish_names,
                )
                entry["maps"][role] = relative
                published.add(relative)
        contract["materials"][material_index] = entry
        contract["coverage"]["pbr_materials"] += 1
        contract["coverage"]["channels"] += len(entry["maps"])
    publish_seconds = time.perf_counter() - publish_started
    for selected in selected_sources:
        for logical in selected.values():
            marker = _cache_prefix(cache_root, logical).with_suffix(".decode_v6.json")
            if marker.is_file():
                fallback = json.loads(marker.read_text(encoding="utf-8"))
                warning = f"Unsupported BC7Prep uses authored standalone mip {fallback['size']}: {logical}"
                if warning not in contract["warnings"]:
                    contract["warnings"].append(warning)

    for resolution, selected in zip(resolutions, selected_sources):
        if resolution and selected:
            selection_records[resolution["selection_key"]] = dict(selected)
    cache_root.mkdir(parents=True, exist_ok=True)
    temporary_selection = selection_file.with_suffix(
        f".json.{os.getpid()}.part"
    )
    temporary_selection.write_text(
        json.dumps(
            {
                "schema": SELECTION_SCHEMA,
                "selections": selection_records,
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        encoding="utf-8",
    )
    os.replace(temporary_selection, selection_file)

    contract["cache"].update(
        {
            "extraction_calls": extraction_calls,
            "converted_maps_reused": sum(
                1
                for resolution in resolutions
                if resolution
                for candidate in resolution["sets"]
                for channel, values in candidate.items()
                if any(_valid_cached(cache_root, value, channel) for value in values)
            ),
            "maps_resized": resized_count,
            "resolved_materials_reused": sum(
                bool(resolution and resolution["cached_selection"])
                for resolution in resolutions
            ),
            "conversion_jobs": len(conversion_jobs),
            "conversion_workers": workers if conversion_jobs else 0,
        }
    )
    contract["timings_seconds"] = {
        "mfm_index_seconds": round(index_seconds, 3),
        "resolution_seconds": round(resolution_seconds, 3),
        "extraction_seconds": round(extraction_seconds, 3),
        "selection_seconds": round(selection_seconds, 3),
        "conversion_seconds": round(conversion_seconds, 3),
        "publish_seconds": round(publish_seconds, 3),
        "total_seconds": round(time.perf_counter() - total_started, 3),
    }
    contract["naming"] = "readable-role-suffix"
    contract["texture_files"] = sorted(published)
    if contract["coverage"]["pbr_materials"] == 0:
        contract["warnings"].append("No matching PBR material maps were found")
    shutil.rmtree(raw_root, ignore_errors=True)
    return contract
