# 휴대폰 예약 알림(로컬 알림) — 정확한 시각의 미리 알림 (대표 승인 2026-10-14)

> 대표: 외부 크론 가입 없이 Google Calendar 처럼 "30분/1시간 전" 알림이 정확히 오게. → 기기에 미리 예약하는 로컬 알림. **앱 새 빌드 1회 필요**(로컬이 빌드·업로드).
> 분담: 클라우드 = `mobile/package.json` 플러그인 추가 + 웹(`src/components/native.ts` 등) 예약 로직 + 서버 API. 로컬 = Android Manifest·iOS 설정, 빌드(mobile.yml/release.yml), Play·TestFlight 업로드, 실기기 확인.

## 동작
1. 플러그인 `@capacitor/local-notifications`(Capacitor 8 호환 버전) 추가.
2. 서버 `GET /api/reminders/upcoming?days=7` — 내가 받을 미리 알림 목록(일정·시간 있는 업무·날짜 업무 09시·아침 브리핑 08:30): `{id, fireAt, title, body, link}`. 사용자 기본값·항목별 🔔(8차 8번) 반영, 완료·삭제·비공개 규칙 반영.
3. 앱 시작·포그라운드 복귀·알림 목록 변경 이벤트(`wos-refresh`)·FCM 데이터 메시지("reminders-changed") 때 → 기존 예약 전부 취소 후 7일치 재예약(Android 최대 개수 고려 ~64개, 가까운 순).
4. 로컬 알림 탭 → `link` 로 이동(`localNotificationActionPerformed`), 서버에 "읽음".
5. **중복 방지**: 로컬 예약이 가능한 기기(앱 버전 ≥ 새 버전, 권한 허용)는 서버가 같은 미리 알림을 FCM 으로 **보내지 않음**(기기 등록 시 `localReminders: true` 기록). 웹·구버전 앱·권한 없는 사람은 지금처럼 서버 푸시.
6. 다른 사람이 일정/업무를 바꾸면 영향받는 사용자에게 조용한 FCM 데이터 메시지 → 앱이 깨어 있으면 재예약, 못 받아도 다음 앱 열 때 재예약 + 서버 보조 푸시(변경 후 1시간 내 알림은 서버가 보냄).

## 로컬(네이티브) 몫
- Android: `SCHEDULE_EXACT_ALARM`(또는 `USE_EXACT_ALARM` 검토)·`RECEIVE_BOOT_COMPLETED` 권한, 알림 채널 "reminders"(중요도 높음), 정확한 알람 권한 안내 화면 연결. iOS: 추가 설정 없음(64개 한도).
- 빌드: Android vc 다음 번호 + iOS 1.0.3 → 내부 테스트·TestFlight. 실기기(대표 삼성)에서 "2분 뒤" 시험 일정으로 확인.

## 시험
- API: upcoming 목록(기본값·항목별·삭제 제외·비공개), localReminders 기기는 서버 미리 알림 생략.
- 웹 단위 시험: 재예약 로직(취소→예약, 64개 제한).
