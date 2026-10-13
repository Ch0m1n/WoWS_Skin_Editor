# WoWS Skin Editor v0.2

Download `WoWS_Skin_Editor-v0.2-Windows.zip`, extract it and run `Start-Workshop.cmd`.
The editor automatically detects the installed World of Warships folder.

ZIP을 풀고 `Start-Workshop.cmd`를 실행하세요. 설치된 월드오브워쉽 경로를 자동으로 탐지합니다.

## Added / 추가 기능

- Per-ship disk backups with five recovery points; backup browser storage remains optional.
- Version-aware launcher, connection status and server restart/stop controls.
- Model relinking and preparation from the current game build when recovering projects.
- Layer lock, groups, multi-selection, image alignment, horizontal/vertical flip and transform reset.
- Brush hardness, opacity, spacing, footprint cursor and tile-based paint undo.
- Part masks and 2D rectangular selections; shared UVs are protected by default for masked painting.
- Saved preparation queues with ordering, pause/resume and lower process priority.
- Model cache size display, protected deletion, re-extraction and engine-specific cache separation.
- Recursive PNG/DDS skin-folder import with path/name matching.
- Overlapping image selection by Alt+click or a layer chooser.
- Lighting presets, game screenshot reference, WebGL diagnostics and 2D fallback.
- Memory buffer display, flattening, history cleanup and compressed large-data requests.

## Notes / 안내

Korean and English UI are included. Save important work as a `.wowskin` project too.
Shared game UVs cannot be made independent by the editor; protected regions may remain unpainted.
Lighting presets provide a preview; compare the final appearance in-game.
Material-channel editing, PSD layers and automatic skin installation are outside this release.

v0.1 remains available in the previous release.
