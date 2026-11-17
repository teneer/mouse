# 구현 및 작업 이력

> 2026-11-18 갱신: 현재 범위·구현·검증은 [원본 화면 복원 기록](REFERENCE_RESTORATION.md)을 우선한다. 전자칠판은 현재 제외, 명렬 자동 보상은 폐기, 원본 화면 복원이 기준이다. 아래 초기 계획/이력은 당시 기록이며 현 상태와 구분한다.


기준일: 2026-11-16 (KST)

## 1. Git 기준

- 저장소: `teneer/mouse`
- 초기 작업 브랜치: `class-revolution`
- 현재 작업 브랜치: `main`. 프로젝트 변경은 `클래스레볼루션/` 안에서 커밋하고 푸시한다.
- 새 프로젝트 폴더: `클래스레볼루션/`
- 브랜치 생성 기준: `main`의 커밋 `4d879dfc42d492b5dcef23e39c61f2ee4dd7cc65`
- 초기 구현 기준 커밋: `7ebdf3c514e4d0d8f3ba2d6761f42d86208743f2`
- README 추가 커밋: `1e85a40c9011caf30f38f7fcd81b573b718e8ac4`
- 에셋 매핑 문서 추가 커밋: `1babb08ab55d98de5c1cb7661e19a4d29b54c90c`

Work 시작 시 GitHub의 `main` 최신 커밋을 확인한다.

## 2. 전자칠판 복사

- 원본 경로: `만능칠판-test/`
- 확인된 버전: `6.0.0`
- 복사 위치: `클래스레볼루션/modules/whiteboard/`
- 원본 폴더는 수정하지 않았다.
- 원본의 83개 파일을 복사했다. 원본 README는 `README-UPSTREAM.md`로 이름을 바꿨다.
- `script.js`의 Git blob SHA는 원본과 복사본이 모두 `27b337d0c6596665681f15bfadadd481ca5002d8`로 일치함을 확인했다.
- 클래스레볼루션용 `index.html`에서 문서 제목을 변경하고 `board-only.css`를 연결했다.
- `board-only.css`는 기존 6.0의 점수판 패널·분할 조절 UI를 숨긴다. 실제 브라우저에서 스크립트 초기화와 중복 동작 여부를 검증해야 한다.

## 3. 신규 앱 골격

추가된 핵심 파일:
- `index.html`, `app.css`, `app.js`
- `core/db.js`, `core/events.js`, `core/score-engine.js`, `core/feedback.js`
- `modules/scoreboard.js`, `modules/growth.js`, `modules/checklist.js`
- `modules/whiteboard/index.html`, `modules/whiteboard/board-only.css`, `modules/whiteboard/README-UPSTREAM.md`

구현된 초기 동작:
- 네 가지 모드: 전자칠판, 점수판, 학급 성장, 체크리스트
- IndexedDB 로컬 DB
- BroadcastChannel 및 storage event를 이용한 탭 이벤트 전달
- 학생 명단 붙여넣기 및 모둠 생성
- 개인 점수 증감과 모둠 점수 합계
- 양의 개인 점수 기여 10개가 쌓이면 학급 점수 1점으로 전환
- 체크리스트 날짜 이동 및 체크/기호/1~5/숫자 입력
- 체크 항목에 보상 점수를 설정한 경우 처음 체크될 때 개인 점수에 반영
- 공통 팝업 및 사운드
- 전체 DB JSON 백업/복원

## 4. 사운드 파일

사용자가 첨부한 MP3 9개를 `assets/audio/`에 복사했다. 파일 크기뿐 아니라 Git blob SHA-1도 저장소의 기존 `만능칠판-test/score/Sound/` 파일과 각각 일치하는 것을 확인했다. 따라서 동일 바이너리다.

## 5. 현재 검증 상태

- GitHub 브랜치·파일 존재 확인: 완료
- 전자칠판 원본/복사본의 주요 파일 해시 비교: 일부 완료
- 사용자 ZIP 내부 PNG 개수·해상도 조사: 완료
- MP3 9개 바이너리 동일성 확인: 완료
- 초기 버전 브라우저 검증: [QA 체크리스트](QA_CHECKLIST.md) 참고
- `assets.zip`과 `avatar fx.zip`의 PNG 161개를 앱 경로에 배치: 완료. 원본 PNG의 해상도를 확인했다. 성장 이미지의 배포본은 원본과 픽셀이 같고 제작 환경 메타데이터를 제거했다.
- 동작 중인 화면 녹화·회귀 테스트: **미실시**

## 6. 작업 중 확인된 주의점

- 성장 화면의 배경·마을 이미지 및 점수판·성장·체크리스트의 220px 아바타 참조 경로를 연결했다.
- 현재 점수 엔진은 개인 양수 점수만 성장 기여로 적립하고, 감점은 기존 기여를 취소하지 않는다.
- 현재 학생 명단 입력은 단순 CSV/탭 구분 파서이며, 헤더·중복·수정·삭제·휴지통 처리가 충분하지 않다.
- 체크리스트의 네 입력 유형과 보상 방식은 현재 구현 내용이지, 세부 사용자 요구가 모두 확정됐다는 뜻은 아니다.
- 레거시 앱의 초기 데이터와 계산값에는 불일치가 있으므로 수식을 그대로 복사하지 않는다.
