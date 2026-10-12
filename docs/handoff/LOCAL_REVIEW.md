# 로컬 검수 보고서 (Windows PC)

작성: 2026-10-13 · 로컬 Claude Code · 브랜치 `local/ops-setup` · 기준 커밋 `35fdd3d` (origin/claude/cool-pascal-h2e787 과 동일)
PC: Windows 11 Home (BOOK-29S4OTOLT7)

## 1. 로컬 도구 실제 사용 가능 여부 (명령으로 확인)
| 도구 | 상태 | 비고 / 필요한 설정 |
|---|---|---|
| Git 2.55 | ✅ | |
| Node 24.20 / npm 11.19 | ✅ | `npm ci`·`typecheck`·`build` 통과 |
| GitHub CLI (`dlehdwo85`, scope repo·workflow) | ✅ | 푸시·Actions 조회 가능 |
| 브라우저 제어 (Playwright, Claude Operations 프로필) | ✅ | 로컬 서비스·Google Calendar 조작 확인 |
| Google Calendar 로그인 | ✅ 이미 로그인됨 | 읽기 전용으로만 검수 |
| Asana 로그인 | ⛔ 로그인 필요 | 대표 로그인 요청 (L-11) |
| Vercel CLI 59.10 | 🟡 설치됨, 로그인 안 됨 | L-1 때 `vercel login` (대표 계정) |
| PostgreSQL | 🟡 시스템 설치 없음 | 검수용으로 임시 폴더에 휴대용 PostgreSQL 17.5(`embedded-postgres` npm 패키지) 실행. 상시 설치는 `winget install PostgreSQL.PostgreSQL.16`(관리자 권한 필요) |
| `pg_dump`/`pg_restore`/`psql` | ⛔ | 백업·복원 스크립트를 이 PC에서 돌리려면 위 PostgreSQL 설치 필요. 운영 백업은 GitHub Actions 가 하므로 필수 아님 |
| Docker Desktop 29.6 | ⛔ 엔진이 뜨지 않음 | 실행 후 엔진 파이프가 생기지 않고 종료됨. Docker Desktop 을 직접 한 번 열어 약관/로그인/WSL 통합 상태 확인 필요. 이 프로젝트에는 필수 아님 |
| WSL2 Ubuntu | 🟡 있음, Node·PostgreSQL 없음, sudo 비밀번호 필요 | 자동 시험(`npm test`·`test:e2e`)을 로컬에서 돌리려면 WSL 에서 `sudo apt install -y postgresql nodejs npm` (대표가 sudo 비밀번호 입력). CI 에서 이미 돌고 있으므로 필수 아님 |
| JDK / keytool | ⛔ | L-6 에 필요: `winget install EclipseAdoptium.Temurin.21.JDK` |
| Android SDK / adb | ⛔ | L-7 에 필요: `winget install Google.PlatformTools` (adb 만) 또는 Android Studio. 휴대폰에서 USB 디버깅 켜기 |
| Xcode / Mac | ⛔ (Windows) | iOS 는 GitHub Actions macOS 러너로 빌드 (L-9) |

## 2. Windows 에서 서비스 실행 방법 (검증됨)
```bash
npm ci
# PostgreSQL 이 5433 에서 실행 중이라고 가정, .env.local 에 DATABASE_URL·APP_SECRET·SETUP_SECRET
npm run db:migrate        # ⚠ 현재 Windows 에서 실패 — 아래 3-1
npm run build && npx next start -p 3000
node docs/handoff/tools/seed-local.mjs .env.local   # 시험 계정(tests/helpers.mjs 와 같은 값) 생성
node docs/handoff/tools/check-scope.mjs <업무ID>    # 직원별 업무 조회·알림 범위 확인
```

## 3. 개발된 서비스 검수 결과 (Windows, 운영 빌드 `next start`, 실제 PostgreSQL)
| 항목 | 방법 | 결과 |
|---|---|---|
| 마이그레이션 | `npm run db:migrate` | ❌ Windows 경로 오류 (3-1). 경로만 고친 임시 사본으로 001~004 적용 성공 |
| 타입 검사·빌드 | `npm run typecheck`, `npm run build` | ✅ |
| 헬스체크 | `/api/health` | ✅ db ok, migration 004, Google 기능 꺼짐 |
| 최초 대표 생성·조직·초대·가입 | API (`/api/setup` → 조직 2개 → 초대 3명 → 수락) | ✅ |
| 대표 로그인·대시보드 | 브라우저 | ✅ `local-screens/01-win-dashboard.png` |
| 빠른 업무 등록(담당자·마감·소속·우선순위) | 브라우저 | ✅ 상세로 이동 `02-win-task-detail.png` |
| 파일 첨부 업로드·다운로드 (로컬 디스크 저장소) | 브라우저 + fetch | ✅ 44,315바이트 그대로 내려받음. ⚠ 크기 표시 "0.0MB" (3-2) |
| 댓글·멘션 | 브라우저 | ✅ 담당자에게 mention 알림 생성. ⚠ 입력창에 `@[이름](uuid)` 원문 노출 (3-3) |
| 다른 현장 직원 차단 | API: 판교 직원(staffB) | ✅ 업무 404, 알림 0건. 강남점 직원·매니저는 200 |
| 멘션 권한 우회 방지 | 코드 확인 (`src/lib/tasks.ts` addComment) | ✅ 볼 수 없는 사람은 알림 제외. ⚠ 화면 목록에는 그 사람이 보임 (3-4) |
| 캘린더 월 보기·업무 마감 표시 | 브라우저 | ✅ `03-win-calendar.png` |
| 반복 일정(매주) 생성·참석자 | 브라우저 | ✅ 4주 반복 표시 `04-win-calendar-event.png` |
| 모바일 폭 390px | 브라우저 | ✅ 가로 스크롤 없음, 하단 탭 표시 `05-win-mobile-task.png` |
| 운영 점검 스크립트 | `node scripts/verify-prod.mjs http://localhost:3000` | 9/11 — 실패 2건은 예상대로(정기 실행 없음, S3 미설정) |
| 자동 시험 `npm test`·`test:e2e` | — | ⏭ 실행 안 함: `/tmp`·openssl·`node_modules/.bin/next` 등 Linux 전용 경로. CI(ci run 38284889665)에서 통과한 결과를 그대로 인정 |
| 앱 실기기 | — | ⏭ 기기·adb 없음 (L-7 대기) |

### 3-1. [버그·높음] `scripts/migrate.mjs` 가 Windows 에서 실행 불가
`new URL(import.meta.url).pathname` 이 `/C:/...` 를 돌려줘 `C:\C:\...\db\migrations` 를 찾다가 ENOENT. HANDOFF L-2(운영 DB 마이그레이션을 Windows PowerShell 에서 실행)를 그대로 따르면 실패합니다.
수정안: `import { fileURLToPath } from 'node:url'; const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');`

### 3-2. [화면·낮음] 첨부 크기 표시
100KB 미만 파일이 "0.0MB" 로 보임 → 1MB 미만은 KB 로 표시.

### 3-3. [화면·중간] 멘션 입력 원문 노출
멘션 선택 시 입력창에 `@[이직원](eac05171-…)` 처럼 UUID 가 그대로 보임. 등록 후 표시는 정상(`@이직원`). 입력 중에도 이름만 보이게(칩 또는 내부 매핑).

### 3-4. [화면·낮음] 멘션 대상 목록
업무를 볼 수 없는 사람(다른 현장)도 멘션 목록에 나옴. 서버가 조용히 알림을 빼므로 사용자는 전달됐다고 오해함 → 업무 열람 가능자만 목록에 표시하거나 "이 사람은 업무를 볼 수 없어 알림이 가지 않습니다" 안내.

### 3-5. [화면·낮음] 체크리스트 "추가" 버튼 줄바꿈
1440px·390px 모두 "추/가" 두 줄로 깨짐 → `whitespace-nowrap`.

## 4. Google Calendar 실제 화면 검수 (로그인 상태, 읽기 전용)
대표 개인 캘린더라 일정 내용·캡처는 저장소에 남기지 않습니다(공개 저장소). 일정은 만들거나 바꾸지 않았고, 새 일정 화면은 열어 보기만 하고 취소했습니다.
| 관찰 | 우리 서비스 | 반영 제안 |
|---|---|---|
| 보기: 일(D)·주(W)·월(M)·연도(Y)·일정 목록(A)·4일(X), 키보드 단축키 | 월·주·일·목록 | (선택) 단축키 D/W/M/A, 4일 보기 |
| 만들기 메뉴: 일정 / 할 일 / 약속 일정(예약 페이지) | 일정, 업무 별도 등록 | 캘린더에서 바로 "업무" 만들기 진입점 |
| 일정별 알림 **여러 개**(기본 30분 전, 분·시간·일 직접 입력, 추가·삭제) | 사용자별 1개 설정(0/10/30/60/120분·하루 전) | 일정별 알림 덮어쓰기(최소 1~2개) — 중요한 회의만 하루 전+10분 전 |
| 반복: 반복 안 함·매일·매주 ○요일·매월 N번째 ○요일·매년·주중 매일·**맞춤(종료일/횟수)** | 프리셋 6종, **종료 조건 없음** (API 는 RRULE 문자열 지원) | 반복 종료일·횟수, "매월 N번째 요일" 추가 |
| 일정 항목 접근성 이름: "시간, 제목, 소유자, 장소, 색상, 날짜" | 확인 필요 | 스크린리더용 이름에 시간·캘린더 포함 |
| 상태(바쁨/한가함), 공개 설정, 시간대, 시간 찾기 탭 | 충돌 경고 있음 | (선택) 참석자 빈 시간 찾기 |
| 다른 캘린더에 "관리자업무 (via Asana)" 구독 중 | — | 현재 회사가 Asana 업무를 Google Calendar 로 보고 있음 → 우리 서비스의 업무 마감 캘린더 표시가 그 대체 역할임을 안내 문서에 명시 |

## 5-2. Asana 시험 계정 검수 (2026-10-13, 대표가 새 계정으로 Advanced 체험 시작)
✅ 완료 — 샘플 프로젝트에서 목록·작업 상세 패널·작업 메뉴·타임라인·대시보드·생성 메뉴를 실제 조작해 확인. 대표 지시에 따라 **참고만 하고 연동하지 않음**.
상세 비교와 개발 과제: [BEYOND_ASANA_PLAN.md](BEYOND_ASANA_PLAN.md)

## 5. Asana 실제 화면 검수 (2026-10-13, 대표 기존 계정 — 체험 종료)
🟡 부분 완료 — 로그인한 작업 공간은 샘플 수준(샘플 프로젝트 1개, "작업 1·2")이고, **Advanced 체험 종료(2026-01-27) 모달**이 화면을 막습니다. 모달의 유일한 버튼은 "플랜을 선택하세요"(요금제·청구 화면)라 대표 승인 없이 누르지 않았습니다. 아무것도 만들거나 바꾸지 않았습니다.

확인한 것:
| 관찰 | 우리 서비스 | 반영 제안 |
|---|---|---|
| 프로젝트 탭: 개요·목록·보드·타임라인·대시보드·캘린더·메시지·파일 | 목록·보드·캘린더·타임라인 | (선택) 프로젝트 "개요"(목표·담당·상태 요약)와 "파일" 모아보기 |
| 내 작업 자동 분류: 최근 배정된 작업 / 오늘 할 일 / 다음 주에 할 일 / 나중에 할 일, 섹션 추가 | 내 업무 목록 | 내 업무에 "새로 배정됨·오늘·이번 주·나중" 묶음 — 새로 배정된 업무를 먼저 보여 주는 점이 유용 |
| 기한 지난 날짜를 빨간색으로 표시 | 기한 초과 표시 있음 | 일치 |
| 무료 플랜에서 사용자 지정 필드·타임라인이 잠기고, 그 필드를 쓰는 프로젝트 전체가 열리지 않음 | 자체 서비스라 해당 없음 | 장점으로 안내 문서에 명시 가능 |
| 상단 "생성" 버튼 하나로 작업·프로젝트 등 생성, 검색 Ctrl+K | + 버튼(업무) | (선택) Ctrl+K 검색 |

미확인(실제 회사 업무 공간 필요): 작업 상세 패널(하위 작업·의존·승인 요청·댓글), 규칙(자동화), 양식, 받은편지함 알림 묶음, Google Calendar 연동 설정.
참고: 대표의 Google Calendar 에 "관리자업무 (via Asana)" 구독이 있으므로 **실제 업무용 Asana 는 다른 계정이나 다른 작업 공간일 가능성**이 큽니다.
