# CLAUDE.md — COMPANY-WORK-OS (저장소 dlehdwo85/dagym-workspace)

세션 시작 시 **HANDOFF.md → NEXT_ACTION.md → WORK_STATUS.md → TEST_REPORT.md** 순서로 읽고 이어서 작업한다.
세션 종료 전에는 자기 담당 기록을 갱신하고 커밋·푸시한다.

## 클라우드·로컬 동시 수정 방지 (HANDOFF.md 4번)
- `main` = 운영 배포 브랜치(Vercel Production, https://dagym-workspace.vercel.app). **2026-10-13 대표 지시: 작업이 끝나면 바로 `main` 에 푸시한다** (PR·승인 대기 없음). 푸시 전에 `git fetch` → `origin/main` merge → 할 수 있는 시험(typecheck·build·API·E2E)을 돌리고, 문제가 생기면 운영 화면에서 확인한 뒤 후속 커밋으로 바로 고친다.
- 클라우드 세션: `claude/cool-pascal-h2e787` 에서 작업하고 같은 커밋을 `main` 에도 푸시, `src/ db/ tests/ scripts/ public/ .github/workflows/` 와 루트 문서 담당.
- 로컬 Claude Code: `main` 기준으로 작업(필요하면 `local/*`)하고 `main` 에 바로 푸시, `docs/handoff/LOCAL_LOG.md`·`docs/handoff/*`, 필요 시 `mobile/android`·`mobile/ios` 네이티브 설정 담당. 상대 영역은 직접 고치지 말고 LOCAL_LOG 의 "클라우드 요청"에 적는다.
- 강제 푸시·rebase 금지, merge 로 합친다. 비밀값(.env*, google-services.json, keystore, .p8)은 커밋하지 않는다.

## 프로젝트 원칙
- 사내 **자체** 업무·일정 서비스. Asana·Google Calendar 는 참고 대상. 직원은 우리 계정만으로 모든 핵심 기능을 쓴다.
- Google Calendar 동기화는 선택 기능(기본 꺼짐, FEATURE_GOOGLE_SYNC=1). 핵심 기능이 이에 의존하면 안 된다.
- 구조: Next.js 15 `src/app`, 서버 로직 `src/lib`, 화면 `src/components`, SQL 마이그레이션 `db/migrations`(추가형만), 앱 `mobile/`(Capacitor 8)
- 명령: `npm run typecheck` · `npm run build` · `npm test`(API 통합) · `npm run test:e2e`(Chromium) — Windows 에서는 CI/WSL 로 시험
- 권한 검사는 서버(`src/lib/access.ts`)에서. 다른 조직 데이터는 404 로 숨긴다. 시간대 기본값 Asia/Seoul.
- 앱은 빌드 / 내부 테스트 / 제출 / 심사 통과 / 설치 가능을 구분해 기록한다. 가짜 서버로 통과한 시험을 실제 연동 완료로 보고하지 않는다.
- 비밀값·대표 개인정보는 저장소(공개)에 쓰지 않는다.
