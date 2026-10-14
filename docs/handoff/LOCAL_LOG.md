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
- [R-15 대표 지시, 2026-10-14] **업무 상세·캘린더 사용성 6건** (Sales OS 세션이 대표 요청을 받아 전달)
  1. 캘린더: 일정·업무를 **완료 체크해도 캘린더에 완료 표시가 없음** → 캘린더 블록에 ✓ 와 완료 스타일(흐림·취소선) 표시, 월·주·일 보기 모두
  2. 업무 상세: **자료 첨부·댓글이 '세부 정보'를 눌러야 보임** → 접힘 밖 기본 노출(휴대폰 포함)
  3. 업무 상세 배치: 설명·세부정보·담당자·연결 일정·자료 첨부를 **자주 쓰고 중요한 순서로 위에서부터** 재배치. 제안 순서: 담당자·협업자 → 마감일·우선순위·미리알림 → 설명 → 체크리스트·하위 업무 → 자료 첨부 → 댓글 → 연결 일정 → 기타 세부정보(프로젝트·섹션·태그). (2단계: 사용 기록 기반 자동 순서 검토)
  4. **'필드 더보기' 제거**. 대신 진행 과정(생성→시작→완료, 체크리스트·하위 업무 완료 시각)으로 **직원별 업무 처리 속도**(평균 소요 시간·지연 비율)를 계산해 업무량 화면·업무 상세(예상 처리 기간)에 표시
  5. **우선순위**는 마감일·미리알림이 있는 묶음(같은 목록)으로 이동
  6. **협업자**: 담당자 선택을 다중 선택으로 — 첫 선택은 주 담당자, 추가 선택은 협업자. **1명 배정 후에도 협업자 추가** 가능. **체크리스트 항목·하위 업무마다 담당자 지정**으로 누가 무엇을 하는지 구분(본인 몫만 '내 업무'에 표시)
- [R-16 대표 지시, 2026-10-14] **한 계정(회사) 안의 팀별 권한 + 메신저 바로가기** (Sales OS 세션 전달)
  1. **팀 권한 계층**: 예) 본사팀 / 운영관리팀. **본사팀은 운영관리팀의 업무·프로젝트·일정·자료·댓글 전부를 보고 수정·배정할 수 있다. 운영관리팀은 본사팀의 업무를 볼 수 없다**(목록·검색·캘린더·알림·AI 비서 답변·메신저 업무방 포함, 서버에서 404 로 숨김).
     - 현재 teams(036)는 업무 묶음일 뿐 접근 범위가 아니고, 접근 범위는 org_units 로만 정해짐 → 팀에 '상위 팀(관리 팀)' 관계를 두거나 org_units(본사→운영관리) 계층과 묶어 **상위 팀 = 하위 팀 전체 권한, 하위 팀 → 상위 팀 비공개**를 access.ts 에서 일관 적용
     - 팀 설정 화면에서 팀 만들기·구성원·상위 팀 지정. 업무 생성 시 소속 팀 기본값 = 작성자 팀
     - 기존 데이터: 팀 없는 업무는 지금처럼(소속 조직 기준) 보이게 — 이행 시 데이터 손실·노출 없게
  2. **메신저 바로가기**: 화면 우측 하단 **AI 비서 버튼 옆에 메신저 버튼**(안 읽은 개수 배지). 누르면 작은 대화 패널(최근 대화방·바로 답장), 휴대폰은 /messages 로 이동. AI 비서 버튼과 겹치지 않게 나란히 배치
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
- 2026-10-13 iOS: App Store Connect 로그인(대표) 확인 — 조직 "Da Gym Co., Ltd."(다짐 주식회사), 팀 ID 88SSK23ZVB. ⛔ 최신 Apple Developer Program License Agreement 미동의로 인증서·식별자·API 키 화면 차단 → 대표(계정 소유자) 동의 대기. GitHub 변수 등록: APPLE_TEAM_ID, APP_URL(=https://dagym-workspace.vercel.app, tick·backup·release 워크플로가 사용). 남은 것: 번들 ID 등록·ASC 앱 생성(로컬), ASC API 키 .p8 → Secrets ASC_KEY_P8·ASC_KEY_ID·ASC_ISSUER_ID(대표), release.yml iOS 실행 → TestFlight 내부 테스터
- 2026-10-13 iOS: 대표 라이선스 계약 동의 후 ✅ App ID `kr.co.dagym.workos`(DAGYM WorkOS, Push Notifications 켬) 등록, ✅ App Store Connect 앱 "다짐 업무일정" 생성(앱 ID 6822120675, 한국어, SKU dagym-workos). ⛔ App Store Connect API 미활성("액세스 요청" 필요, 계정 소유자) → 키(관리자 역할) 발급 → Secrets ASC_KEY_P8·ASC_KEY_ID·ASC_ISSUER_ID 등록(대표) → release.yml(ios) 실행 → TestFlight 내부 테스터
- 2026-10-13 iOS: 대표가 ASC API 키(8A9GXPBG58, 관리자) 발급·Secrets 3개 등록. release.yml 수정 2건(main 48c4b3f: archive 서명 없이 → export 에서 배포용 자동 서명 / 0f4be39: Xcode 26 선택 — iOS 26 SDK 필수). run 38335942264 ✅ Xcode 26.3, Upload succeeded → TestFlight 빌드 1.0.0 (3) 처리 중. TestFlight 내부 그룹 "본사 테스터"(자동 배포) 생성, 테스터 dlehdwo85@naver.com(계정 소유자) 추가. 다른 본사 인원은 대표 확인 후 추가
- 2026-10-13 워크인: TestFlight 빌드 1.0.0(3) "제출 준비 완료" → 본사 테스터 그룹 배포(초대 1). App Store Connect 앱 이름 "워크인", 부제 "다짐 · 하이링크 업무·일정" 저장. Play 기본 스토어 등록정보 앱 이름 "워크인"·설명 임시 저장(공개 출시 시 반영). 휴대폰 홈 화면 아이콘 이름은 다음 앱 빌드(capacitor appName)부터 바뀜. 모바일 좌우 스크롤 실측·2차 개선 명세 WORKIN_V2.md(main 12bca3e) 클라우드 전달
- 2026-10-13 대표 승인(앱 알림·AI 매출): Firebase 전용 프로젝트 **workin-9c116** 생성(Spark 무료, 애널리틱스·Gemini 끔), Android·iOS 앱 등록, GitHub Secrets GOOGLE_SERVICES_JSON·GOOGLE_SERVICE_INFO_PLIST 등록(번들·패키지 kr.co.dagym.workos 확인). TestFlight 외부 그룹 "직원 공개 링크" 생성, 베타 앱 정보(설명·피드백 이메일·개인정보 처리방침 URL) 저장 — 심사 연락처 전화번호·로그인 정보 미저장. 대표 지시 "할 일 최소화"에 따라 비밀번호 없는 심사용 "체험하기"(DEMO_LOGIN, 격리 조직) 클라우드 요청. 남은 것: APNs 키 생성(Apple 재로그인 필요)→Firebase 업로드, FCM 서비스 계정 키→Vercel FCM_SERVICE_ACCOUNT_JSON(대표), 7a9f382 운영 배포(Vercel 한도 대기)
- 2026-10-13 TestFlight 테스트 정보: 심사 연락처(성명·전화·이메일) 저장 완료(번호는 저장소에 기록하지 않음), 심사 메모를 "로그인 화면 체험하기 버튼 사용"으로 갱신. APNs 인증 키 생성(Key ID AM65J2522J, Sandbox & Production, 팀 범위) — 파일은 로컬 artifacts 보관, Firebase(workin-9c116) 클라우드 메시징 업로드 창에 키 ID·팀 ID 입력 완료, 파일 선택·업로드는 대표
- 2026-10-13 운영 반영 확인: 1b9e730(7a9f382 포함) 배포 — 제목 "워크인 | 다짐 · 하이링크", 로컬 동일 코드로 375px 주요 7화면 좌우 스크롤 없음, 업무 화면 "+ 업무 추가" Enter 연속 등록 확인. Vercel FCM_SERVICE_ACCOUNT_JSON 등록(대표) — 다음 배포부터 적용. 앱 새 빌드: iOS 1.0.1 TestFlight 업로드(release run 38349952821, aps-environment 검사 통과), Android 버전코드 8 서명·Play 내부 테스트 "내부 테스터에게 제공됨"(mobile.yml versionCode=run_number, main 4080a08). 대표 운영 캡처로 업무 0건 담당자 묶음 버그 발견 → 3차 명세 WORKIN_V3_TASKS.md(b9f3d51). PC 디스크 0MB 사건 → 대표 승인으로 npm 캐시 정리(약 2.8GB 확보)

## 2026-10-13 14:50 — 업무 화면 재확인(대표 캡처)
- 운영 "전체"에 이동재 묶음만, 업무 0건. 원인 코드: `src/components/TaskViews.tsx:365-367` (나 + 업무 있는 담당자만 묶음). WORKIN_V3_TASKS 5번에 추가 요청.
- "1건 만든 뒤 추가 불가": 로컬 최신 빌드에서 상단 추가·묶음 끝 줄 각 2건 연속 저장 확인(재현 안 됨). 운영 계정 로그인 없이 운영 재현 불가 → 한글 IME Enter·배정 후 사라짐 가설로 클라우드 확인 요청.
- 대표 지시: 상단 직원 이름 칩은 필터.
- TestFlight 공개 링크: main 에 DEMO_LOGIN 반영 감시 중(2분 간격).

## 2026-10-13 15:20 — 앱 새 빌드·업무 화면 4차 요청
- 상단바 수정(7884d83) 후 iOS 1.0.2 release.yml run 38355338777 성공 → TestFlight 업로드. Android mobile run 38354402256 성공(서명 없는 AAB) — 로컬 서명이 자동 안전 검사에 막혀 대표 승인 대기.
- 대표 앱 캡처: 다른 사람 묶음 추가 불가·생성 후 사라짐·휴대폰 순서 변경·기한 지남 경고 → WORKIN_V3_TASKS 6번.
- 체험하기: 클라우드가 비밀번호 없는 로그인 보류(NEXT_ACTION). 대안 = 데모 조직에 심사용 일반 계정 → 대표가 ASC 심사 정보에 입력.

## 2026-10-13 16:10 — 운영 배포·심사 계정 준비
- Vercel git 배포가 rate limit 으로 막힘(계정 24시간 실제 배포 55건). Vercel API 로 main 운영 배포 2회: 77fe819(업무 6번), 1c3e0e2(심사용 체험 계정) — 두 번째는 대표 "운영배포승인" 후. health commit 1c3e0e2 확인.
- 대표 대기: 사용자 관리 "심사용 체험 계정" → 초대 링크 비밀번호 → ASC TestFlight 테스트 정보 로그인 정보 입력. 이후 로컬이 외부 그룹 빌드 추가·베타 심사 제출.

## 2026-10-13 17:00 — 대표 승인 3건 처리
- CRON_SECRET: Vercel production 환경 변수에 무작위 64자(브라우저에서 생성, 값 미표시, sensitive) 등록. 다음 운영 배포부터 매일 09시 Vercel Cron 인증 통과 예정 → 배포 후 health lastTick 확인 필요.
- Android: mobile run 38354402256(7884d83 상단바 수정) AAB 로컬 서명 → Play 내부 테스트 **11 (1.0) 내부 테스터에게 제공됨**(16:56).
- iOS 내부 테스터: ASC 사용자 초대 김민수·김소담(역할 마케팅, 앱 접근 워크인만). 초대 수락 후 TestFlight 내부 그룹에 추가 예정. 이메일은 대표 제공(저장소에는 이름만 기록).

- 17:09 김민수·김소담 ASC 초대 수락 → TestFlight 내부 그룹 "본사 테스터" 추가(테스터 3명, 초대됨). 대표 본인도 아직 "초대됨"(TestFlight 앱에서 수락 전).

## 2026-10-13 18:00 — 운영 배포 막힘(Vercel 하루 한도)
- 대표 "운영배포 승인" → Vercel API 배포 402 `api-deployments-free-per-day`. 계정 24시간 보이는 배포 63건(dagym-workspace 28) — 한도는 숨은 시도까지 세는 듯. 운영은 05cd155 (978a9fc 캘린더 4차·1f2d348 사라짐 방지 미반영).
- **클라우드 요청 R-14**: `vercel.json` 에 `"ignoreCommand"` 로 docs/·*.md 만 바뀐 커밋은 빌드 건너뛰기(로컬 기록 푸시가 운영 빌드를 소모 중). 예: `git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)*.md' ':(exclude)NEXT_ACTION.md'`.
- 로컬은 한도가 풀리면 다시 배포 시도.

- 18:40 한도 풀림 → Vercel API 운영 배포 1e76f26 READY (b2b7345 포함: 캘린더 4차·1시간 칸·마감 표시·자동 저장·사라짐 방지·꾹 눌러 순서·홈 새 업무). health migration 017, scheduler healthy.

- 20:20 한도 풀림 → Vercel API 운영 배포 aea0232 READY (f1065a1 상세 정리·행 클릭·칩 순서 + aea0232 V5 캘린더 Google 형·홈 일정·업무 연동·반복).

- 2026-10-14 2b2f667 자동 배포 확인: 함수 sin1(X-Vercel-Id icn1::sin1), DB 왕복 75ms → 2ms, health 0.21s. 저장 버튼 복원·상세 쿼리 병렬·router.push 반영.

- 2026-10-14 V6 배포 확인: 789adfb(1차), 4328984(2차, migration 019) 자동 배포 성공, scheduler healthy.
- C 드라이브 0MB → 대표 승인 후 로컬 .next(351MB)·android-run 폴더 삭제, 중단된 merge 잔여물은 git stash 로 보관 후 fast-forward. 여유 ~340MB(근본 원인: Claude VM 번들 등).

- 2026-10-14 V7(653d53f, mig 020)·V8(1fd88e0·05a8ae2, mig 022) 자동 배포 확인. 대표 결정 대기: 첨부 저장소(R2 추천, fileStorage local-disk), 분 단위 알림(cron-job.org 추천 — CRON_SECRET 은 sensitive 로 값 확인 불가 → 대표가 새 값을 정해 Vercel·cron-job.org 양쪽 입력 필요).

## 2026-10-14 휴대폰 예약 알림 네이티브(로컬)
- 190f263(클라우드: local-notifications 플러그인·예약 로직) 후 Android Manifest 에 USE_EXACT_ALARM(13+)·SCHEDULE_EXACT_ALARM(≤12)·RECEIVE_BOOT_COMPLETED 추가. Play 정확한 알람 권한 선언(캘린더 앱) 필요 → 업로드 시 처리. 앱 빌드: Android 다음 vc, iOS 1.0.3.
- 앱 새 빌드: Android vc14(mobile run 38467993425, edebe9d) 로컬 서명 → Play 내부 테스트 출시. iOS 1.0.3(release run 38468034087) TestFlight 업로드 성공.

- 2026-10-14 R2 적용 확인: health fileStorage "s3"(commit 33650b8). 버킷 workin-files, S3_* 5개 production. 실제 업로드는 대표 첫 파일 업로드 후 R2 객체 확인 예정.

- R2 CORS 설정(로컬): workin-files 에 운영 도메인·localhost·capacitor origin, GET/PUT/HEAD. 업로드 실패 원인(브라우저 presigned PUT CORS) 해소. ANTHROPIC_API_KEY 대표 등록(22:47) — 운영 반영은 다음 배포(현재 Vercel 한도) 후.

- 2026-10-14 운영 1e7dc26 반영(자동 배포): V12 급함(aeccc1e)·AI 자료 일괄 생성(1c11266)·R2 체크섬 끄기+서버 경유 재시도+드래그 업로드. ANTHROPIC_API_KEY 반영. R2 CORS headers * 로 확대(로컬).

- 2026-10-14 대표 요청으로 운영에 업무 일괄 생성(대표 세션, API): "지점별 SNS 촬영 자료 수집" 김민수(141facae…)·김소담(69c8377a…), batch 7082ca97, 마감 10/22 14:00, 높음, 체크리스트 7. 촬영 요청서 사진(local-screens/59) 첨부는 업로드 수정(c105d54) 운영 반영 후.

- 2026-10-14 운영 ce1011f(V12-11 상태 권한·V12-12 타임라인) 반영, storageWarnings 비어 있음(R2 키 정상). 촬영 요청서 사진을 김민수·김소담 업무 2건에 첨부 성공(R2 업로드 실동작 확인).

- 2026-10-14 AI 비서 원격 시험(운영, 대표 세션): status enabled(model claude-opus-5-5, 월 한도 $30). ① 글 지시 → 업무 제안 → 확인 → 업무 생성 성공(대표 본인 배정 "AI 비서 시험 업무", 10/15 17:00, 체크 2). ② 자료실에 촬영 요청서 이미지 업로드 후 첨부 지시 → 이미지 읽고 김민수·김소담 2건 제안(체크 7·메모·마감·첨부) 정상 — 중복 방지 위해 제안 취소. 5회 요청 $0.098(회당 약 27원). 비용 절감: 정리·추출은 Sonnet/Haiku 권장(클라우드 요청 예정).

- 2026-10-14 앱 아이콘 시안 B(캘린더 체크, 청록) 확정: Android mipmap 6해상도(legacy·round·adaptive fg/bg)·배경색 #0F766E, iOS AppIcon 1024 생성(sharp, 원본 docs/handoff/brand). 새 앱 빌드 예정.

- 2026-10-14 운영 fcf4fc1 반영(13차: 매출 GPT 토큰 제거·AI 입력·메뉴 권한·자료실 AI 정리, migration 029). 앱 아이콘 B 빌드: Android mobile run 38492961286, iOS 1.0.4 release run 38493041107.
- 앱 아이콘 B: Android vc16 Play 내부 테스트 출시, iOS 1.0.4 TestFlight 업로드 성공.

- 2026-10-14 운영 9d2312a 수동 재배포(상시 승인): 지시자 마감 알림(915de03)·AI 모델 3단계(bf45f0a) 반영.

- 2026-10-14 Vercel 팀 Pro 전환(대표 결제, plan pro active) — 하루 100회 배포 한도 해소. 운영 4e9e3ae 재배포.

- 2026-10-14 운영 70aef89(15차 ①~⑧·V14 14·16, migration 037): /signup·/terms·/privacy·/welcome 200. 비로그인 / → /login(랜딩은 /welcome). 약관·처리방침 사업자 정보 = COMPANY_NAME·COMPANY_CEO·COMPANY_BIZNO·COMPANY_ADDRESS 환경변수 대기(대표 입력).

- 2026-10-14 자료실 AI 자동 정리 운영 확인: 새 업로드(앱 아이콘 png) → 자동으로 폴더 디자인/아이콘·태그 5개·제목 생성. 기존 파일(촬영 요청서)은 업로드 당시(13차 전)라 미정리 → "다시 정리"로 마케팅/촬영요청서 정리(신뢰도 0.9).

- 2026-10-14 운영 94d381c(V14 15·17·18, migration 038) 대표 계정 화면 확인: 자료실 폴더 트리(디자인·마케팅)·폴더 카드·끌어다 놓기 안내 줄·기밀 열람 기록·전체 정리 버튼 정상. (첫 로드에 이전 번들 캐시로 옛 화면이 보일 수 있음 — 새로고침 필요)

- 2026-10-14 운영 e0e1d02(R-15·R-16·V14 19, migration 039) 검수: 업무 상세 요약·진행률·설명·항목별 담당·속성 열 정상. 버그: 비담당자(대표)에게 완료/시작 버튼 노출 → 클라우드 요청.

- 2026-10-14 운영 7563167(V14 20·21) 확인: 비담당자 화면 "담당자 김민수님이 진행합니다"(버튼 숨김) 정상. 서버 규칙 추가: 완료된 업무는 지시자도 "다시 진행"(반려와 같은 성격) 가능.

- 2026-10-14 대표 확정 직책 약칭: 이동재 CEO · 김소담 CPO · 김민수 COO (V14 24번 필드 배포 후 로컬이 운영 사용자 관리에 입력).

- 2026-10-14 16차 문의 연동 운영 반영(d577840→4585079): 엔드포인트 토큰 없이 401 확인, 플랫폼 운영 화면에 "웹사이트 문의 연동"(다짐/하이링크 토큰 발급·유형별 기본 담당자) 표시 확인. 마케팅 세션에 사이트 쪽 전송 구현 요청. 대표 토큰 발급·담당자 지정 대기.

- 2026-10-14 운영 270b73e: AI 비서 일정 생성 시험 성공(대표 세션) — "10/16(금) 16시 1시간 AI 일정 시험" → 제안 카드(충돌·연차 경고 없음) → 확인 → 일정 eb2dac13 생성, 16:00~17:00 KST 정확. 문의 연동 사이트 코드 배포 완료(마케팅 세션: dagym-website 434d9a8, hilink-website df273b9). 대표 토큰 입력 대기.

- 2026-10-14 문의 연동: 대표가 WORKIN_INQUIRY_TOKEN 입력(dagym-website-3532·hilink-website Production 확인) → 로컬이 두 사이트 Production 재배포 READY(434d9a8·df273b9). 실제 시험 문의 제출은 대표 확인 후(실 CRM·메일 알림 발생).

- 2026-10-14 문의 연동 실시험 성공(대표 승인): 다짐 웹사이트 /contact 시험 문의 제출 → 워크인 업무 자동 생성 "[다짐 문의] [시험] 워크인 연동 확인 단지 · 커뮤니티 위탁운영 (서울)" — 프로젝트 웹사이트 문의, 태그 다짐웹·서울·커뮤니티 위탁운영, 담당 이동재(기본), 마감 10/15 18:00, 높음, 체크리스트 7(현장 실사 포함), 설명 표·AI 요약·연락처 내부 등급, Lead 0362593b. 실 CRM(Supabase leads)·알림 메일에도 시험 1건 남음.

- 2026-10-14 브랜드 색 시안 5종 대표 전달(A 현재 남색·B 전부 청록·C 사이드바 남색+청록 버튼·D 흰 사이드바+청록·E 차콜 사이드바+청록), 선택 대기. 17차 요금 명세 작성(무료 폐지·유료+14일 체험).

- 2026-10-14 운영 사업자 정보 환경변수 설정(로컬, 대표 제공 값): COMPANY_NAME·CEO·BIZNO·ADDRESS·PHONE·PRIVACY_EMAIL (Production). 브랜드 색 D안 확정(선택 메뉴 진한 청록). 워크인 = 주식회사 다짐 명의.

- 2026-10-14 자료실 184개 표준 폴더로 재정리(대표 지시, /api/library/move 18건 200): 133개 이동, 미분류 1(이지우). 원인 HWP 본문 미추출 → 클라우드 V14 32번. 통신판매업: 공정위 조회 결과 759-88-02170 "등록된 정보 없음"(미신고 추정, 반영 1~2일 지연 가능).
