# 다음 작업과 재개 방법

## 재개 방법 (새 세션이 맨 먼저 할 일)
1. 이 파일 → `WORK_STATUS.md` → `TEST_REPORT.md` 순서로 읽습니다.
2. `git fetch origin && git checkout claude/cool-pascal-h2e787` (main이 생기면 main 기준으로 작업합니다)
3. 로컬 검증 환경:
   ```bash
   npm ci
   # PostgreSQL 16: workos/workos 사용자, workos_dev·workos_test DB
   cp .env.example .env.local   # 값 채우기
   npm run db:migrate && npm run dev
   npm run build && npm test && npm run test:e2e
   ```
4. 앱: `cd mobile && npm ci && npx cap sync`. Android는 `cd android && ./gradlew assembleDebug`(ANDROID_HOME 필요)로 빌드합니다.

## 대표에게 요청할 일 (한 번에 묶음, 비밀번호는 대화에 쓰지 않습니다)
| # | 할 일 | 위치 | 비용 | 끝나면 알려 줄 것 |
|---|---|---|---|---|
| A | Vercel에서 `dlehdwo85/dagym-workspace` 가져오기(Import) → Pro 요금제 확인 → Storage 탭에서 Neon Postgres 무료 생성·연결 | https://vercel.com/new | Pro $20/월(매월) | 프로젝트 주소 |
| B | 이 클라우드 환경 설정에 `VERCEL_TOKEN` 등록 (Vercel → Account Settings → Tokens). 이 토큰이 있으면 나머지 환경 변수 설정·마이그레이션·배포·검증을 제가 직접 합니다 | claude.ai 환경 설정 → 환경 변수 | 무료 | 등록 완료 여부만 |
| C | Cloudflare R2 버킷 생성 + API 토큰(객체 읽기·쓰기) → Vercel 환경 변수 `S3_*`와 GitHub Secrets에 등록 (B가 되면 제가 등록) | https://dash.cloudflare.com → R2 | 10GB까지 무료 | 버킷 이름 |
| D | 회사 메일이 Google Workspace인지 알려 주기 → Google Cloud 프로젝트에서 OAuth 동의 화면(Workspace면 Internal) + 웹 클라이언트 생성, 리디렉션 URI `https://<운영주소>/api/google/callback` | https://console.cloud.google.com/apis/credentials | 무료 | 클라이언트 ID·비밀값을 Vercel 환경 변수에 등록 |
| E | Firebase 프로젝트 생성 → 개발자를 편집자로 초대 (제가 Android·iOS 앱 등록과 서비스 계정을 처리) | https://console.firebase.google.com | 무료 | 초대 완료 여부 |
| F | D-U-N-S 번호 조회·신청 | https://developer.apple.com/enroll/duns-lookup/ | 무료 | 번호 |
| G | Apple Developer Program 조직 가입 + App Store Connect에 개발자 초대 | https://developer.apple.com/programs/enroll/ | $99/년(매년) | 팀 ID |
| H | Google Play Console 조직 계정 + 본인 확인 + 개발자 초대 | https://play.google.com/console/signup | $25(1회) | 초대 완료 |
| I | `main` 브랜치 생성·병합 승인, 저장소 공개 유지 여부 결정 | GitHub | — | 결정 |
| J | 개인정보 보호책임자 이름·연락처 | — | — | 텍스트 |
| (선택) K | Asana·Google Calendar 로그인 후 검수를 원하면 테스트 계정 준비 (현재 미검증으로 표시) | app.asana.com, calendar.google.com | — | |

## 계정이 준비되면 제가 할 일 (순서)
1. Vercel 환경 변수 설정(APP_SECRET·CRON_SECRET·VAPID 생성 포함) → `db:migrate` → 배포 → `/setup`으로 대표 계정 생성 → SETUP_SECRET 제거
2. GitHub 저장소 변수 `APP_URL`, 백업 Secrets 등록 → `tick`·`backup` 수동 실행 → 운영 상태 화면에서 확인
3. 운영 URL로 E2E 다시 실행 (운영 DB를 건드리지 않는 검수용 데이터만 사용)
4. Google OAuth 실제 연결 → 테스트용 Google 캘린더(새로 만든 보조 캘린더)로 양방향 시험. 기존 일정은 건드리지 않습니다
5. Firebase 설정 → 서명된 AAB → Play 내부 테스트 업로드 / iOS TestFlight 업로드 → 실제 기기에서 설치·로그인·푸시(앱이 닫힌 상태)·첨부·일정 변경 검증
6. Unlisted 배포 신청(iOS), 심사 대응
7. 모든 완료 기준 통과 후 대표 Gmail로 완료 알림 발송

## 남은 개선 후보 (기능 외)
- 이메일 초대 자동 발송(현재는 링크 복사 전달 방식)
- 일정 시작 전 알림(현재는 업무 마감 임박 알림만)
- Google 동기화 시 회사 참석자를 Google 초대로 보내는 옵션(현재는 메일 발송을 막으려고 sendUpdates=none으로 보냄)
