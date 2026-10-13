# WoWS Skin Editor v0.2.3

ZIP을 풀고 `Start-Workshop.cmd`를 실행하세요. 설치된 월드오브워쉽 경로를 자동으로 탐지합니다.

Extract `WoWS_Skin_Editor-v0.2.3-Windows.zip` and run `Start-Workshop.cmd`.
The editor automatically detects the installed World of Warships folder.

## 변경 내용 / Changes

- **작업 관리 → 모델 캐시 → 전체 모델 캐시 삭제** 버튼을 추가했어요.
- 삭제 전에 추출된 함선 모델과 텍스처 파일도 함께 삭제되고, 다음 사용 시 재추출이 필요하다는 확인창을 표시해요. 취소하면 삭제하지 않아요.
- 현재 편집 중인 함선은 제외해요. 저장한 프로젝트와 자동 백업은 유지해요.
- 추출 대기열이나 진행 중인 준비 작업이 있으면 전체 삭제를 막아요.
- 개별 함선 삭제 확인창에도 추출 파일 삭제 안내를 추가했어요.

- Add **Workspace → Model cache → Delete all model caches**.
- Ask for confirmation before deleting extracted models and textures. Cancelling keeps the caches.
- Keep the currently open ship, saved projects and automatic backups.
- Block bulk deletion while preparation jobs are queued or active.
- Clarify that individual cache deletion also removes extracted files.

함선 목록·아이콘 등 보조 캐시는 유지하고, 추출된 모델 캐시를 지우는 기능이에요.
This removes extracted model caches; auxiliary caches such as catalogs and icons are retained.
