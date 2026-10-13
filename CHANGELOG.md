# v0.1 — 2026-10-13

First public Windows portable release of WoWS Skin Editor.

## Download and run / 실행

Extract `WoWS_Skin_Editor-v0.1-Windows.zip` and run `Start-Workshop.cmd`.
The editor opens in your browser at `http://127.0.0.1:8766`.
The editor automatically detects the installed World of Warships folder.

ZIP을 풀고 `Start-Workshop.cmd`를 실행하세요. 설치된 월드오브워쉽 경로를 자동으로 탐지합니다.

## Features / 기능

- Automatic installation discovery; country/class search and real ship thumbnails.
- Korean/English UI and ship names from the corresponding game `global.mo`.
- On-demand extraction, reusable model cache, progress display and preparation queue.
- 2D/3D brush and eraser; continuous strokes and free-angle Shift straight lines.
- Editable image layers with direct resize/rotation handles and background UV baking.
- Camera zoom and orbit while editing images; double-click X/Y/Z axis alignment.
- Material/part grouping and original material channel previews.
- Copy/paste, undo/redo, autosave and `.wowskin` project save/restore.
- Existing PNG/DDS skin import with preserved alpha and editable replacement layers.
- PNG/DDS texture ZIP export with mipmaps and camouflage XML color editing.
- Pure black default brush color.

## Validation and limits / 검증·제한

Backend: 12 unit tests passed. Browser checks passed for real-model loading,
brush/eraser continuity, free-angle Shift lines, image transforms, camera controls,
clipboard shortcuts, preparation queue UI, texture import, project restore and DDS export.

Windows PC version only. PSD layer import, editing non-color material channels,
automatic installation into `res_mods`, and in-game rendering verification are not
included in v0.1. Shared UVs can repeat an image on multiple surfaces. Pending
extraction queues do not survive server shutdown; completed model caches do.

게임 내 최종 표시 결과는 아직 검증하지 않았어요. 중요한 작업은 프로젝트 파일로
따로 저장해 주세요. 게임 원본·추출된 게임 에셋은 배포본에 포함하지 않아요.
