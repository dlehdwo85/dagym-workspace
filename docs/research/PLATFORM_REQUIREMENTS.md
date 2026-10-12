# 플랫폼 요구사항 조사 — Google Calendar API · 푸시 · 앱 배포 · 호스팅

- 대상: COMPANY-WORK-OS (사내 직원 10~100명 전용, Android/iOS 앱)
- **확인일: 2026-10-12** (모든 수치는 이 날짜에 아래 공식 문서에서 확인한 값)
- 표기: ✅ 공식 문서에서 확인 / ⚠️ 공식 문서에 명시되지 않아 추론하거나 일반 관행을 적음 / ❓ 미확인(콘솔에서 확인 필요)

---

## 1. Google Calendar API

### 1-1. OAuth 스코프

출처: https://developers.google.com/workspace/calendar/api/auth ✅ (스코프 목록과 설명), https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification ✅

| 스코프 | 의미 (공식 설명 요약) | 민감도 | 우리 용도 |
|---|---|---|---|
| `calendar` | 접근 가능한 모든 캘린더 보기·수정·공유·영구 삭제 | Sensitive ⚠️ | 사용하지 않음(과도함) |
| `calendar.events` | 모든 캘린더의 일정 보기·수정 | Sensitive ⚠️ (콘솔 스코프 선택기에서 sensitive로 분류된다는 개발자 포럼 보고가 있음) | 양방향 동기화가 필요할 때 |
| `calendar.events.readonly` | 일정 보기 | Sensitive ⚠️ | 읽기 전용 가져오기 |
| `calendar.events.owned` | **내가 소유한** 캘린더의 일정 보기·생성·변경·삭제 | ❓ | 개인 기본 캘린더만 동기화할 때(범위가 좁아 권장 후보) |
| `calendar.app.created` | 보조 캘린더를 만들고 **앱이 만든 캘린더의 일정만** 관리 | ❓ (non-sensitive일 가능성이 있다는 개발자 질의는 있으나 공식 확인 안 됨) | **우리 서비스 일정을 "COMPANY-WORK-OS" 보조 캘린더로 내보낼 때 1순위** |
| `calendar.calendarlist.readonly` | 구독 중인 캘린더 목록 보기 | ❓ | 가져올 캘린더 선택 UI |
| `calendar.freebusy` / `calendar.events.freebusy` | 바쁨/한가함만 보기 | ❓ | 회의 시간 추천 |
| `calendar.readonly`, `calendar.settings.readonly`, `calendar.calendars(.readonly)`, `calendar.acls(.readonly)`, `calendar.calendarlist`, `calendar.events.owned.readonly`, `calendar.events.public.readonly` 등 | 공식 페이지에 총 20개가 있음 | ❓ | — |

- **Restricted 여부**: 공식 Calendar 문서에는 Calendar 스코프를 restricted로 표시한 곳이 없습니다(restricted는 Gmail·Drive 계열이 대표적). Google의 sensitive 예시 문구는 "Examples of sensitive scopes include reading events stored in Google Calendar"입니다. ⚠️ 정확한 분류는 **Google Cloud Console의 "데이터 액세스(Data Access)" 화면에서 스코프를 추가해 보고 확인**해야 합니다 ❓.
- 원칙: 가장 좁은 스코프를 쓰고, 필요할 때 추가로 요청합니다(incremental auth).

### 1-2. OAuth 앱 게시·검증

출처: https://support.google.com/cloud/answer/15549945 ✅, https://support.google.com/cloud/answer/13464323 ✅, https://support.google.com/cloud/answer/13464321 ✅, https://developers.google.com/identity/protocols/oauth2 ✅

| 항목 | 내용 |
|---|---|
| User type **Internal** | 같은 Google Cloud Organization(= **Google Workspace / Cloud Identity 도메인**) 사용자만 가능하고, 외부 사용자는 `org_internal` 오류. **검증이 필요 없음**("only used by people in your Google Workspace or Cloud Identity organization") |
| User type **External** | Google 계정이 있으면 누구나 가능 |
| Testing 상태 | **테스트 사용자 최대 100명**(콘솔에 등록). **동의 7일 후 만료 → refresh token도 7일 만에 만료**(name·email·profile 스코프만 요청한 경우는 예외). 상시 동기화 서비스에는 **사용할 수 없음** |
| In production(미검증) | sensitive 스코프를 요청하면 "확인되지 않은 앱" 경고 화면이 뜨고, **프로젝트 수명 전체 기준 신규 사용자 100명 상한**(초기화 불가) |
| 검증 면제 | 개인 용도(<100명), 개발/테스트, 서비스 계정이 자기 데이터만 접근, **Internal(조직 내부)**, 관리자가 신뢰 앱으로 등록 |
| sensitive 검증 요건 | 개인정보처리방침 URL(홈페이지와 동의 화면에서 링크), **승인된 도메인을 Search Console로 소유 확인**, OAuth 흐름 전체가 나오는 **데모 영상**, 스코프별 사유. restricted 스코프는 여기에 더해 연 1회 보안 평가 |
| refresh token 한도 | 계정 × OAuth 클라이언트당 100개. 넘으면 가장 오래된 것부터 경고 없이 무효화 |

### 1-3. 증분 동기화 (syncToken)

출처: https://developers.google.com/workspace/calendar/api/guides/sync ✅

| 항목 | 내용 |
|---|---|
| 흐름 | 최초 전체 동기화(`events.list`) → 마지막 페이지의 `nextSyncToken` 저장 → 이후 `syncToken=`으로 변경분만 조회 |
| 페이지네이션 | 변경이 많으면 `nextPageToken`이 옴 → **같은 syncToken과 쿼리**에 pageToken을 붙여 반복 → 마지막 페이지에서 새 syncToken |
| 파라미터 제약 | 최초 요청과 **같은 쿼리 파라미터**를 써야 함. syncToken과 함께 쓸 수 없는 필터(시간 범위 등)를 넣으면 400 |
| 삭제 | 증분 결과에는 **삭제된 항목이 항상 포함**됨(`status: cancelled`) → 로컬에서 삭제 처리 |
| **410 GONE** | 토큰 만료나 ACL 변경 등으로 토큰이 무효해짐 → **로컬 저장분을 모두 지우고 전체 재동기화** |

### 1-4. 푸시 알림 (events.watch)

출처: https://developers.google.com/workspace/calendar/api/guides/push ✅, https://developers.google.com/workspace/calendar/api/v3/reference/events/watch ✅

| 항목 | 내용 |
|---|---|
| 감시 대상 | Events·ACL(캘린더 단위), CalendarList·Settings(사용자 단위) |
| webhook 주소 | **HTTPS 필수**, 유효한 SSL 인증서(자체 서명·만료·호스트 불일치 불가) |
| 도메인 소유 확인 | **현행 문서에는 언급 없음** ✅. 예전 가이드에 있던 Search Console 도메인 등록 요건은 현재 문서에서 빠짐. OAuth 검증 단계의 도메인 확인과는 별개 |
| `id` | 프로젝트 안에서 고유, UUID 권장, 최대 64자 → `X-Goog-Channel-Id` |
| `token` | 선택, 최대 256자, 모든 알림의 `X-Goog-Channel-Token` 헤더로 돌아옴 → **채널 검증용 HMAC/랜덤 값 저장**(OAuth 토큰 같은 민감 정보는 넣지 말 것) |
| 만료 | `params.ttl` **기본 604800초(7일)**. 최대값은 문서에 없음 ⚠️("요청값과 내부 한도 중 더 제한적인 값") |
| 갱신 | **자동 갱신 없음** → 만료 전에 새 `id`로 `watch` 재호출(잠시 겹쳐도 됨) → 기존 채널은 `channels.stop(id, resourceId)` |
| 알림 내용 | 본문 없음. `X-Goog-Resource-State: sync`(최초, Message-Number=1) / `exists` / `not_exists` → **받으면 증분 동기화 실행** |
| 응답 | 200/201/202/204/102이면 성공. 5xx는 지수 백오프로 재시도 |
| 신뢰성 | "Notifications are not 100% reliable" → **주기적 폴링(예: 15~30분)으로 보완**(Vercel Pro Cron 필요, §5) |
| eventTypes | `default, birthday, focusTime, fromGmail, outOfOffice, workingLocation` 필터 가능 |

### 1-5. 반복 일정

출처: https://developers.google.com/workspace/calendar/api/guides/recurringevents ✅

| 개념 | 내용 |
|---|---|
| `recurrence` | RFC 5545 줄 배열(`RRULE:`, `EXDATE:`, `RDATE:`). 공식 가이드 예시는 RRULE(+UNTIL)뿐이고 EXDATE/RDATE는 RFC 5545 표준 ⚠️ |
| 인스턴스 조회 | `events.instances(eventId)` 또는 `events.list(singleEvents=true)`(이 경우 마스터는 빠지고 인스턴스만 옴) |
| `recurringEventId` | 인스턴스가 속한 마스터 ID |
| `originalStartTime` | 인스턴스를 옮겨도 변하지 않는 고유 식별 시각 → **로컬 예외 레코드의 키** |
| 단일 회차 수정 | 인스턴스를 조회해 PUT → 예외 생성. 취소는 `status=cancelled` |
| "이후 모든 일정" | 공식 가이드에 없음 ⚠️ → 일반적으로 **마스터 RRULE에 UNTIL 설정 + 새 시리즈 생성**(GCal UI와 같은 방식) |
| 주의 | 인스턴스를 하나씩 대량 수정하면 예외가 쌓이므로 "모든 일정"은 마스터를 수정 |

### 1-6. ETag / 동시 수정 충돌

출처: https://developers.google.com/workspace/calendar/api/guides/version-resources ✅

- 리소스마다 `etag`가 있습니다. 수정·삭제 때 `If-Match: <etag>`를 보내고 결과가 **412 Precondition Failed**이면 다시 조회 → 병합 → 재시도합니다.
- 조회 때 `If-None-Match`를 보내면 바뀐 게 없을 때 **304**를 받습니다.
- insert는 조건부 요청을 지원하지 않습니다. 일부 변경(calendarList의 읽기 전용 필드, ACL 등)은 etag를 바꾸지 않습니다.

### 1-7. 쿼터

출처: https://developers.google.com/workspace/calendar/api/guides/quota ✅

| 한도 | 값 |
|---|---|
| 프로젝트당 분당 | 10,000 요청 |
| 사용자당 분당(프로젝트별) | 600 요청 |
| 일일 무료 기준 | 프로젝트당 하루 1,000,000 요청(상향 불가). **"2026년 중 한도 초과분 과금 예정"** 문구가 있음 |
| 초과 응답 | `403 usageLimits` / `429 usageLimits` → 지수 백오프(2^n초 + 최대 1초 지터, 상한 32~64초) |

→ 직원 100명 규모라면 쿼터는 문제가 되지 않습니다.

---

## 2. 푸시 알림

| 항목 | 요구사항 | 출처 |
|---|---|---|
| **FCM HTTP v1** | `POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send`. **서비스 계정**으로 OAuth2 액세스 토큰 발급(스코프 `https://www.googleapis.com/auth/firebase.messaging`), `Authorization: Bearer`. 메시지는 `token/topic/condition` + `notification` + (참조 문서의) `data/android/apns/webpush` 오버라이드 | https://firebase.google.com/docs/cloud-messaging/send/v1-api ✅ |
| 서비스 계정 키 | Vercel 환경변수에 JSON을 넣거나(비밀 관리) Admin SDK 사용. 클라이언트에 노출 금지 | ⚠️ 일반 관행 |
| **iOS (APNs via FCM)** | Firebase 콘솔에 **APNs 인증 키(.p8) + Key ID** 업로드(개발/운영 중 최소 1개). FCM SDK의 method swizzling(끌 수 있음). APNs 키를 만들려면 **유료 Apple Developer Program**이 필요 ⚠️ | https://firebase.google.com/docs/cloud-messaging/ios/client ✅ |
| **@capacitor/push-notifications** | `npm i @capacitor/push-notifications && npx cap sync`. iOS: Xcode에서 **Push Notifications capability**, `AppDelegate.swift`에 `didRegisterForRemoteNotificationsWithDeviceToken`/`didFail…` 추가. Android: `google-services.json` 배치, **Android 13+에서는 `requestPermissions()` 필수**, Android 8+에서는 `createChannel()`로 알림 채널 생성, 기본 아이콘 meta-data(흰색·투명 배경). 현재 문서 기준 Capacitor v8(v9 문서도 존재) | https://capacitorjs.com/docs/apis/push-notifications ✅ |
| ⚠️ 토큰 차이 | 이 플러그인은 **iOS에서 APNs 토큰, Android에서 FCM 토큰**을 반환 → iOS도 FCM v1로 보내려면 iOS에 Firebase Messaging SDK를 붙여 FCM 토큰을 받아야 함(비공식 커뮤니티 플러그인 `@capacitor-firebase/messaging` 등) 또는 서버에서 APNs로 직접 발송 | 위 문서 ✅ + ⚠️ |
| **Web Push (VAPID)** | 표준 Push API + Service Worker + Notifications API. FCM은 `webpush` 설정과 VAPID 키 쌍을 지원 | ⚠️ (FCM 웹 문서 미재확인) |
| **iOS Safari Web Push** | **iOS/iPadOS 16.4+에서 "홈 화면에 추가"한 웹앱만** 가능. manifest `display: standalone` 또는 `fullscreen` 필요, **사용자 탭에 대한 응답으로만** 권한 요청 가능, Apple Developer 가입 불필요, 서버 방화벽에서 `*.push.apple.com` 허용 | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ✅ |

---

## 3. 직원 전용 앱 배포 방법과 비용

### 3-1. iOS

| 경로 | 비용 | 대상·제약 | 심사 | 출처 |
|---|---|---|---|---|
| **Apple Developer Program**(필수 기반) | **US$99/년**(현지 통화 청구, 지역마다 다를 수 있음) | 법인으로 가입하려면 법인격·**D-U-N-S**·법적 서명 권한·회사 도메인 이메일·공개 웹사이트 필요. Apple 계정 2단계 인증 필수 | — | https://developer.apple.com/support/enrollment/ ✅ |
| **TestFlight 내부** | 위 비용에 포함 | **최대 100명**, App Store Connect 사용자(역할 부여)여야 함 | 심사 없음 | https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview ✅ |
| **TestFlight 외부** | 포함 | **최대 10,000명**, 이메일 초대 또는 공개 링크 | **첫 빌드는 베타 앱 심사** | 위와 같음 ✅ |
| (TestFlight 공통) | | **빌드는 90일 후 만료** → 90일 안에 새 빌드를 올려야 함 | | ✅ |
| **Unlisted app distribution** | 포함 | 링크로만 설치 가능하고 검색·차트에 노출되지 않음. **"employee resources"와 MDM 관리 대상이 아닌 직원 개인 기기**를 명시적으로 대상에 포함. 링크만 있으면 누구나 설치할 수 있어 **앱 내 접근 제어 필요**. 베타 상태로는 신청 불가 | **정식 App Review** + 신청서 제출 | https://developer.apple.com/support/unlisted-app-distribution/ ✅ |
| **Custom app (Apple Business, 구 Apple Business Manager)** | 개발자 $99/년 + Apple Business 무료 ⚠️ | "proprietary app for your organization's internal use" 지원. App Store Connect → Pricing and Availability → **Private** → Organization ID 지정. 배포는 **MDM 또는 리딤 코드**(MDM 필수 아님). Private 지정은 **승인 전에만** 가능. 한국에서 Apple Business 사용 가능 | **App Review** (민감 데이터가 있으면 샘플 데이터·데모 계정 제공) | https://developer.apple.com/custom-apps/ ✅, https://support.apple.com/guide/business/feature-availability-axmef1c47twq/web ✅ |
| **Apple Developer Enterprise Program** | **US$299/년** | **직원 100명 이상**, 법인, D-U-N-S, 공개 웹사이트, 직원만 다운로드하게 하는 시스템, **Apple 검증 인터뷰와 지속 평가**. App Store·Custom app·TestFlight로 해결되지 않는 경우에만 허용되며 Apple 재량으로 거절 가능 | 없음(자체 서명) | https://developer.apple.com/programs/enterprise/ ✅ |

→ **다짐 그룹(10~100명)은 Enterprise 대상이 아닙니다**(인원 요건과 "다른 경로로 해결 가능" 요건 모두 해당하지 않음).

### 3-2. Android

| 경로 | 비용 | 대상·제약 | 출처 |
|---|---|---|---|
| **Google Play Console 가입** | **US$25 1회** | 개인/조직 계정. 신분 확인(정부 발행 신분증, 본인 명의 카드). 18세 이상 | https://support.google.com/googleplay/android-developer/answer/6112435 ✅ |
| 조직 계정 요건 | 포함 | **D-U-N-S 필수**("will not be able to create a developer account for an organization without one", 발급까지 최대 30일). 조직명·주소는 Google 결제 프로필과 일치해야 함. 웹사이트 필요. 연락처 이메일·전화 OTP 인증. 게시 전 조직명·주소 인증 | https://support.google.com/googleplay/android-developer/answer/13628312 ✅ |
| 개인 계정 신규 요건 | — | **2023-11-13 이후 만든 개인 계정**은 프로덕션 출시 전에 **비공개 테스트 12명 이상이 14일 연속 참여** 후 프로덕션 액세스 신청(심사 보통 7일 이내). 문서는 개인 계정만 대상으로 함 → 조직 계정은 이 요건 없음 ⚠️ | https://support.google.com/googleplay/android-developer/answer/14151465 ✅ |
| **내부 테스트 트랙** | 포함 | **최대 100명**, 앱 설정을 끝내기 전에도 시작 가능, **표준 정책·보안 심사를 거치지 않을 수 있음**(빠른 배포). 테스터는 Google 계정 이메일로 등록 | https://support.google.com/googleplay/android-developer/answer/9845334 ✅ |
| 비공개(Closed) 테스트 | 포함 | 이메일 목록 최대 200개 × 목록당 2,000명, 또는 Google Group | 위와 같음 ✅ |
| **Managed Google Play 비공개 앱** | Play 가입비 + (Workspace 또는 EMM) | Play Console → Advanced settings → Managed Google Play에 **조직 ID** 등록(앱당 최대 1,000개 조직). 게시 후 몇 분이면 EMM에서 검색됨. 공개로 바꾸려면 새 패키지명 필요. **Google Workspace(Business 등) / Cloud Identity의 기본·고급 엔드포인트 관리 기기**에서만 동작(강제 설치는 Business Plus 이상) | https://support.google.com/googleplay/work/answer/6145139 ✅, https://knowledge.workspace.google.com/admin/devices/manage-private-android-apps-in-google-play ✅ |
| **APK 직접 배포(사이드로딩)** | 무료 | "알 수 없는 앱 설치" 허용 필요. 자동 업데이트 없음(앱 내 업데이트 체크를 직접 구현) | ⚠️ |
| **Android 개발자 인증(2026~)** | ADC Full Distribution 계정 **$25**(Limited Distribution은 면제, 기기 20대까지) | **2026-09-30부터 브라질·인도네시아·싱가포르·태국**의 인증 기기(Android 7+)에서 시행. **한국은 대상 아님**. **2027년 전 세계 확대**. Play App Signing 앱은 자동 등록. **ADB 설치는 인증 불필요**. 회사 관리 스토어(관리 기기)로 배포한 앱도 인증 불필요(그래도 등록 권장) | https://developer.android.com/developer-verification ✅, https://developer.android.com/developer-verification/guides ✅, https://developer.android.com/developer-verification/guides/faq ✅ |

### 3-3. Apple 심사 리스크 (WebView 래퍼 앱)

출처: https://developer.apple.com/app-store/review/guidelines/ ✅

| 가이드라인 | 원문 요지 | 우리에게 미치는 영향과 대응 |
|---|---|---|
| **4.2 Minimum Functionality** | "features, content, and UI that elevate it beyond a repackaged website… not particularly useful, unique, or 'app-like'" | Capacitor로 웹을 감싸기만 하면 **반려될 위험이 높음** → **네이티브 푸시, 오프라인 캐시, 생체 인증 잠금, 위젯/공유 시트, 카메라 첨부, 로컬 리마인더** 등 앱다운 기능을 반드시 넣음 |
| 4.2.2 | "web clippings, content aggregators, or a collection of links" 금지 | 외부 링크 모음처럼 보이지 않게 구성 |
| **2.1(a) App Completeness** | "include demo account info (and turn on your back-end service!) if your app includes a login". 법적 이유로 계정을 줄 수 없으면 사전 승인을 받아 데모 모드 | **심사용 데모 계정(더미 회사 데이터)** 을 상시 운영. 심사 기간에 백엔드가 살아 있어야 함 |
| 5.1.1(v) | 계정 기반 기능이 핵심이 아니면 로그인 없이 쓸 수 있게. **앱에서 계정을 만들 수 있으면 앱에서 삭제도 가능해야 함** | 사내 앱은 계정이 핵심이므로 로그인 필수는 정당. 가입 기능이 없으면(관리자 발급) 삭제 요구는 해당 없음 ⚠️. 그래도 "계정 삭제 요청" 메뉴를 두는 것이 안전 |
| 3.1.3(c) Enterprise Services | 조직에 직접 판매하는 앱은 IAP 예외 | 결제 기능이 없으므로 해당 없음 |
| (참고) | 가이드라인 본문에 "사내 직원용 앱 전용" 조항은 없음. **Unlisted와 Custom app도 똑같이 App Review를 받음** → 4.2·2.1이 그대로 적용 | |

---

## 4. 호스팅·인프라 헤드라인 가격

| 서비스 | 무료 | 유료 | 주의 | 출처 |
|---|---|---|---|---|
| **Vercel** | Hobby $0 — **"personal, non-commercial use" 전용** | **Pro $20/월**(개발자 좌석당 $20/월, Viewer 무료, $20 포함 크레딧) | **회사 업무용은 상업적 이용 → Pro 필요** | https://vercel.com/pricing ✅, https://vercel.com/docs/plans/hobby ✅ |
| **Vercel Cron** | Hobby: 프로젝트당 100개, **하루 1회만**, 정확도 ±59분(더 자주 실행하는 식은 배포 실패) | Pro: 100개, **분 단위** | GCal watch 갱신·폴링 보완·리마인더에는 Pro가 필요 | https://vercel.com/docs/cron-jobs/usage-and-pricing ✅ |
| **Neon Postgres** | Free: 프로젝트당 100 CU-시간, 1GB(계정 20GB), 5분 후 scale-to-zero | Launch $0.106/CU-h, Scale $0.222/CU-h, 저장 $0.35/GB-월, **월 최소 요금 없음** | 무료 한도를 넘으면 다음 주기까지 정지 | https://neon.com/pricing ✅ |
| **Supabase** | Free: DB 500MB, MAU 5만, 파일 1GB, **1주 동안 사용이 없으면 일시정지**, 활성 프로젝트 2개 | **Pro $25/월~**(8GB, $10 컴퓨트 크레딧), Team $599/월 | 무료는 일시정지 때문에 운영용으로 부적합 | https://supabase.com/pricing ✅ |
| **Cloudflare R2** | 월 10GB-월, Class A 100만, Class B 1,000만, **송신(egress) 무료** | Standard $0.015/GB-월 | 무료 한도는 Standard 스토리지에만 적용 | https://developers.cloudflare.com/r2/pricing/ ✅ |

---

## 5. 최종 권고 (직원 약 10~100명)

### 5-1. 권장 경로

| 플랫폼 | 1단계 (파일럿, 0~1개월) | 2단계 (정식 운영) | 이유 |
|---|---|---|---|
| **Android** | Play Console **조직 계정** → **내부 테스트 트랙**(최대 100명, 심사 거의 없음, Play 자동 업데이트) | 계속 내부 테스트로 운영하거나, 100명을 넘으면 **비공개 테스트(Google Group)**. 회사가 Google Workspace + 엔드포인트 관리를 도입하면 **Managed Google Play 비공개 앱**으로 전환 | 조직 계정은 "12명 × 14일" 요건이 없음. 사이드로딩은 업데이트·보안 관리가 어렵고 2027년 인증 확대 리스크가 있음(현재 한국은 대상 아님) |
| **iOS** | Apple Developer Program **조직** → **TestFlight 외부 테스트**(공개 링크 + 앱 로그인 제한). 첫 빌드 베타 심사. **90일마다 새 빌드** | **Unlisted App Distribution**(직원 개인 기기에 링크로 설치, App Store 자동 업데이트). Apple Business를 쓸 계획이 있으면 **Custom app + 리딤 코드**도 가능 | Enterprise는 자격 미달(100명 미만). 내부 TestFlight는 직원 모두를 ASC 사용자로 등록해야 해서 부적합 |
| **공통 대안** | PWA(홈 화면 추가) + Web Push — iOS 16.4+ 지원, 비용 0원 | 앱 심사가 지연될 때의 비상 경로 | 심사 리스크를 분산 |
| **Google Calendar 연동** | 회사가 **Google Workspace**를 쓰면 OAuth를 **Internal**로 → 검증 불필요, 7일 만료 없음 | Workspace가 없으면(개인 Gmail) External: Testing 모드는 **7일마다 재로그인**이 필요해 쓸 수 없음 → **프로덕션 + sensitive 스코프 검증**(개인정보처리방침, 도메인 Search Console 인증, 데모 영상), 또는 `calendar.app.created` 등 좁은 스코프로 검증 부담 최소화(분류는 콘솔에서 확인) | 결정 필요: **회사 메일이 Google Workspace인지** |

### 5-2. 대표가 직접 해야 하는 일 (위임 불가 또는 본인 인증 필요)

| 순서 | 할 일 | 비고 / 소요 |
|---|---|---|
| 1 | **D-U-N-S 번호 조회·신청**(법인별: 다짐 / 하이링크 / BODY LAB 중 앱 게시 주체 1곳 결정) — Apple의 D-U-N-S 조회 도구 https://developer.apple.com/enroll/duns-lookup/ | 무료. Apple 경로는 D&B 발급 최대 5영업일 + Apple 반영 2영업일. Google은 "최대 30일"로 안내. **영문 법인명·주소를 사업자등록증과 똑같이** 입력 |
| 2 | 회사 도메인 이메일, 공개 웹사이트(회사 소개 + **개인정보처리방침** 페이지) 준비 | Apple 조직 가입, Google OAuth 검증, Play 조직 계정에 모두 필요 |
| 3 | **Apple 계정(2단계 인증)** 으로 Apple Developer Program **조직 가입** 및 **US$99 결제** | 법적 서명 권한자(대표) 본인. Apple이 확인 전화를 하거나 서류를 요청할 수 있음 |
| 4 | **Google 결제 프로필(조직)** 생성 → Play Console **조직 계정** 가입, **US$25 결제**, 신원·조직 인증(신분증, OTP) | 등록 처리에 최대 48시간 |
| 5 | (Workspace 사용 시) Google Cloud 프로젝트 생성 → OAuth 동의 화면 **Internal** 설정. (미사용 시) Search Console 도메인 소유 확인 + 검증 신청 | 관리자 권한 필요 |
| 6 | (선택) **Apple Business** 가입 → Organization ID 확보 | Custom app 경로를 택할 때만 |
| 7 | 개발자에게 권한 위임: App Store Connect 사용자 초대(App Manager 역할), Play Console 사용자 초대, Firebase 프로젝트 권한 | 이후 업로드·배포는 개발 담당자가 진행 |
| 8 | Vercel 팀 Pro 결제 카드 등록 | 상업적 이용 |

### 5-3. 예상 비용

| 항목 | 1회성 | 연간/월간 반복 |
|---|---|---|
| Apple Developer Program | — | **US$99/년** |
| Google Play Console | **US$25** | — |
| D-U-N-S | 무료(대행 업체는 유료이므로 쓰지 않음) | — |
| Apple Business | — | 무료 ⚠️ |
| Vercel Pro | — | **US$20/월 × 개발자 좌석 수**(1명이면 연 $240) |
| DB: Neon Launch 또는 Supabase Pro | — | Neon 사용량 기준(소규모는 월 수 달러 수준 ⚠️) / Supabase **$25/월** |
| 파일: Cloudflare R2 | — | 10GB까지 무료 |
| FCM / APNs / Web Push | — | 무료 ⚠️ |
| Google Calendar API | — | 무료(하루 100만 요청 이하) |
| **합계(최소 구성: Vercel 1좌석 + Neon)** | **US$25** | **약 US$99/년 + US$20/월 + DB 사용량 ≈ 연 US$350~400** |
| 선택: Google Workspace(Managed Play, Internal OAuth) | — | 사용자당 별도 요금(이번 조사 범위 밖, 미확인 ❓) |
| 해당 없음: Apple Enterprise | — | (US$299/년, 자격 미달) |
