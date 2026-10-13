# 앱 알림을 눌러도 해당 화면으로 안 감 (대표 신고 2026-10-13 18:50, 삼성 Android 앱 vc11)

## 원인 (코드 확인)
- `src/lib/push.ts` sendFcm: `android.notification.click_action: 'FCM_PLUGIN_ACTIVITY'` — 옛 cordova-plugin-fcm 용 값. 우리 앱(`@capacitor-firebase/messaging` 8.x)의 AndroidManifest 에는 이 action 을 받는 activity 가 없음(`grep FCM_PLUGIN_ACTIVITY mobile/android` 결과 없음) → 알림을 눌러도 MainActivity 가 data(link) 를 받지 못해 `notificationActionPerformed` 가 안 오거나 앱만 열림.
- 앱이 꺼져 있다 알림으로 켜질 때: `initNative`(AppShell) 가 원격 페이지 로드 뒤에 리스너를 붙임 → 이벤트를 놓칠 수 있음.

## 요청 (서버·웹 코드만 — 앱 새 빌드 불필요)
1. `click_action` 제거(기본 = 앱 실행 activity 로 data 전달). iOS 는 그대로(data 최상위 link).
2. 놓친 탭 보완: 알림 data 의 `notificationId` 를 이용해 — 앱이 열릴 때(`App` resume·첫 로드) 서버에 "가장 최근 눌림 후보"를 묻는 대신, `FirebaseMessaging.getDeliveredNotifications()`/런치 intent extras 확인이 어려우면 **링크를 URL 로 직접 여는 방식**: FCM data 에 `link` 외 `url`(운영 전체 주소) 도 넣고, Android `notification.click_action` 없이도 Capacitor 가 런치 intent 의 extras 를 `notificationActionPerformed` 로 넘기는지 실기기 확인. 필요하면 리스너를 `initNative` 맨 앞(첫 await 전)에 등록.
3. 알림 누름 → 해당 업무/일정 상세 열림 + 그 알림 읽음 처리.
4. 확인: 로컬이 대표 휴대폰(삼성)으로 시험 알림을 보내 눌러서 이동 확인(운영 상태 "시험 푸시" 버튼 → 링크 /tasks/… 포함되게).
