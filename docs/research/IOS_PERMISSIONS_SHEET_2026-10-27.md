# 아이폰 '휴대폰 알림 맞추기' 창 (결정 15-27) — 웹 몫 199차 · 네이티브 몫(로컬, 앱 1.1.4)

대표 10/26 16:40(#698) 결정 15-27: 아이폰 앱도 안드로이드 1.1.3(#528, 178차)과 같은 권한 안내 창.
웹 코드: `src/components/PermissionIntro.tsx`(줄 고르기 `rowsOf`) · `src/components/native.ts`(`permissionStatus`·`openNotificationSettings`·`requestAlarmAuthorization`).

## 1. 웹 199차 배포 뒤 — 지금 아이폰 앱(1.1.x, 네이티브 메서드 없음) 그대로

- 로그인 뒤 알림이 꺼져 있으면 한 번: '휴대폰 알림 맞추기' 창에 **알림 허용 한 줄**. 예전 '알림 받기' 창은 아이폰에서 더 안 뜸(안드로이드 1.1.2 이하만 예전 창).
- 상태는 이미 들어 있는 푸시 플러그인(`FirebaseMessaging.checkPermissions`)으로 읽음 — 새 앱 없이 바로.
- [허용] = 시스템 알림 허용 창 · **이미 거절했으면 [설정 열기]** = `app-settings:` 주소 → 설정 › 워크인
  (Capacitor 8.5.3 `WebViewDelegationHandler` 가 앱 밖 주소를 `UIApplication.shared.open` 으로 넘김 — 코드로 확인, 실기기 확인 전).
- [나중에] = 하루 뒤 다시 · [다 했어요] = 끝 · 설정 › 알림 [휴대폰 알림 맞추기 다시 보기].

## 2. 네이티브 몫 — `WorkinNative` 플러그인(Swift, 앱 1.1.4)

등록: `CAPBridgeViewController` 하위 클래스를 만들고 `capacitorDidLoad()` 에서 `bridge?.registerPluginInstance(WorkinNativePlugin())`,
`SceneDelegate` 의 `rootViewController` 를 그 클래스로. `jsName = "WorkinNative"`(안드로이드와 같은 이름 — 웹이 그대로 부름).

| 메서드 | 돌려주는 값 | iOS API · 메모 |
|---|---|---|
| `getInfo()` | `{ platform: 'ios', caps: [...] }` | `ios-permissions-1`(아래 세 메서드) · `ios-alarmkit-1`(AlarmKit **알람 예약까지** 됐을 때만) · `ios-widget-1`(위젯 확장이 있을 때) · `app-badge-1`(setBadge 를 넣었을 때) |
| `permissionStatus()` | `{ platform: 'ios', notifications, notifState, focus, alarmKit, widgetSupported, widgets, widgetPin: false }` | `UNUserNotificationCenter.current().notificationSettings()` — `authorizationStatus` .authorized·.provisional·.ephemeral → notifications true / .notDetermined → notifState 'prompt' / .denied → 'denied' · `timeSensitiveSetting` .enabled → focus true, .disabled → false, 지원 안 함·알림 꺼짐 → **null**(줄 숨김) · `AlarmManager.shared.authorizationState`(iOS 26+, `ios-alarmkit-1` 일 때만, 아니면 **null**) · `WidgetCenter.shared.getCurrentConfigurations` 개수(위젯 확장이 없으면 widgetSupported false) |
| `openNotificationSettings()` | — | `UIApplication.openNotificationSettingsURLString`(iOS 16+), 그 아래는 `openSettingsURLString` |
| `requestAlarmAuthorization()` | `{ state: 'prompt' \| 'denied' \| 'granted' }` | `AlarmManager.shared.requestAuthorization()`(iOS 26+) |
| `requestPinWidget()` | `{ requested: false }` | 아이폰은 앱이 위젯을 놓을 수 없음 — 늘 false(웹이 '길게 눌러 [편집] → [위젯 추가]' 안내) |
| `setBadge({ count })`(선택) | — | `UNUserNotificationCenter.current().setBadgeCount(n)`(iOS 16+) — 넣으면 caps 에 `app-badge-1`, 서버가 푸시에 배지 숫자를 실음 |

웹이 줄을 고르는 규칙(`rowsOf`): 알림 허용(늘) · 집중 모드에서도 알람(focus 가 null 이 아니고 알림 허용됨) · 잠금 화면 알람(alarmKit 이 null 이 아님) · 홈 화면 위젯(widgetSupported).
정확한 시각 알람 줄은 안드로이드만(아이폰 예약 알림은 늘 제시각).

## 3. 설정 파일

- `App.entitlements`: `com.apple.developer.usernotifications.time-sensitive` = true + App ID 에 Time Sensitive Notifications 켜기.
  서버는 이미 알람 푸시에 `aps.interruption-level = time-sensitive` 를 싣고 있음(`src/lib/push.ts`) — entitlement 가 없으면 iOS 가 보통 알림으로 다룸.
- `Info.plist`: `NSAlarmKitUsageDescription`(AlarmKit 를 쓸 때) — 예: "‘알람처럼 울리기’를 켠 일정·마감을 잠금 화면에 알람으로 띄웁니다."
- AlarmKit: 안드로이드 `setAlarms`·`addAlarm`·`settleAlarm`(전체화면 알람 #447)과 같은 모양의 예약이 들어간 뒤에만 `ios-alarmkit-1` 을 caps 에 넣음
  — 허용만 받고 알람을 못 울리면 창의 안내가 사실과 달라짐.

## 4. 순서 · 확인

1. 1.1.4 빌드: `WorkinNative`(getInfo·permissionStatus·openNotificationSettings·requestPinWidget) + 시간 민감 entitlement → TestFlight.
   주소 분리(결정 15-29)의 1.1.4 네이티브 변경(`allowNavigation` app.work-in.dev — docs/research/WWW_APP_HOST_SPLIT_2026-10-25.md §9)과 같은 빌드로 묶으면 심사 한 번.
2. 아이폰 확인(대표 휴대폰): 앱 지우고 재설치 → 로그인 → 창: 알림 허용 [허용] → '허용됨' → '집중 모드에서도 알람' 줄 → [설정 열기] → 돌아오면 상태 다시 읽음.
   지금 앱(1.1.x)으로도: 알림을 거절해 둔 상태에서 창 [설정 열기] → 설정 › 워크인이 열리는지.
3. AlarmKit 알람 예약 · '워크인 오늘' 위젯 확장은 따로(각각 caps 를 넣으면 웹 줄이 자동으로 나타남).
