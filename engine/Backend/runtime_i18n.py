from __future__ import annotations

"""Small runtime log localizer shared by extraction subprocesses."""

import json
import os
import re
from typing import Any


def is_english() -> bool:
    return os.environ.get("WOWS_TOOLBOX_LANGUAGE", "").strip().casefold() == "en"


EXACT = {
    "현재 함선 뒤에서 대기열을 일시 정지했어요": "The queue will pause after the current ship",
    "게임 폴더가 없어요": "The game folder does not exist",
    "IDX 또는 패키지 파일을 찾지 못했어요": "IDX or package files were not found",
    "Legends 실행 파일 또는 패키지가 없어요": "The Legends executable or package files were not found",
    "게임 호환성 검사를 통과하지 못했어요": "Game compatibility check failed",
    "예상 출력 용량보다 디스크 여유 공간이 부족해요": "Free disk space is below the estimated output size",
    "사용 가능한 메모리가 2GB보다 적어요. 다른 프로그램을 닫아 주세요": "Less than 2 GB of memory is available. Close other applications",
    "대기열 매니페스트를 읽지 못했어요": "Could not read the queue manifest",
    "대기열 공통 설정 형식이 잘못됐어요": "The queue common-settings format is invalid",
    "대기열이 비어 있어요": "The queue is empty",
    "다음 함선의 미리 준비 작업을 취소했어요": "Cancelled preparation of the next ship",
    "드라이브 루트는 출력 폴더로 사용할 수 없어요": "A drive root cannot be used as the output folder",
    "게임 폴더 자체는 출력 폴더로 사용할 수 없어요": "The game folder itself cannot be used as the output folder",
    "출력 폴더는 게임 설치 폴더 밖에 있어야 해요": "The output folder must be outside the game installation folder",
    "게임 설치 폴더의 상위 폴더는 출력 폴더로 사용할 수 없어요": "A parent of the game installation folder cannot be used as output",
    "정확 장갑 보조 파일의 형식이 올바르지 않아요": "The exact-armor sidecar format is invalid",
    "WoWS Toolbox는 Blender 없이 OBJ/원본 GLB만 지원해요": "WoWS Toolbox supports OBJ/raw GLB without Blender only",
    "코라블리 변환 캐시를 재사용해요": "Reusing the Korabli conversion cache",
    "코라블리 GameParams를 읽는 중": "Reading Korabli GameParams",
    "코라블리 assets.bin의 Oodle 청크를 복원하는 중": "Decompressing Oodle chunks from Korabli assets.bin",
    "코라블리 변환 캐시 준비 완료": "Korabli conversion cache is ready",
    "Legends 함선 리소스를 계산하는 중": "Calculating Legends ship resources",
    "Legends 시스템 리소스를 준비하는 중": "Preparing Legends system resources",
    "함선 조립 정보와 무장 배치를 분석하는 중": "Analyzing ship assembly data and weapon placement",
    "함선에 필요한 부품과 텍스처를 계산하는 중": "Calculating required ship parts and textures",
    "함선 부품 OBJ와 재질을 변환하는 중": "Converting ship-part OBJ files and materials",
    "함선 부품 변환이 끝나 최종 배치를 만드는 중": "Part conversion finished; building the final layout",
    "Blender 없이 개별 부품을 편집 가능한 OBJ로 조립하는 중": "Assembling editable component OBJ files without Blender",
    "선체·무장과 장갑을 동시에 계산하는 중": "Calculating hull, weapons, and armor in parallel",
    "선체와 무장 배치를 계산하는 중": "Calculating hull and weapon placement",
    "장갑 구역과 두께 메시를 계산하는 중": "Calculating armor zones and thickness meshes",
    "같은 게임 빌드의 모델·장갑 캐시를 재사용하는 중": "Reusing model and armor caches from the same game build",
    "Blender 없이 선택한 형식의 편집 파트로 변환하는 중": "Converting to editable parts without Blender",
    "중간 GLB가 만들어지지 않았거나 손상됐어요": "The intermediate GLB is missing or invalid",
    "모델 변환 보고서가 만들어지지 않았어요": "The model conversion report was not created",
    "모델 변환 검증을 통과하지 못했어요": "Model conversion validation failed",
    "Legends 결과 매니페스트가 없어요": "The Legends result manifest is missing",
    "Legends 조립 OBJ를 찾지 못했어요": "The assembled Legends OBJ was not found",
    "Legends 편집형 출력 보고서가 만들어지지 않았어요": "The Legends editable-output report was not created",
    "Legends 편집형 GLB/FBX 검증을 통과하지 못했어요": "Legends editable GLB/FBX validation failed",
    "Legends 편집형 모델 추출 완료": "Legends editable model extraction complete",
    "출력 폴더를 만들지 못했어요": "Could not create the output folder",
    "파트 원점 데이터 불러오기 실패: 지원하지 않는 형식이에요": "Failed to load part-origin data: unsupported format",
    "선택 함선 계약 확인 완료": "Selected-ship contract check passed",
    "Legends 함선 키가 비어 있어요": "The Legends ship key is empty",
    "Legends 선택 모델 경로가 안전하지 않아요": "The Legends selected-model path is unsafe",
    "Legends 추출 파이프라인이 없어요": "The Legends extraction pipeline is missing",
    "함선 IDX 식별자가 비어 있어요": "The ship IDX identifier is empty",
    "Legends는 ModelUber LOD0과 선언된 원본 크기 컬러 텍스처로 고정해 추출해요.": (
        "Legends extraction is fixed to ModelUber LOD0 and the declared "
        "original-size color textures."
    ),
}


PATTERNS = (
    (r"함선/장비 데이터 ([\d,]+)개를 변환하는 중", r"Converting \1 ship/equipment records"),
    (r"필요한 리소스 ([\d,]+)개를 추출하는 중", r"Extracting \1 required resources"),
    (r"Blender 없이 함선 부품 ([\d,]+)개를 준비하는 중", r"Preparing \1 ship parts without Blender"),
    (
        r"Blender 없는 부품 변환 ([\d,]+)/([\d,]+) · 실행 중 ([\d,]+)개 · 최장 ([\d.]+)초: (.+)",
        r"Blender-free part conversion \1/\2 · \3 active · oldest \4s: \5",
    ),
    (
        r"Blender 없는 부품 변환 ([\d,]+)/([\d,]+) · 실행 중 ([\d,]+)개",
        r"Blender-free part conversion \1/\2 · \3 active",
    ),
    (r"Blender 없는 부품 변환 ([\d,]+)/([\d,]+)", r"Blender-free part conversion \1/\2"),
    (r"부품 변환 준비 ([\d,]+)/([\d,]+)", r"Preparing part conversion \1/\2"),
    (r"편집 파트 ([\d,]+)개 · ([A-Za-z0-9,+ ]+) 추출 완료", r"Extracted \1 editable parts · \2"),
    (r"IDX ([\d,]+)개·패키지 ([\d,]+)개 구조 확인 완료", r"Verified \1 IDX files and \2 packages"),
    (r"Legends 실행 파일·패키지 ([\d,]+)개 확인 완료", r"Verified the Legends executable and \1 packages"),
    (r"게임 빌드 변경 감지, 새 캐시로 검증해요", r"Game build change detected; validating with a new cache"),
    (r"장갑 메시 추출을 건너뛰어요: (.+)", r"Skipping armor mesh extraction: \1"),
    (r"함선 내보내기 엔진이 없어요: (.+)", r"Ship export engine not found: \1"),
    (r"Blender 없는 OBJ 변환기가 없어요: (.+)", r"Blender-free OBJ converter not found: \1"),
    (r"idx가 있는 게임 빌드를 찾지 못했어요: (.+)", r"Could not find a game build containing IDX files: \1"),
    (r"출력 대상이 출력 루트의 바로 아래가 아니에요: (.+)", r"The output target is not a direct child of the output root: \1"),
    (r"지원하지 않는 출력 형식: (.+)", r"Unsupported output format: \1"),
    (r"추출 엔진이 없어요: (.+)", r"Extraction engine is missing: \1"),
    (
        r"선택 함선 사전 검사를 통과하지 못했어요: (.+)",
        r"Selected-ship preflight failed: \1",
    ),
    (
        r"(MODEL|ARMOR) LOD ([0-9]+) 메시가 없어요\. 최고 품질인 LOD0을 선택해 다시 추출해 주세요\.",
        r"\1 LOD \2 has no mesh. Select highest-quality LOD0 and extract again.",
    ),
    (
        r"(MODEL|ARMOR) LOD ([0-9]+)에 메시가 없어 최고 LOD로 자동 재시도해요",
        r"\1 LOD \2 has no mesh; retrying with highest-quality LOD0",
    ),
)


FRAGMENTS = (
    (" 항목을 IDX에서 찾지 못했어요", " item was not found in the IDX"),
    ("게임 빌드 변경 감지", "game build change detected"),
    ("준비 완료", "ready"),
    ("준비하는 중", "preparing"),
    ("계산하는 중", "calculating"),
    ("분석하는 중", "analyzing"),
    ("추출하는 중", "extracting"),
    ("변환하는 중", "converting"),
    ("조립하는 중", "assembling"),
    ("완료", "complete"),
    ("실패", "failed"),
    ("함선", "ship"),
    ("부품", "part"),
    ("리소스", "resources"),
    ("텍스처", "textures"),
    ("장갑", "armor"),
    ("선체", "hull"),
    ("무장", "weapons"),
    ("대기열", "queue"),
    ("경로", "path"),
    ("폴더", "folder"),
    ("없어요", "not found"),
    ("올바르지 않아요", "is invalid"),
    ("찾지 못했어요", "was not found"),
    ("건너뛰어요", "skipped"),
    ("재사용해요", "reused"),
    ("새 캐시로 검증해요", "validating with a new cache"),
)


def translate_text(value: str) -> str:
    if not is_english() or not value:
        return value
    if value in EXACT:
        return EXACT[value]
    result = value
    for pattern, replacement in PATTERNS:
        result = re.sub(pattern, replacement, result)
    for source, target in FRAGMENTS:
        result = result.replace(source, target)
    if re.search(r"[가-힣]", result):
        # Never turn a diagnostic into misleading fragments such as
        # "MODEL LOD" or "folder". Keep safe ASCII identifiers and make
        # the translation gap explicit until the message gets a stable ID.
        identifiers = re.findall(r"[A-Za-z0-9_.:/\\-]+", value)
        suffix = ": " + " ".join(identifiers) if identifiers else ""
        return "Internal operation message (translation unavailable)" + suffix
    return result


def translate_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: translate_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [translate_payload(item) for item in value]
    if isinstance(value, str):
        return translate_text(value)
    return value


def translate_line(line: str) -> str:
    if not is_english() or not line:
        return line
    prefix = ""
    payload_text = line
    label = re.match(r"^(\[[A-Z_]+\]\s+)(.*)$", line)
    if label:
        prefix, payload_text = label.group(1), label.group(2)
        nested = re.match(r"^(\[[A-Z]+\]\s+)(.*)$", payload_text)
        if nested:
            prefix += nested.group(1)
            payload_text = nested.group(2)
    if payload_text.startswith("{"):
        try:
            payload = json.loads(payload_text)
            return prefix + json.dumps(translate_payload(payload), ensure_ascii=False)
        except (TypeError, ValueError):
            pass
    return prefix + translate_text(payload_text)
