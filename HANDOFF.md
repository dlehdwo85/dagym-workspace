# 인계 문서 — 클라우드 ↔ 로컬 Claude Code 협업

마지막 갱신: 2026-10-13 · 작성: 클라우드 세션
**로컬에서 열면 먼저 이 문서를, 이어서 `NEXT_ACTION.md` → `WORK_STATUS.md` → `TEST_REPORT.md`를 읽습니다.**

## 1. 실제 확인된 저장소 정보 (2026-10-13, GitHub API 로 확인)
| 항목 | 값 |
|---|---|
| 저장소 이름 | `dagym-workspace` — **GitHub 저장소 이름**입니다 |
| 저장소 URL | https://github.com/dlehdwo85/dagym-workspace |
| clone 주소 | `https://github.com/dlehdwo85/dagym-workspace.git` |
| 공개 여부 | public (비밀값은 들어 있지 않음) |
| 브랜치 | **`main`** — 2026-10-13 대표 지시로 생성, 검증 완료 기준 브랜치(운영 배포 대상). `claude/cool-pascal-h2e787` — 클라우드 작업 브랜치. GitHub **기본 브랜치는 아직 `claude/cool-pascal-h2e787`** 이며 대표가 Settings 에서 `main` 으로 바꿔야 함 (이 환경은 저장소 설정 변경 권한이 없음) |
| 클라우드 작업 폴더 | `/home/user/dagym-workspace` — 클라우드 컨테이너 안에 저장소 이름과 같은 이름으로 clone 한 폴더입니다. 로컬 PC에는 없습니다 |
| 커밋·푸시 | 클라우드 작업은 모두 커밋·푸시합니다. 최신 커밋은 `git log -1 origin/claude/cool-pascal-h2e787`로 확인하세요 |

로컬 Claude Code의 "최근 폴더" 목록에 `dagym-workspace`가 없는 이유는 그 PC에서 한 번도 clone·열기를 하지 않았기 때문입니다. 아래 3번대로 clone 하면 열 수 있습니다.
기존 레지스트리(`dazim-hilink-integration/docs/development/PROJECT_REGISTRY.md`)에는 이 저장소가 아직 없습니다. 로컬에서 레지스트리에 추가할지는 로컬 세션이 정합니다.

## 2. 프로젝트 정의 (2026-10-13 범위 정정)
- 사내 **자체** 업무·일정 관리 서비스입니다. Asana·Google Calendar는 기능과 사용성의 **참고 대상**일 뿐이고, 연결해서 쓰는 중계 사이트가 아닙니다.
- 직원은 **우리 서비스 계정만으로** 모든 핵심 기능을 씁니다. 데이터는 우리 PostgreSQL과 S3 호환 저장소에 보관합니다.
- Google Calendar 동기화 코드는 남아 있지만 **선택 기능이고 기본 꺼짐**입니다(`FEATURE_GOOGLE_SYNC=1`일 때만 동작). 필수 완료 기준이 아닙니다.
- 운영 서비스는 Vercel(서버) + PostgreSQL + R2 + GitHub Actions 정기 실행으로 동작합니다. **로컬 PC가 꺼져도** 서버에서 동작합니다. 로컬 PC에서 상시 실행할 작업은 없습니다.

## 3. Windows 로컬에서 내려받고 열기
PowerShell에서:
```powershell
# (없으면) 도구 설치
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e      # Node 22 이상

# 기존 회사 저장소들과 같은 위치에 clone
cd C:\Users\User\Documents\DAGYM-DEV           # 폴더가 없으면: mkdir C:\Users\User\Documents\DAGYM-DEV
git clone https://github.com/dlehdwo85/dagym-workspace.git
cd dagym-workspace
git switch main                                # 기본 브랜치가 아직 claude/* 이면 main 으로 전환
git pull --ff-only

# 로컬 전용 작업 브랜치 만들기 (4번 규칙)
git switch -c local/ops-setup

# Claude Code 로 열기
claude
```
Claude Code 데스크톱 앱에서는 "폴더 열기"로 `C:\Users\User\Documents\DAGYM-DEV\dagym-workspace`를 선택합니다. 한 번 열면 최근 폴더 목록에 나타납니다.

로컬에서 웹을 직접 실행하는 것은 **선택**입니다. 로컬 전용 작업(5번)은 대부분 브라우저와 기기 작업이라 실행이 필요 없습니다. 실행하려면 PostgreSQL 16이 필요합니다(`winget install PostgreSQL.PostgreSQL.16`). `copy .env.example .env.local`로 값을 채운 뒤 `npm ci && npm run db:migrate && npm run dev`를 실행합니다.
자동 시험(`npm test`, `npm run test:e2e`)은 Linux 경로와 openssl을 쓰므로 **GitHub Actions(ci.yml)나 WSL**에서 돌립니다. 푸시하면 CI가 자동으로 실행됩니다.

## 4. 동시 수정 방지 규칙 (작업 범위 구분)
| | 클라우드 세션 (이 대화) | 로컬 Claude Code |
|---|---|---|
| 브랜치 | `claude/cool-pascal-h2e787` 에만 커밋 | `local/*` 브랜치에만 커밋 (예: `local/ops-setup`). **클라우드 브랜치에 직접 푸시하지 않음** |
| 담당 파일 | `src/` `db/` `tests/` `scripts/` `public/` `.github/workflows/` `mobile/www` `mobile/capacitor.config.ts`, 루트 문서(`REQUIREMENTS` `WORK_STATUS` `NEXT_ACTION` `TEST_REPORT` `HANDOFF` `CLAUDE.md`) | `docs/handoff/LOCAL_LOG.md`(로컬 작업 기록, 새로 만들기), `docs/handoff/` 아래 새 파일, 필요하면 `mobile/android/**`·`mobile/ios/**`의 네이티브 설정(서명·기기 시험으로 필요할 때만) |
| 상대 영역 수정이 필요하면 | `docs/handoff/LOCAL_LOG.md`의 요청란을 읽고 반영 | 직접 고치지 말고 `docs/handoff/LOCAL_LOG.md`의 "클라우드 요청"란에 적고 푸시 |
| 합치기 | 클라우드가 `git fetch` 후 `local/*`를 자기 브랜치에 merge (merge 커밋, 강제 푸시 없음) | 클라우드 브랜치를 `git pull`로 받아 자기 브랜치에 merge |
- 비밀값(토큰, `.env.local`, `google-services.json`, keystore, `.p8`/`.p12`)은 **어느 쪽도 커밋하지 않습니다**. 값은 Vercel 환경 변수와 GitHub Secrets에만 넣습니다.
- **`main` = 검증된 기준 브랜치 (운영 배포 대상)**. 클라우드는 `claude/cool-pascal-h2e787` 에서 개발·시험 후 `main` 에 merge 하고, 로컬은 `main` 에서 `local/*` 를 만들어 작업 후 PR 로 `main` 에 합친다. `main` 에는 CI(API·E2E) 통과한 커밋만 올린다.
- 새 작업을 시작할 때는 항상 `git fetch origin` 후 최신 `main` 을 자기 브랜치에 merge 하고 시작한다.

## 5. 로컬(PC 브라우저 로그인·기기·로컬 도구)이 필요한 작업 — 로컬 Claude Code 담당
| ID | 작업 | 필요한 것 | 결과를 남길 곳 |
|---|---|---|---|
| L-1 | Vercel에서 저장소 Import, Neon Postgres 연결, 환경 변수 등록(목록은 `docs/OPERATIONS.md` 3번), 첫 배포 | Vercel 로그인(대표 계정), Pro 요금제 $20/월 | 운영 주소를 LOCAL_LOG에 기록. 비밀값은 기록하지 않음 |
| L-2 | 운영 DB 마이그레이션: `$env:DATABASE_URL="<운영>"; node scripts/migrate.mjs` → `/setup`에서 대표 계정 생성 → Vercel에서 SETUP_SECRET 삭제 | L-1 | LOCAL_LOG |
| L-3 | Cloudflare R2 버킷 + API 토큰 → Vercel `S3_*` 등록, 버킷 CORS에 운영 주소의 PUT 허용 | Cloudflare 로그인 | LOCAL_LOG |
| L-4 | GitHub 저장소 설정: 변수 `APP_URL`, 백업 Secrets(`PROD_DATABASE_URL`, `BACKUP_PASSPHRASE`, `S3_*`, `BACKUP_S3_BUCKET`) → Actions에서 `tick`·`backup` 수동 실행 | GitHub 웹 로그인 | 실행 결과 링크 |
| L-5 | Firebase 프로젝트: Android(`kr.co.dagym.workos`)·iOS 앱 등록, APNs 키 업로드, 서비스 계정 키 → Vercel `FCM_SERVICE_ACCOUNT_JSON`, `google-services.json` → GitHub Secret `GOOGLE_SERVICES_JSON` | Google 로그인, Apple 계정(APNs) | LOCAL_LOG (파일은 커밋 금지) |
| L-6 | Android 업로드 키 생성(`keytool`) → 안전한 곳에 보관, base64로 GitHub Secrets(`ANDROID_KEYSTORE_*`) 등록, SHA-256 → Vercel `ANDROID_CERT_SHA256` | JDK(keytool) | LOCAL_LOG |
| L-7 | 실제 기기 검증: CI 산출물 APK를 USB(adb)나 파일로 설치 → 로그인·앱을 닫은 상태 푸시·알림 탭 이동·사진 첨부·일정 변경 | Android 휴대폰, (선택) Android Studio/adb | `docs/handoff/DEVICE_TEST.md` + 캡처 |
| L-8 | 개발자 계정: D-U-N-S, Apple Developer 조직($99/년), Google Play Console 조직($25) | 대표 본인 확인·결제 | LOCAL_LOG |
| L-9 | App Store Connect API 키(.p8) 발급 → GitHub Secrets (iOS는 Mac 없이 GitHub Actions macOS로 빌드·TestFlight 업로드) | Apple 계정 | LOCAL_LOG |
| L-10 | Play Console 서비스 계정 JSON → GitHub Secret(자동 업로드용), 내부 테스트 트랙 테스터 등록 | Play Console | LOCAL_LOG |
| L-11 | (참고용, 선택) Asana·Google Calendar 로그인 후 화면 검수 — 테스트 계정·테스트 공간만 사용, 기존 업무·일정 변경 금지 | PC Chrome 로그인 | `docs/research/LOGGED_IN_REVIEW.md` |

## 6. 클라우드가 계속 진행하는 독립 개발 (로컬 작업과 무관)
| ID | 작업 | 상태 |
|---|---|---|
| C-1 | 일정 시작 전 알림(사용자별 10분~하루 전) | ✅ 완료 (2026-10-13) |
| C-2 | Google 동기화를 선택 기능으로 분리(기본 꺼짐, 메뉴 숨김, API 404) | ✅ 완료 |
| C-3 | 운영 배포 직후 점검 스크립트(`scripts/verify-prod.mjs`: 헬스·로그인 페이지·보안 헤더·정기 실행) | 진행 |
| C-4 | iOS TestFlight 업로드·Android Play 업로드 워크플로 (Secrets가 생기면 바로 동작) | 진행 |
| C-5 | 화면 사용성 개선과 시험 보강 | 상시 |

## 7. 현재 완료 / 미완료 요약
- **완료**: 핵심 웹 기능 전체(권한·조직·업무·검토/승인·반복·4가지 보기·캘린더·반복 일정·충돌·알림·대시보드·템플릿·첨부·감사 기록), 정기 실행·백업·복원 코드, Android APK·iOS 시뮬레이터 빌드, 문서
- **시험**: API 50/50, 브라우저 E2E 19/19 — 클라우드와 GitHub Actions 모두 통과 (ci run 38284889665, mobile run 38284889671, 커밋 1bd09fb)
- **미완료**: 운영 배포(L-1~L-4), 앱 푸시 실기기(L-5·L-7), 스토어 배포(L-8~L-10), 로그인 후 참고 검수(L-11)
- **필요한 계정·도구**: Vercel(Pro), Neon(무료~), Cloudflare R2, GitHub 저장소 관리자, Firebase, Apple Developer(조직), Google Play Console(조직), D-U-N-S, Android 휴대폰(+adb), JDK(keytool), Git, Node 22
