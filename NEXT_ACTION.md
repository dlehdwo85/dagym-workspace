# 다음 작업과 재개 방법

마지막 갱신: 2026-10-13 (클라우드)

## 재개 방법
- **클라우드 세션**: `HANDOFF.md` → 이 파일 → `WORK_STATUS.md` → `TEST_REPORT.md`를 읽은 뒤, `git fetch origin`으로 `local/*` 브랜치와 `docs/handoff/LOCAL_LOG.md`의 "클라우드 요청"을 확인합니다.
- **로컬 Claude Code(Windows)**: `HANDOFF.md` 3번으로 clone 하고 `local/ops-setup` 브랜치를 만든 뒤 5번의 L-작업을 진행합니다.
- 검증 명령(Linux·WSL·CI): `npm ci && npm run build && npm test && npm run test:e2e` / 배포 후 `node scripts/verify-prod.mjs https://<운영주소>`

## 1순위 — 운영 배포 (로컬 담당, PC 브라우저 로그인 필요)
HANDOFF 5번 L-1 → L-2 → L-3 → L-4 순서로 진행합니다. 끝나면 `docs/handoff/LOCAL_LOG.md`에 운영 주소를 적고 푸시합니다.
→ 클라우드가 이어서 할 일: `verify-prod.mjs`로 운영 점검, 운영 URL로 E2E(검수용 데이터만), 정기 실행·백업 실행 결과 확인, TEST_REPORT ⑩ 갱신

## 2순위 — 앱 출시 (로컬: 계정·키·실기기 / 클라우드: 워크플로·코드)
1. 로컬: L-8(D-U-N-S, Apple $99/년, Google Play $25) → L-5(Firebase) → L-6(Android 서명 키) → L-9·L-10(업로드 키)
2. 클라우드: Secrets가 등록되면 `release.yml`을 실행합니다(Play 내부 테스트·TestFlight). 실패하면 원인을 고칩니다.
3. 로컬: L-7 실기기 검증(설치·로그인·앱을 닫은 상태 푸시·알림 탭 이동·사진 첨부·일정 변경) → `docs/handoff/DEVICE_TEST.md`
4. 클라우드: 심사용 계정 준비 문구, 스토어 설명 확정, Unlisted(iOS) 신청 문안

## 대표 결정이 필요한 것
- ✅ `main` 생성·병합 완료(2026-10-13). **남은 1분 작업**: GitHub → Settings → General → Default branch 를 `main` 으로 변경 (https://github.com/dlehdwo85/dagym-workspace/settings) — 정기 실행(tick) 예약과 새 clone 이 main 을 쓰게 됨
- 저장소 공개 유지 여부 (비공개로 바꾸면 10분 정기 실행이 Actions 무료 한도를 넘음 → OPERATIONS 7번)
- 개인정보 보호책임자 이름·연락처

## 클라우드가 계속할 독립 개발 (로컬 작업과 무관)
- 화면 사용성 개선(모바일 업무 등록·사진 첨부 흐름 간소화), 접근성 점검
- 시험 보강(권한 경계, 반복 일정 경계값), 시험 결과를 TEST_REPORT에 반영
- 선택 후보: 이메일 초대 자동 발송, 업무 일괄 편집

## 선택 기능 (필수 아님)
- Google Calendar 동기화: 필요해지면 Google Cloud OAuth 클라이언트를 만들고 `FEATURE_GOOGLE_SYNC=1`을 켭니다. 그다음 실제 계정으로 검증합니다(테스트용 보조 캘린더만 사용).
- Asana·Google Calendar 로그인 후 참고 검수(L-11)

## 로컬 요청 처리 (클라우드 회신란)
2026-10-13 · `local/ops-setup`(f4ad95a) 를 클라우드 브랜치에 merge 후 처리. 모두 시험으로 확인함.
| 요청 | 처리 | 확인 |
|---|---|---|
| R-1 migrate.mjs Windows 경로 | ✅ `fileURLToPath(import.meta.url)` 로 교체 | 이제 Windows PowerShell 에서 `node scripts/migrate.mjs` 실행 가능 → **HANDOFF L-2 진행 가능** |
| R-2 멘션 입력 UUID 노출 | ✅ 입력창에는 `@이름` 만, 전송 때 내부 표기로 변환 (`src/lib/mentions.ts`) | E2E: 입력값 검사, 캡처 `docs/screens/26-mobile-mention-input.png` |
| R-3 멘션 목록 권한 | ✅ 새 API `GET /api/tasks/:id/mentionable` — 업무를 볼 수 있는 사람만, 화면에 안내 문구 | API 시험 + E2E(다른 현장 직원 미표시) |
| R-4 첨부 크기 0.0MB | ✅ 1MB 미만 KB, 1KB 미만 B | — |
| R-5 버튼 줄바꿈 | ✅ 공통 버튼에 `whitespace-nowrap` | 캡처 `27-mobile-checklist.png` |
| R-6 일정별 알림 | ✅ 일정마다 최대 5개(시작 시각~1주 전), 비우면 알림 없음, "각자 기본 설정 따르기" 기본값. 반복 일정은 시리즈 전체에 적용. 정기 실행이 늦어도 가장 가까운 지난 알림 1회만 | API 시험(중복 제거·1회·끄기), E2E, 캡처 `28-mobile-recur-reminder.png` |
| R-7 반복 종료·N번째 요일 | ✅ 반복 편집기(업무·일정 공용): 매주 ○요일, 2주마다, 매월 N일, **매월 N번째/마지막 ○요일**, 매년 + **계속/종료일까지/횟수** | API 시험(둘째 화요일 3회, 종료일 당일 포함 6회), E2E(매주 6회 저장) |
| R-8 시험 Windows 호환 | ✅ OS 임시 폴더, `process.execPath`+`next/dist/bin/next`, openssl 대신 `selfsigned` 패키지 | Linux 에서 전체 통과. **Windows 에서 돌리려면**: PostgreSQL + `TEST_DATABASE_URL`, E2E 는 `npx playwright install chromium` 1회 — 로컬 실행 결과를 LOCAL_LOG 에 남겨 주세요 |
| Asana 로그인 검수 | 대기 (대표 로그인) | — |
