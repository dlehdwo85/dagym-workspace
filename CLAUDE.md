# CLAUDE.md — COMPANY-WORK-OS

세션 시작 시 **NEXT_ACTION.md → WORK_STATUS.md → TEST_REPORT.md** 순서로 읽고 이어서 작업한다.
세션 종료 전에는 WORK_STATUS.md·NEXT_ACTION.md·TEST_REPORT.md를 갱신하고 커밋·푸시한다.

- 구조: Next.js 15(App Router) `src/app`, 서버 로직 `src/lib`, 화면 컴포넌트 `src/components`, SQL 마이그레이션 `db/migrations`(추가형만), 앱 `mobile/`(Capacitor 8)
- 명령: `npm run typecheck` · `npm run build` · `npm test`(API 통합, 실제 서버+DB+가짜 Google) · `npm run test:e2e`(Chromium)
- 권한 검사는 반드시 서버(`src/lib/access.ts`)에서 한다. 다른 조직 데이터는 404로 존재를 숨긴다.
- 시간대 기본값은 Asia/Seoul. date 컬럼은 문자열 그대로 다룬다.
- 가짜 Google API로 통과한 시험을 "실제 Google 연동 완료"로 보고하지 않는다. 앱은 빌드 / 내부 테스트 / 제출 / 심사 통과 / 설치 가능을 구분해 기록한다.
- 비밀값·대표 이메일 같은 개인정보는 저장소(공개)에 쓰지 않는다.
