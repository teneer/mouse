# 만능칠판 4.1

수업 중 필기, 페이지 관리, 이미지·PDF 가져오기, 클립보드, 자동저장과 JSON 백업을 제공하는 정적 웹 칠판입니다.

## 진입 주소

- `index.html`: 기본 진입점
- `만능칠판.html`: 기존 한글 주소 및 즐겨찾기 호환용 진입점

두 HTML 파일은 의도적으로 같은 내용을 유지합니다.

## 배포 방법

GitHub Pages가 사용하는 폴더에 다음 항목을 함께 업로드합니다.

```text
index.html
만능칠판.html
assets/
```

이전 구조의 루트 `style.css`, `script.js`, `data.js`, `history.js`,
`clipboard.js`, `js/` 폴더와 새 구조를 혼용하지 마세요.

## 파일 구조

```text
.
├─ index.html
├─ 만능칠판.html
├─ assets/
│  ├─ css/
│  │  └─ app.css
│  └─ js/
│     ├─ app.js
│     ├─ core/
│     │  ├─ constants.js
│     │  ├─ data.js
│     │  ├─ history.js
│     │  ├─ clipboard.js
│     │  ├─ conflicts.js
│     │  └─ validation.js
│     └─ features/
│        ├─ canvas-tools.js
│        ├─ files.js
│        └─ previews.js
├─ tests/
├─ package.json
├─ TEST-RESULTS.txt
├─ BROWSER-CHECKLIST.md
└─ FILE-MANIFEST.json
```

## v4.1 구조 개선

- CSS를 `assets/css/app.css`로 이동
- 앱 진입 코드를 `assets/js/app.js`로 이동
- 저장·기록·검증 모듈을 `assets/js/core/`로 통합
- 캔버스·파일·미리보기 모듈을 `assets/js/features/`로 통합
- HTML과 테스트 import 경로 수정
- 내부 백업 버전을 `4.1.0`으로 통일
- `업데이트로그.txt` 삭제
- 변경 설명을 README와 GitHub 릴리스로 통합

## 테스트

```bash
npm test
```

자동 테스트와 별도로 `BROWSER-CHECKLIST.md`에 따라 실제 배포 주소,
교사용 컴퓨터 및 수업용 터치 기기에서 확인해야 합니다.

## 외부 라이브러리

Fabric.js와 PDF.js를 CDN에서 불러오므로 완전한 오프라인 환경에서는
관련 라이브러리를 프로젝트 내부에 포함하는 추가 작업이 필요합니다.
