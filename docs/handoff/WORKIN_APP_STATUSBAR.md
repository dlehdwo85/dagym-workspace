# 앱 상단 바 겹침 · 가독성 (대표 휴대폰 캡처 2026-10-13)

캡처: `local-screens/50-android-statusbar-overlap.jpg` (Android, 워크인 내부 테스트 버전코드 8)

## 증상
- 휴대폰 상태바(시계·알림 아이콘·배터리)와 앱 머리줄("워크인" 로고·검색·계정)이 겹침.
- 대표: "글씨나 아이콘 가독성 좋게, 너무 크게 만들진 말 것".

## 원인
1. targetSdk 36(Android 15+)은 edge-to-edge 강제 → WebView 가 상태바 뒤까지 그림. Android WebView 는 `env(safe-area-inset-top)` 이 0 으로 오는 경우가 많음.
2. `src/components/AppShell.tsx:246` 모바일 머리줄이 `h-12`(48px 고정) + `pt-[env(safe-area-inset-top)]` — 여백이 생겨도 고정 높이 안에서 내용이 눌림.

## 수정 요청 (클라우드)
1. `mobile/capacitor.config.ts` 에 Capacitor 8 SystemBars 설정: `plugins: { SystemBars: { insetsHandling: 'css' } }` (안드로이드에서 `--safe-area-inset-top/bottom` CSS 변수 주입). 상태바 글자색은 흰 배경에 맞게 어둡게(style: 'DARK' / 'LIGHT' 중 배경 대비 맞는 쪽).
2. 머리줄: `h-12` → `min-h-12` + `pt-[var(--safe-area-inset-top,env(safe-area-inset-top))]`, 하단 탭·시트도 `var(--safe-area-inset-bottom, env(safe-area-inset-bottom))` 로 통일.
3. 가독성(과하지 않게): 하단 탭 글자 11→12px·아이콘 22→24px·선택 탭 굵게, 머리줄 검색·계정 아이콘 터치 영역 44px, 회색 보조 글씨 대비 4.5:1 이상(현재 "일정 없음" 등 너무 옅음), 홈 카드 제목 15–16px 유지.
4. 앱 새 빌드 필요(네이티브 설정 변경) — 커밋 후 로컬이 Android(versionCode 증가)·iOS TestFlight 다시 올림.
5. 확인: Android 15·16 실기기(대표 폰), iOS 노치/다이내믹 아일랜드에서 겹침 없음.
