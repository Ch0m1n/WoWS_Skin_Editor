## v0.2.6 — 2026-10-14

영어 모드에서 시작 안내와 상세 오류 로그에 한국어가 남는 문제를 수정했어요. 오류 문장과 복사되는 로그를 선택한 언어로 표시하고, 호출 위치와 파일 경로는 유지해요. 추출 엔진은 변경하지 않았어요.

[릴리스 안내](https://github.com/Ch0m1n/WoWS_Skin_Editor/releases/tag/v0.2.6)

## v0.2.5 — 2026-10-14

상단에서 펼치는 오류 로그와 새 오류 알림, 한국어·영어 오류 설명, 원본 로그 복사를 추가했어요. 오류 기록은 현재 실행에서 최근 100개까지 유지해요.

함선 목록에 저장된 캐시 상태와 ‘추출 완료만’ 필터를 표시해요. 현재 엔진·게임 빌드에서 바로 열 수 있는 모델과 재준비가 필요한 이전 추출본을 구분해요. 추출 엔진은 v0.2.4와 같아요.

[릴리스 안내](https://github.com/Ch0m1n/WoWS_Skin_Editor/releases/tag/v0.2.5)
## v0.2.4 — 2026-10-14

Flandre처럼 별도 뼈대에 연결된 연돌이 잘못 배치되는 추출 문제를 수정했어요. 포탑 등의 기존 연결 변환은 유지하고, 새 엔진 캐시에 모델을 다시 준비해요.

버전별 RELEASE 문서 파일을 정리했어요. 사용법은 README, 변경 이력은 CHANGELOG, 상세 설명은 GitHub 릴리스에 모아요.

[릴리스 안내](https://github.com/Ch0m1n/WoWS_Skin_Editor/releases/tag/v0.2.4)

## v0.2.3 — 2026-10-14

작업 관리의 전체 모델 캐시 삭제 버튼과 삭제 확인 안내를 추가했어요. 현재 편집 중인 모델은 유지하고, 추출 작업이 있으면 전체 삭제를 막아요.

[릴리스 안내](https://github.com/Ch0m1n/WoWS_Skin_Editor/releases/tag/v0.2.3)

## v0.2.2 — 2026-10-13

첫 실행의 한국어·영어 언어 선택 창과 선택 저장을 추가하고, 상단 언어 메뉴에 두 언어 이름을 함께 표시해요.

[릴리스 안내](https://github.com/Ch0m1n/WoWS_Skin_Editor/releases/tag/v0.2.2)

## v0.2.1 — 2026-10-13

커스텀 위장 XML의 32 MiB 지원과 숫자로 시작하는 그룹명 보존, 게임 원본 XML 불러오기, 위장 번역명 표시, 단차 브러시 투영, Shift 직선 각도 표시, 브러시 설정 창을 추가·수정했어요.

[릴리스 안내](https://github.com/Ch0m1n/WoWS_Skin_Editor/releases/tag/v0.2.1)

## v0.2 — 2026-10-13

함선별 디스크 백업, 모델 재연결, 레이어 그룹·잠금·다중 선택, 브러시 설정·부품 마스크·선택 영역, 저장되는 추출 대기열, 캐시 관리, 서버·화면 진단을 추가했어요.

[릴리스 안내](https://github.com/Ch0m1n/WoWS_Skin_Editor/releases/tag/v0.2)

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
- Ship cards select without extracting; use Open to prepare, or cancel queued/running preparation.
- Resize the 3D/texture panes by dragging their boundary.
- Click projected images to select them; Delete removes them and Ctrl+Z restores them.
- Empty-space, bare-surface and view-tab clicks clear image selection.
- Shift rotation snaps image handles to preferred angles.
- Worker-built spatial picking index and partial GPU brush updates with stable preview resolution.

## Limits / 제한

Windows PC version only. PSD layer import, editing non-color material channels,
automatic installation into `res_mods`, and in-game rendering verification are not
included in v0.1. Shared UVs can repeat an image on multiple surfaces. Pending
extraction queues do not survive server shutdown; completed model caches do.

게임 내 최종 표시 결과는 아직 검증하지 않았어요. 중요한 작업은 프로젝트 파일로
따로 저장해 주세요. 게임 원본·추출된 게임 에셋은 배포본에 포함하지 않아요.
