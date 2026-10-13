# WoWS Skin Editor v0.2.1

ZIP을 풀고 `Start-Workshop.cmd`를 실행하세요. 설치된 월드오브워쉽 경로를 자동으로 탐지합니다.

Extract `WoWS_Skin_Editor-v0.2.1-Windows.zip` and run `Start-Workshop.cmd`.
The editor automatically detects the installed World of Warships folder.

## 변경 내용 / Changes

- 게임 패키지에서 원본 `camouflages.xml`을 바로 불러와요. 직접 수정한 XML 파일도 열 수 있어요.
- XML 파일은 32 MiB까지 지원해요. `<507C_group>`처럼 숫자로 시작하는 커스텀 그룹명도 읽고, 저장·프로젝트 복구·내보내기에서 원래 이름을 유지해요.
- 위장 색상표에 게임의 한국어·영어 `global.mo`에서 찾은 번역명을 표시해요. 여러 위장이 같은 색상표를 공유하면 이름을 함께 표시하며, `(+N)`은 추가 이름의 수예요.
- 3D 브러시는 화면상의 모양을 각 면에 투영해, 단차에서도 폭과 방향이 이어지도록 변경했어요.
- Shift 직선 작업 중 현재 각도를 표시해요. 각도는 자유롭게 조절할 수 있어요.
- 브러시 설정을 별도 창으로 옮겨 좁은 도구 막대에서 잘리는 문제를 수정했어요.

- Load the original camouflage XML directly from the installed game, or open a customized XML file.
- Support XML files up to 32 MiB and numeric custom element names, preserving their original names on save, project recovery and export.
- Show camouflage palette names from the selected language's game `global.mo`. `(+N)` counts additional names sharing that palette.
- Project the 3D brush footprint across visible faces for consistent width and direction on stepped surfaces.
- Show the current free-angle Shift line angle beside the pointer.
- Open brush settings in a separate dialog without toolbar clipping.

## 안내 / Notes

기존 브러시 자국은 자동으로 바뀌지 않아요. 새 도색에 변경된 방식이 적용돼요.
게임 원본은 읽기만 하며, 수정한 XML은 별도 파일로 저장해요. XML 색상표 편집은 지원하지만 3D 위장 합성 미리보기는 아직 지원하지 않아요.

Existing brush strokes remain unchanged; the new projection applies to new strokes.
Game originals are read only. Edited XML is saved separately. XML palette editing is supported; live 3D camouflage preview is not included.
