# 작업 상태 (WORK_STATUS)

마지막 갱신: 2026-10-12 (UTC) · 브랜치 `claude/cool-pascal-h2e787` · 저장소 `dlehdwo85/dagym-workspace`(공개)

## 한 줄 요약
웹 서비스(업무·일정·권한·알림·Google 동기화·관리자)와 앱 껍데기를 구현했습니다. 실제 서버·DB·브라우저 시험은 통과했습니다(API 49/49, E2E 18/18). **운영 배포·실제 Google 연동·앱 스토어 출시는 대표 계정 준비를 기다리고 있어 아직 완료가 아닙니다.**

## 저장 단계
| 단계 | 상태 |
|---|---|
| 로컬 저장 | ✅ |
| GitHub 푸시 | ✅ `claude/cool-pascal-h2e787` |
| main 반영 | ⛔ 저장소에 main 브랜치가 없음 (지정 브랜치 외 푸시 금지 규칙 때문에 만들지 않았습니다. 대표 확인 후 생성·병합) |
| 운영 배포 | ⛔ Vercel 프로젝트·DB 미생성 |

## 시작 단계 확인 결과
- 작업 저장소 `dagym-workspace`는 비어 있었습니다(커밋 0). 이 저장소를 별도 개발 프로젝트로 썼습니다.
- 기존 서비스: `dazim-hilink-integration`(Next.js + Vercel + GitHub OIDC 스케줄러), `sales-os`(Next.js + Supabase), `hilink-website`, `dagym-website`. → 같은 기술 방식과 **GitHub OIDC 스케줄러 패턴을 재사용**했습니다. 기존 저장소는 읽기만 했고 수정하지 않았습니다.
- 계정 연결 상태: GitHub(이 세션) ✅ · Gmail·Google Calendar·Google Drive 커넥터 ✅(대표 계정. 일정은 수정하지 않았습니다) · Vercel·DB·Google Cloud·Firebase·Apple·Google Play 자격 증명 ❌(이 환경에 없음)

## 기능 구현 상태
| 영역 | 구현 | 검증 |
|---|---|---|
| 인증(초대·로그인·세션 30일·로그아웃·재설정 링크·최초 대표 생성) | ✅ | API·E2E |
| 권한 5단계·조직 트리·소속 범위 접근 제어·퇴사 차단·감사 기록 | ✅ | API·E2E |
| 프로젝트·업무·하위 업무·체크리스트·의존관계·댓글·멘션·첨부·이력 | ✅ | API·E2E |
| 검토 요청 → 관리자 최종 확인 / 보완 요청 | ✅ | API·E2E |
| 목록·보드(끌기)·캘린더(끌기)·타임라인(끌기·늘이기) | ✅ | E2E |
| 반복 업무(완료 시·서버 선생성, 중복 없음) | ✅ | API |
| 캘린더 월·주·일·목록, 회사·조직·개인, 반복 일정 3범위, 충돌, 종일·휴가·출장, 업무 실행 시간 배정 | ✅ | API·E2E |
| 템플릿 8종 + 업무에서 템플릿 저장 | ✅ | API |
| 대표 대시보드 7영역 | ✅ | API·E2E |
| 알림 7종+α, 설정(종류·푸시·마감 임박 시간·방해 금지), 중복 방지, 실패 기록·재시도 | ✅ | API |
| 웹 푸시(VAPID)·앱 푸시(FCM v1) 발송 | ✅ | 가짜 수신 서버 |
| Google Calendar 양방향 동기화 엔진·웹훅·재동기화·충돌·권한 만료 복구 | ✅ | 가짜 Google API |
| 오프라인 대기열·Idempotency-Key·동시 수정 409 | ✅ | API·E2E |
| 정기 실행(10분, OIDC)·헬스체크·운영 상태 화면 | ✅ 코드 | 🟡 운영 주소 연결 후 가동 |
| 백업(암호화)·복원·복원 훈련 워크플로 | ✅ | 로컬 실제 복원 |
| Android 앱(Capacitor) | ✅ 디버그 APK | ⛔ 실제 기기 |
| iOS 앱(Capacitor, SPM) | ✅ 프로젝트 | 🟡 CI macOS 빌드 결과 대기 |

## 앱 출시 단계 (구분 기록)
| | 빌드 | 내부 테스트 배포 | 스토어 제출 | 심사 통과 | 실제 설치 가능 |
|---|---|---|---|---|---|
| Android | ✅ 디버그 APK | ⛔ | ⛔ | ⛔ | ⛔ |
| iOS | 🟡 | ⛔ | ⛔ | ⛔ | ⛔ |

## 차단 사항 (대표 결정·계정 필요)
1. Vercel 프로젝트 + PostgreSQL + R2 → 운영 배포 (NEXT_ACTION 1)
2. Google Cloud OAuth 클라이언트 → 실제 Google Calendar 연동 검증
3. Firebase 프로젝트 → 앱 푸시
4. D-U-N-S, Apple Developer($99/년), Google Play($25) 조직 계정 → 앱 배포
5. `main` 브랜치 생성·병합 승인
6. (선택) Asana·Google Calendar 로그인 후 검수 — 대표 계정 필요, 현재 미검증

## 주의
- 시험용 가짜 서버(`tests/fake-google.mjs`)로 검증한 Google 동기화를 "실제 연동 완료"로 보고하지 않습니다.
- Vercel Hobby 요금제는 상업적 사용이 금지되어 있어 Pro가 필요합니다(OPERATIONS 7번).
- 이 클라우드 환경에서는 Maven Central이 429로 막혀 Android 로컬 빌드만 Google 미러(`~/.gradle/init.d/mirror.gradle`, 저장소 밖)를 썼습니다. CI는 표준 저장소를 씁니다.
