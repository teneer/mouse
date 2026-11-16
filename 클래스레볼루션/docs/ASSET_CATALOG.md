# 사용자 첨부 에셋 카탈로그

조사 기준: 2026-11-16. 원본 첨부파일의 ZIP 목록, PNG 해상도, 파일 크기, MP3 Git blob 해시를 확인했다.

## 1. 원본 이미지 ZIP

### `assets.zip` — 1,001,130 bytes / PNG 21개

| 파일 | 해상도 | 용도 추정 |
|---|---:|---|
| bg-class-clouds-way.png | 1500×660 | 별길/하늘 배경 |
| bg-effect-wow-cloud.png | 2400×2000 | 구름·효과 오버레이 |
| sp_board_buttons.png | 1250×740 | 보드 UI 버튼 스프라이트 |
| sp_board_images.png | 1660×580 | 보드 이미지 스프라이트 |
| sp_board_layout.png | 380×570 | 보드 레이아웃 스프라이트 |
| sp_board_sky_object2.png | 1920×3240 | 하늘 오브젝트 스프라이트 |
| sp_board_sky_object3.png | 1920×3240 | 하늘 오브젝트 스프라이트 |
| sp_board_sky_object4.png | 1920×3240 | 하늘 오브젝트 스프라이트 |
| sp_board_sky_object5.png | 1920×3240 | 하늘 오브젝트 스프라이트 |
| sp_board_sky_stars.png | 1920×3240 | 별 스프라이트 |
| sp_board_sky_village.png | 2253×250 | 하늘/마을 장식 |
| sp_board_tree.png | 640×560 | 나무·성장 UI 스프라이트 |
| sp_board_tree_branch1.png | 370×1080 | 나무 가지/성장 단계 |
| sp_board_tree_branch2.png | 370×1080 | 나무 가지/성장 단계 |
| sp_board_tree_branch3.png | 370×1080 | 나무 가지/성장 단계 |
| sp_board_tree_branch4.png | 370×1080 | 나무 가지/성장 단계 |
| sp_board_tree_branch5.png | 370×1080 | 나무 가지/성장 단계 |
| sp_effect_wow.png | 1240×950 | 축하/효과 스프라이트 |
| sp_layout.png | 590×470 | 레이아웃/아이콘 스프라이트 |
| 나무.png | 160×643 | 세로형 나무 이미지 |
| 나무편집.png | 250×1005 | 편집된 세로형 나무 이미지 |

ZIP 내부 경로는 `assets/`다. PNG 21개를 `assets/visuals/`에 원본 파일명으로 배치했다.

### `avatar fx.zip` — 1,907,712 bytes / PNG 140개

- 아바타 ID: `001`~`070`, 총 70종
- 각 ID별 220 버전 1개, 400 버전 1개
- `avatar_NNN_220.png`: 220×138
- `avatar_NNN_400.png`: 400×250
- ZIP 내부 최상위 폴더: `avatar fx/`

현재 점수판 코드는 `assets/avatars/220/avatar_NNN_220.png`를 참조한다. 220 버전은 `assets/avatars/220/`에, 상세 보기 후보인 400 버전은 `assets/avatars/400/`에 각각 70개 배치했다.

### `클래스123 복원프로젝트.zip` — 6,609,992 bytes / PNG 171개

구성:
- `avatar_NNN_000.png`: 70개, 200×250
- `avatar_NNN_000_180.png`: 70개, 180×225
- `avatar_NNN_000_110.png`: 11개, 110×137
- UI/배경/화면 자료: 20개
  - class123.ac_board 계열 6개
  - screenshot- 타임스탬프 계열 4개
  - 2025-03-25/27 날짜형 스크린샷 9개
  - download.png 1개

이 ZIP은 복원 프로젝트의 과거 아바타 및 화면 참고 자료다. `avatar fx.zip`과 섞어 덮어쓰지 말고 별도 레거시 경로에 보존한다.

## 2. 사운드 파일

사용자 첨부 MP3 9개. GitHub `클래스레볼루션/assets/audio/`에 복사되어 있다.

| 파일 | bytes |
|---|---:|
| Confirm.MP3 | 15,096 |
| Egg down.MP3 | 20,530 |
| Egg up.MP3 | 20,530 |
| Minus.MP3 | 11,334 |
| Minus2.MP3 | 46,443 |
| Plus.MP3 | 23,455 |
| Plus2.MP3 | 46,861 |
| Success orinal.MP3 | 77,372 |
| Success small.MP3 | 77,372 |

9개 모두 사용자 첨부 파일의 Git blob SHA-1과 원본 저장소 `만능칠판-test/score/Sound/`의 동일 이름 파일 SHA-1이 일치한다. 즉, 저장소 원본과 사용자 첨부본은 동일 바이너리다. `orinal` 철자는 원본 파일명 그대로 보존한다.

참고: 원본 전자칠판의 `score/Sound/`에는 사용자 첨부 9개 외에 `result.MP3`, `spin.MP3`도 있다. 이 두 파일은 전자칠판 복사본 안에는 있으나 클래스레볼루션의 `assets/audio/`로는 따로 복사하지 않았다.

## 3. 화면 녹화 원본

| 파일 | 길이 | 크기 | 참고 |
|---|---:|---:|---|
| screen_1743084583502.mp4 | 111.466초 | 16,344,008 bytes | 별길·알·점수 변환·모둠/개인 점수 화면 |
| screen_1743085219666.mp4 | 484.700초 | 76,038,077 bytes | 모둠 카드·랜덤 선택·룰렛·사다리타기 |
| screen_1743085688672.mp4 | 255.066초 | 17,936,534 bytes | 체크/기록 매트릭스·학생별 화면·모달·타이머 |

세 영상은 사용 흐름 참고 자료다. 영상에 나온 모든 기능이 현재 필수 개발 범위라는 의미는 아니다. 세부 프레임 안내는 `docs/REFERENCE_VIDEO_GUIDE.md` 참고.

## 4. 파생 미리보기 이미지

원본 ZIP/영상에서 확인을 돕기 위해 만든 미리보기이며 원본 에셋이 아니다.
- `avatars_contact.jpg` — 70종 아바타의 220/400 버전 비교
- `sprites_contact.jpg` — 배경·스프라이트·나무 이미지 모음
- `restore_contact.jpg` — 클래스123 복원 프로젝트의 화면 자료 모음
- `bg-composite.jpg` — 별길 배경 스프라이트를 확인하기 위한 합성 미리보기
- `video1_contact.jpg`, `video2_contact.jpg`, `video3_contact.jpg` — 영상 상세 프레임 접촉 시트
- `video1_sheet.jpg`, `video2_sheet.jpg`, `video3_sheet.jpg` — 영상 대표 프레임 시트

## 5. 레거시 대시보드 소스

사용자가 별도 첨부한 세 파일:
- `index.html` — 17,714 bytes
- `app.js` — 44,907 bytes
- `style.css` — 56,995 bytes

이 파일은 `클래스 대시보드` 레거시 프로토타입이다. 현재 GitHub `클래스레볼루션/`에는 복사하지 않았다. 기능 참고 내용은 `docs/LEGACY_DASHBOARD_REFERENCE.md`에 정리했다.

## 6. 권장 배치 정책

1. 원본 ZIP은 삭제하거나 수정하지 않는다.
2. `assets.zip`의 PNG는 우선 `assets/visuals/` 아래에 원본 파일명을 유지해 배치한다.
3. `avatar fx.zip`은 `assets/avatars/fx/220/` 및 `assets/avatars/fx/400/` 또는 현재 코드 경로에 맞는 `assets/avatars/220/`, `assets/avatars/400/`로 분류한다.
4. `클래스123 복원프로젝트.zip`의 아바타는 `assets/avatars/legacy/`, UI 캡처는 `assets/reference/class123/`로 분리한다.
5. 현재 코드가 참조하는 `assets/avatars/220/avatar_NNN_220.png`와 `assets/visuals/bg-class-clouds-way.png`, `assets/visuals/sp_board_sky_village.png` 경로를 우선 맞춘다.
6. 스프라이트 시트는 이미지 파일 하나를 단일 이미지처럼 쓰지 말고 실제 프레임 좌표·크기를 확인해 사용한다.
7. 파일 배치 후 404, 투명도, object-fit, 화면 비율, 모바일 해상도를 확인한다.

## 7. 현재 GitHub 반영 상태

- 전자칠판 코드 복사: 완료
- 사용자 MP3 9개 복사: 완료
- `assets.zip` 및 `avatar fx.zip`의 PNG 161개 배치: 완료
- 클래스123 복원 이미지·화면 캡처 및 원본 ZIP: 첨부 자료로 보존
- 스프라이트 좌표/애니메이션 매핑: 미완료
- 영상 MP4 및 접촉 시트 GitHub 업로드: 미완료
