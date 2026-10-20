# WorkIn 워크인 로고 자산 팩 — 17차-3D **S3(강하게)** 확정본 (2026-10-20)

대표 확정: 17차-3D 의 S3. 딥그린 그라데이션(#13866F→#0B5C4E, 기준색 #0F766E) 둥근 사각 바탕 + 주황(#FBBF24→#F59E0B) 헤더 달력 + 흰 몸체 + 그린(#15837A→#0B625B) 체크 + 우하단 종이 말림(13). 생성 AI 없음 — 전부 코드(CSS/SVG 를 Chrome 으로 렌더 → sharp 후처리, 글자는 Pretendard 윤곽선).

원본·재생성 스크립트: `C:/Users/User/Desktop/workin-logo-drafts/round17-3d/render.html`(안별 CSS 변수) → `scratchpad/s3/render.js`(2048px 렌더) → `build.js`(아래 전부 생성). 바꾸기 전 모바일 원본은 `round17-3d/_backup_mobile/`.

## 파일 용도표

| 파일 | 크기 | 알파 | 용도 |
|---|---|---|---|
| `icon-1024.png` | 1024 | 없음(불투명) | **iOS App Store/앱 아이콘** 원본. 정사각·마스크 없음(iOS 가 둥글게 깎음). `mobile/ios/.../AppIcon-512@2x.png` 와 동일 |
| `icon-1024-rounded.png` | 1024 | 투명 모서리 | 둥근 사각(22.5%) 완성형. 웹·문서·발표 자료에 그대로 올리는 기본 아이콘 |
| `icon-512.png` / `icon-192.png` | 512 / 192 | 투명 | PWA `manifest` icons (purpose `any`) |
| `icon-maskable-512.png` | 512 | 없음 | PWA `manifest` icon purpose `maskable` — 아이콘 80% + 딥그린 #0F766E 꽉 채움(안전영역 확보) |
| `apple-touch-icon-180.png` | 180 | 없음 | `<link rel="apple-touch-icon">` (홈 화면 추가) |
| `favicon-48.png` / `-32.png` / `-16.png` | 48/32/16 | 투명 | `<link rel="icon" type="image/png" sizes=…>` |
| `favicon.ico` | 16·32·48 멀티 | 투명 | `/favicon.ico` (PNG 압축 ICO, Vista+ / 모든 현대 브라우저) |
| `android-adaptive-fg-432.png` | 432 (108dp@4x) | 투명 | Android adaptive icon **foreground** — 66dp 안전원에 맞춰 달력을 0.88 로 축소·중앙. 배경 없음 |
| `android-adaptive-bg-432.png` | 432 | 없음 | Android adaptive icon **background** — S3 와 같은 그라데이션+하이라이트(사각 전체) |
| `android-legacy-48/72/96/144/192.png` | m/h/x/xx/xxxhdpi | 투명 모서리 | API 25 이하 런처(`mipmap-*/ic_launcher.png`) — 둥근 사각 불투명 본체 |
| `notification-ic_stat-96.png` / `.svg` | 96 (24dp@4x) | 투명 | 상태바 알림 아이콘 — **흰 단색 실루엣만**(헤더 채움·몸체 테두리·고리·체크). Android 는 `drawable/ic_stat_workin.xml` 벡터로 넣음 |
| `splash-2732.png` | 2732×2732 | 없음 | 스플래시(iOS `Splash.imageset` 전부, Android `drawable*/splash.png` 원본, `mobile/assets/splash*.png`). 배경 #0F766E 단색, 중앙 아이콘 600px, 아래 'WorkIn 워크인' 흰 글자. 중앙 1200px 안에 내용이 있어 어떤 비율로 잘라도 안전 |
| `og-1200x630.png` | 1200×630 | 없음 | `og:image` / 카카오톡·슬랙 링크 미리보기 — 왼쪽 아이콘, 오른쪽 'WorkIn 워크인 — 업무도, 영업도, 마케팅도 한 화면에서', 배경 #F8FAFC |
| `ig-profile-1080.png` | 1080 | 없음 | 인스타그램·카카오 채널 프로필 — 딥그린 바탕, 아이콘 70%(원형 크롭 안전) |
| `lockup-horizontal-2400x720-light.png` | 2400×720 | **투명** | 가로 록업(아이콘 + WorkIn 워크인), 밝은 배경용(글자 #0F172A / 워크인 #0F766E) |
| `lockup-horizontal-2400x720-dark.png` | 2400×720 | **투명** | 어두운 배경용(글자 흰색 / 워크인 #5EEAD4). 투명이라 파일 탐색기 미리보기에선 글자가 안 보일 수 있음 — 어두운 바탕 위에 올려 쓰기 |
| `lockup-horizontal-2400x720-light.svg` / `-dark.svg` | 벡터 | — | 같은 록업의 SVG. 아이콘은 SVG 필터로 S3 를 재현한 벡터, 글자는 윤곽선(글꼴 설치 불필요). 인쇄·대형 출력용 |
| `icon-s3-vector.svg` | 벡터 1024 | — | 아이콘만 벡터 재현본. Chrome 렌더 PNG 와 거의 같고(바탕 안쪽 음영이 아주 조금 더 진함) 확대 출력에 씀. **앱·웹 아이콘은 PNG 를 기준**으로 한다 |
| `wordmark.svg` / `wordmark-white.svg` | 벡터 1530×330 | — | 글자만(WorkIn Bold + 워크인 Medium, Pretendard 윤곽선). 짙은 글자 / 흰 글자 |

### 색
- 딥그린 기준 `#0F766E` (배경 단색·알림 강조색·maskable 여백) · 그라데이션 `#13866F → #0B5C4E`
- 주황 헤더 `#FBBF24 → #F59E0B` · 체크 `#15837A → #0B625B` · 글자 `#0F172A` / 보조 `#475569` / 연회색 바탕 `#F8FAFC`

### 적용 현황 (2026-10-20)
- `mobile/ios` AppIcon 1024·Splash.imageset 9장 — 교체(커밋 전)
- `mobile/android` mipmap-{l,m,h,x,xx,xxx}dpi 런처 4종, anydpi-v26 XML(inset 제거·108dp PNG 직접 참조), drawable*/splash.png 25장, `ic_stat_workin.xml`, `ic_launcher_background.xml` — 교체(커밋 전)
- `mobile/assets` (capacitor-assets 원본 5장) — 교체
- 웹(`public/`·manifest·favicon·og)은 클라우드 담당 영역 → 이 폴더 파일을 그대로 복사해 쓰면 됨 (`icon-192/512`, `icon-maskable-512`, `apple-touch-icon-180`, `favicon*`, `og-1200x630`)
