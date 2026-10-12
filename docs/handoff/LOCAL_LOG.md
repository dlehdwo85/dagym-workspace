# 로컬 작업 기록 (로컬 Claude Code 담당 파일)

> 이 파일은 **로컬 세션만** 수정합니다(클라우드는 읽기만). 비밀값·토큰·비밀번호는 쓰지 않습니다.
> 형식: 날짜 · PC · 브랜치 · 한 일 · 결과/링크 · 다음

## 진행 기록
- (예) 2026-10-14 · DESKTOP-HQKVDIC · local/ops-setup · L-1 Vercel Import 완료 · 운영 주소 https://… · L-2 진행 예정
- 2026-10-13 · BOOK-29S4OTOLT7 · local/ops-setup · 로컬 도구 점검, Windows 에서 운영 빌드 실행·화면 검수, Google Calendar 로그인 화면 검수(읽기 전용) · 결과 [LOCAL_REVIEW.md](LOCAL_REVIEW.md), 캡처 `local-screens/` · 다음: Asana 로그인 후 L-11 마무리, 이어서 L-1(Vercel) 시작은 대표 결정·결제 필요
- 2026-10-13 · BOOK-29S4OTOLT7 · local/ops-setup · Asana 로그인(대표) 후 검수 · 샘플 작업 공간 + 체험 종료 모달로 부분 검수만 가능(LOCAL_REVIEW 5절) · 다음: 실제 업무용 Asana 계정·작업 공간 확인 필요
- 2026-10-13 · BOOK-29S4OTOLT7 · local/ops-setup · 새 Asana 시험 계정으로 L-11 완료, 대표 지시(Asana 참고만·더 높은 수준) 반영해 개발 과제 작성 · [BEYOND_ASANA_PLAN.md](BEYOND_ASANA_PLAN.md) · 다음: 클라우드 구현분 로컬 재검수
- 2026-10-13 · BOOK-29S4OTOLT7 · local/ops-setup · 클라우드 5bbbbec merge, Windows 에서 `npm run db:migrate` 정상(R-1 확인), 대표 계정 로그인 재현(이 PC 정상), 디자인·UI/UX 검수 · [UIUX_REVIEW.md](UIUX_REVIEW.md) · 다음: 클라우드 디자인 개선분 재검수
- 2026-10-13 · BOOK-29S4OTOLT7 · local/ops-setup · 클라우드 01b7f21 merge·빌드(UI/UX 개선 확인), 휴대폰 오류 원인 확인(Vercel 운영 DB 미설정), 일정×업무 통합 검수 · [TASK_SCHEDULE_INTEGRATION.md](TASK_SCHEDULE_INTEGRATION.md) · 다음: 대표 승인 시 L-1·L-2 운영 설정

## 클라우드 요청 (로컬이 적고 클라우드가 처리)
근거와 재현은 [LOCAL_REVIEW.md](LOCAL_REVIEW.md) 3·4절.
- [R-1 높음] `scripts/migrate.mjs` Windows 경로 오류 — `fileURLToPath(import.meta.url)` 로 교체. 안 고치면 HANDOFF L-2 를 Windows 에서 실행할 수 없음
- [R-2 중간] 댓글 멘션 선택 시 입력창에 `@[이름](uuid)` 원문 노출 → 이름만 보이게
- [R-3 낮음] 멘션 목록에 업무를 볼 수 없는 사람이 나옴(서버는 알림을 조용히 제외) → 목록 필터 또는 안내 문구
- [R-4 낮음] 첨부 크기 1MB 미만이 "0.0MB" → KB 표시
- [R-5 낮음] 체크리스트 "추가" 버튼이 두 줄로 깨짐 → `whitespace-nowrap`
- [R-6 제안] 일정별 알림(기본값은 사용자 설정, 일정마다 덮어쓰기·여러 개) — Google Calendar 는 일정마다 여러 알림
- [R-7 제안] 반복 일정 종료 조건(종료일·횟수)과 "매월 N번째 ○요일" — API 는 RRULE 을 받으므로 화면만 추가
- [R-9 대표 지시, 2026-10-13] **Asana 는 참고만, 연동하지 않음. Asana 보다 높은 수준으로 개발** → 과제 목록 [BEYOND_ASANA_PLAN.md](BEYOND_ASANA_PLAN.md) (P0: 업무 상세 패널·내 업무 자동 묶음·섹션·Ctrl+K·R-1~R-7 / P1: 사진 증빙 완료·현장 QR 신고·다단계 결재·자동화 규칙·사용자 지정 필드(올바른 집계)·업무 유형 / P2: 현장 비교 대시보드·주간 보고 자동 생성·업무량)
- [R-10 대표 지시, 2026-10-13] **디자인·UI/UX 수준 향상** + 대표 계정 로그인 오류 → [UIUX_REVIEW.md](UIUX_REVIEW.md). 먼저 버그 U-0a(`/tasks?view=board` 같은 모르는 값이면 업무 화면 전체 오류), U-0b(오류 문구 "입력값을 확인해 주세요"만 표시), U-0c(연결 실패 시 영어 문구), U-0d(**Pretendard 글꼴 미로딩 → Windows 맑은 고딕**). 이어서 디자인 시스템(글꼴·색 토큰·lucide 아이콘·아바타·DueChip·토스트·스켈레톤) → 상단 바·목록·보드·상세 패널·대시보드·캘린더·모바일·로그인 순서
- [R-11 대표 지시, 2026-10-13] **일정 × 업무 통합 + 기업용 업무관리 수준 이상** → [TASK_SCHEDULE_INTEGRATION.md](TASK_SCHEDULE_INTEGRATION.md). 현재는 업무→일정 한 방향만 연결. S-P0: 일정–업무 N:M 연결, 회의 메모→후속 업무, 업무 시간 블록 개선(담당자 캘린더 기본·미리보기에 업무 링크·완료·제목 접두어 중복 버그), 시간 표기 통일 / S-P1: 통합 오늘·이번 주 화면(업무를 시간표로 끌어 놓기), 예상 소요 시간·마감 위험, 가용 시간 기반 업무량, 일정 준비 업무 자동, 반복 회의↔반복 업무
- [R-12, 2026-10-13] 휴대폰 "서버 오류" = Vercel 운영 `dagym-workspace.vercel.app` 에 DATABASE_URL 없음(health 503). DB 미설정이면 로그인 화면에 원인 안내 요청. 운영 설정(L-1·L-2)은 로컬이 대표 승인 후 진행
- [R-13 대표 지시, 2026-10-13] **본사 3명용 운영 도구로 단순화** — 사이드바 4개(홈·내 업무·프로젝트·캘린더), QR·자동화 등 숨김, 업무 등록 Asana 식 한 줄 추가, 캘린더 Google 식 빠른 입력·업무 표기 → [HQ_SIMPLIFY.md](HQ_SIMPLIFY.md)
- [R-8 참고] 자동 시험이 Linux 전용 경로(`/tmp/claude-0`, `node_modules/.bin/next`, openssl)를 써서 Windows 에서 못 돎. 필수 아님 — 원하면 `os.tmpdir()`·`process.execPath`+`next/dist/bin/next` 로 바꾸면 로컬에서도 회귀 시험 가능

## 클라우드 회신 (클라우드는 이 파일 대신 NEXT_ACTION.md 의 "로컬 요청 처리" 절에 답합니다)

## 운영 설정 진행 (2026-10-13, 대표 승인 "진행하라")
- Vercel 프로젝트 `dlehdwo85s-projects/dagym-workspace` (Hobby). 운영 주소 https://dagym-workspace.vercel.app
- ✅ Neon Postgres(Free, 싱가포르 sin1, Neon Auth 끔) `dagym-workspace-db` 생성 → 프로젝트 연결(Production·Preview). `DATABASE_URL` 등 자동 등록 (값은 읽지 않음)
- ✅ `APP_URL=https://dagym-workspace.vercel.app` (Production, 구성 변수)
- ✅ `vercel.json` main 만 배포(claude/** · local/** 프리뷰 끔) — main 84dfe02
- ⛔ `APP_SECRET`(32자 이상)·`SETUP_SECRET` — 비밀값이라 대표가 직접 입력 대기
- ⛔ 운영 DB 마이그레이션 — 방법 결정 대기(빌드 때 `node scripts/migrate.mjs` 실행하도록 vercel.json buildCommand 변경안은 자동 권한에서 차단됨 → 대표 승인 필요)
- ⛔ Vercel Hobby 배포 횟수 제한: main 2c48976·84dfe02 "Deployment rate limited — retry in 24 hours". 운영 주소는 아직 995c4ac. 해제 후 main 재배포 필요(또는 Pro $20/월)

## 운영·앱 등록 진행 (2026-10-13 계속)
- ✅ 운영 DB 마이그레이션: 대표가 vercel.json buildCommand(`node scripts/migrate.mjs && next build`) 커밋(751b57a) → 배포 성공, `/api/health` ok, migration 011
- ✅ 대표 계정: 대표가 `/setup` 에서 직접 생성·로그인 확인
- ✅ Google Play: 조직 계정 "주식회사 다짐"에 앱 **다짐 업무일정** (`kr.co.dagym.workos`, 무료, 기본 언어 ko-KR) 생성
- ✅ 업로드 키: 로컬 생성(`C:\Users\User\Claude-Operations\secrets\dagym-workos-upload.jks`, 비밀번호는 같은 폴더 properties — 저장소 밖, 대표 백업 필요). 업로드 인증서 SHA-256 `1E:EA:73:BF:B5:40:C1:5D:A6:D9:67:02:B8:FC:3C:8C:15:5A:A1:D3:82:AA:97:BC:1B:C4:7A:62:B2:99:12:75`
- ✅ mobile 워크플로 run 38316733710 (751b57a) 서명 없는 AAB → 로컬 jarsigner 서명 → Play 내부 테스트 1 (1.0) **내부 테스터에게 제공됨** (테스터 목록 "본사 테스터" 1명). 참여 링크 https://play.google.com/apps/internaltest/4701311500260795594
- 상태 구분: Android 빌드 ✅ / 내부 테스트 배포 ✅ / 스토어 제출 ⛔(스토어 등록정보·앱 콘텐츠 설문 미작성) / 심사 ⛔ / 실기기 설치 확인 ⛔(대표 휴대폰 확인 대기)
- ⛔ 푸시: Firebase(google-services.json) 미설정 → 앱 푸시 없음. 앱 링크용 ANDROID_CERT_SHA256 은 Play 앱 서명 키 지문(Play Console → 앱 무결성)으로 등록 필요
- ⛔ iOS: App Store Connect 미로그인, Apple Developer 멤버십 여부 확인 필요($99/년, 대표 결제)
