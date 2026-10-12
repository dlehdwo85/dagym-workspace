# 시험 보고서

최종 실행: 2026-10-12 (UTC) · 클라우드 개발 환경 (Node 22, PostgreSQL 16, Chromium 141)
요약 (2026-10-13 로컬 요청 R-1~R-8 반영 후): **API 통합 시험 53/53 통과 · 실제 브라우저 E2E 19/19 통과 · 백업→복원 일치 · Android APK 빌드 성공**
GitHub Actions 최신(커밋 1bd09fb): ci run 38284889665 **API 50/50 · E2E 19/19**, mobile run 38284889671 **Android·iOS 빌드 성공**.
이전 기록: 1차 CI 는 E2E 2건 실패(체크박스 접근성 이름 중복 → 화면 수정). 2차 CI run 38283356589 **API 49/49 · E2E 18/18 통과**, mobile run 38283356596 **Android 빌드 · iOS 시뮬레이터 BUILD SUCCEEDED**.

## 재현 방법
```bash
npm ci
# PostgreSQL 에 workos 사용자와 workos_test DB 준비 (TEST_DATABASE_URL 로 변경 가능)
npm run build
npm test            # API 통합 시험: 실제 next start 서버 + 실제 DB + 가짜 Google/FCM/웹푸시 서버(tests/fake-google.mjs)
npm run test:e2e    # Playwright Chromium 사용자 시나리오, 화면 캡처는 docs/screens/
```
시험 DB는 매 실행마다 초기화됩니다. 운영 DB에는 절대 연결하지 마세요.

## 필수 시나리오 결과
| # | 시나리오 | 방법 | 결과 | 근거 |
|---|---|---|---|---|
| ① | 대표가 직원 초대 → 직원 로그인 → 허용된 현장만 조회 | 브라우저(대표 화면에서 초대 → 링크로 가입) + API | ✅ | `03-staff-tasks-scope.png`: 현장 선택지에 "다짐 강남점"만 보임 |
| ② | 업무 등록 → 배정 → 직원 알림 → 댓글·멘션·사진·문서 링크 → 검토 요청 → 관리자 최종 완료 | 브라우저(PC 대표 / iPhone 13 화면 직원 / PC 관리자) + API | ✅ | `04`~`06` 화면, 알림·이력·승인자 검증 |
| ③ | 마감일 변경 → 목록·보드·캘린더·타임라인 동일 반영, 끌어서 변경 | 브라우저(목록 날짜 입력, 보드 끌기, 캘린더 끌기) | ✅ | `07`~`09` 화면, API 로 원본 값 확인 |
| ④ | 반복 업무·반복 일정 생성·수정·취소 | API(매주 4회 → 이번만 이동 → 이후 분할 → 이번만 삭제 → 전체 삭제, 반복 업무 완료 시 다음 회차 1건, 스케줄러 선생성 중복 없음) + 브라우저(주 보기에서 끌어 "이번 일정만") | ✅ | `10`·`11` 화면 |
| ⑤ (정정) | 외부 계정 없이 핵심 기능 동작 | 브라우저: Google 기능 꺼짐 상태(기본값)에서 전체 E2E 수행, 메뉴 숨김·`/api/google/connect` 404 확인 | ✅ | E2E 1번 단계 |
| (선택) | Google Calendar 양방향 생성·수정·삭제, 연결 오류 복구 | **가짜 Google API 서버**로 OAuth → 가져오기(여러 페이지·반복·종일·참석 상태) → 회사→Google 생성·수정·삭제 → Google 수정 → 웹훅 → 반영 → 동시 수정 충돌(양방향 우선순위) → 410 전체 재동기화 → invalid_grant → 재연결 복구 → 연결 해제 시 일정 보존 | ✅ (모의) / ⛔ 실제 Google 계정 미검증 | 실제 검증은 OAuth 클라이언트 등록 후 진행 |
| ⑥ | 다른 직원·현장 제한 데이터 차단 | API: 상세·목록·검색·수정·댓글·첨부·다운로드·삭제·일정·관리자 API·다른 현장 생성·CSRF·미로그인. 브라우저: 접근 불가 안내 | ✅ | `16-forbidden-task.png` |
| ⑦ | PC와 모바일 데이터 일치 | 브라우저: 모바일에서 마감일 변경 → PC 에서 같은 값 | ✅ | |
| ⑧ | Android/iOS 앱 설치·로그인·푸시·첨부·일정 변경 | APK 빌드·매니페스트 검사 / FCM 발송 형식·탭 이동 링크(가짜 FCM) | 🟡 빌드·서버 측만 ✅ / ⛔ 실제 기기 미검증 | 이 환경에 KVM 이 없어 에뮬레이터를 실행할 수 없음. Firebase·스토어 계정 필요 |
| ⑨ | 서버 재시작·네트워크 장애 후 복구 | 브라우저: 서버 종료 → 오류 확인 → 재시작 → 데이터 유지 / 모바일 오프라인 댓글 → 재연결 자동 전송 1건 / 푸시 발송 실패 재시도(지수 백오프) | ✅ | `15-mobile-offline.png` |
| ⑩ | 백업 복원과 운영 URL 직접 접속 | 백업(암호화) → 새 DB 복원 → 건수·해시 일치 → 복원 DB 로 서버 기동·로그인 | ✅ 복원 / ⛔ 운영 URL 미배포 | 아래 |

## API 통합 시험 53건 (tests/api/scenarios.test.mjs) — +3: 멘션 대상 권한(R-3), 매월 N번째 요일·종료일·횟수(R-7), 일정별 알림(R-6)
초대·로그인 4 · 권한 차단 9 · 업무 흐름 7 · 보기 일치 2 · 반복 업무 2 · 반복 일정·충돌·종일 6 · 중복 방지 2 · 정기 알림·**일정 시작 전 알림**·푸시·설정 5 · [선택 기능] Google 동기화 8 · 비활성화·소속·권한 상한 3 · 템플릿 1 · 대시보드 1

## E2E 19건 (tests/e2e/run.mjs) — Google 기능 꺼짐(기본값)으로 실행
외부 계정 없이 동작 확인 · 대표 대시보드 · 화면 초대 · 초대 가입·범위 · 빠른 업무 등록 · 모바일 알림→업무 이동 · 모바일 댓글·멘션·사진·문서 링크·검토 요청 · 관리자 완료 확인 · 목록→보드·캘린더·타임라인 일치 · 보드 끌기 · 업무 캘린더 끌기 · 반복 일정 끌기 + 범위 선택 · 월·일·목록 보기 · 오프라인 댓글 · 접근 불가 화면 · PC·모바일 일치 · 모바일 홈·캘린더·등록 · 서버 재시작 · 설정·Google·관리자 화면

## 백업·복원
```
backup: workos-2026-10-12T17-06-02-218Z.dump.enc 97,743 bytes (sha256 03ee0763…)
restore → workos_restore
원본  users 5 · tasks 2 · events 2 · comments 2 · attachments 2 · audit 15 · tasks md5 0cc430ce…
복원  users 5 · tasks 2 · events 2 · comments 2 · attachments 2 · audit 15 · tasks md5 0cc430ce…
복원 DB 로 서버 기동 → 대표 로그인 200 · 업무 2건 조회
```

## Android 빌드
`mobile/android/app/build/outputs/apk/debug/app-debug.apk` (6.0MB) · package `kr.co.dagym.workos` · minSdk 24 / targetSdk 36 · 권한 INTERNET, POST_NOTIFICATIONS, CAMERA, FCM 수신 · 딥링크 `workos://`, https 앱 링크 `/tasks` `/calendar` `/notifications`

## 미검증 (정직하게 표시)
- Asana·Google Calendar **로그인 후** 실제 화면 (docs/research 의 "미검증" 목록)
- (선택 기능) 실제 Google Calendar 계정과의 동기화 — 필수 아님
- 실제 기기의 앱 설치·로그인·앱이 닫힌 상태 푸시 수신·알림 탭 이동·카메라 첨부
- iOS 서명 빌드·TestFlight (Apple 계정 필요; 서명 없는 시뮬레이터 빌드는 성공)
- 운영 URL 직접 접속, 운영 백업 워크플로 실행
