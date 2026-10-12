# 앱 기술 선택과 배포 방식

## 1. 기술 선택: Capacitor (운영 사이트를 여는 네이티브 앱 + 네이티브 기능)

| 기준 | Capacitor (선택) | React Native/Expo | Flutter | PWA만 |
|---|---|---|---|---|
| 웹과 코드 공유 | 화면 100% 공유 (같은 사이트) | 화면 별도 작성 | 화면 별도 작성 | 100% |
| 유지비 | 웹 수정 = 앱 즉시 반영, 스토어 재심사 거의 불필요 | 화면 2벌 유지 | 화면 2벌 유지 | 최저 |
| 푸시 | FCM(Android)·APNs via FCM(iOS) 네이티브 | 가능 | 가능 | iOS 는 홈 화면 웹앱 16.4+ 만 |
| 사진·파일 첨부 | WebView 파일 선택·카메라 (권한 문구 포함) | 가능 | 가능 | 가능 |
| 앱 출시 인정 | ✅ 스토어 배포 가능 | ✅ | ✅ | ❌ (요구사항상 출시로 보지 않음) |

**위험**: 단순 WebView 앱은 Apple 심사 지침 4.2(최소 기능) 거절 위험이 있습니다. 그래서 다음 네이티브 기능을 넣었습니다. 네이티브 푸시(앱이 닫혀 있어도 수신하고, 알림을 누르면 해당 업무로 이동), 딥링크(workos://, 앱 링크·유니버설 링크), 카메라 촬영 첨부, 오프라인 안내 화면, Android 뒤로가기 처리. 또한 임직원 전용 앱이므로 지침 2.1에 따라 **심사용 계정**을 제출합니다.

구성: `mobile/` (appId `kr.co.dagym.workos`, 앱 이름 "업무일정")
- `capacitor.config.ts`의 `server.url`이 운영 주소를 엽니다. 웹과 같은 로그인 쿠키·같은 데이터를 씁니다.
- 로그인 세션은 30일 슬라이딩입니다. 로그아웃하면 그 기기의 푸시 토큰도 해제합니다.
- 푸시는 `@capacitor-firebase/messaging`(FCM 토큰 → `/api/push/subscribe`)으로 받습니다. 서버는 FCM HTTP v1로 보냅니다.
- 네트워크 끊김 시: 등록·댓글은 기기에 보관했다가 재연결 때 같은 Idempotency-Key로 다시 보냅니다(중복 생성 없음). 서버에 연결할 수 없으면 `offline.html`을 보여 줍니다.

## 2. 배포 방식 비교 (임직원 10~100명)

| 방식 | 비용 | 장점 | 단점 | 판단 |
|---|---|---|---|---|
| Google Play 내부 테스트 트랙 | $25 1회 (조직 계정, D-U-N-S 필요) | 심사 거의 없음, 100명까지, 자동 업데이트 | 테스터 이메일 등록 필요 | **Android 1단계 채택** |
| Google Play 비공개(Managed Google Play) | Workspace/EMM 필요 | 회사 기기 관리 | 회사가 Google Workspace 를 써야 함 | Workspace 사용 시 전환 |
| APK 직접 배포 | 무료 | 즉시 | "출처를 알 수 없는 앱" 허용 필요, 자동 업데이트 없음, 2027년 개발자 확인 의무화 예정 | 비상용으로만 |
| TestFlight 외부 테스트 | Apple $99/년 | 최대 10,000명, 링크로 설치 | 빌드 90일 만료, 첫 빌드 베타 심사 | **iOS 1단계(시범)** |
| Apple 비공개(Unlisted) 배포 | Apple $99/년 | 스토어 검색에 노출되지 않음, 링크로 설치, 개인 기기 가능 | 정식 App Review 필요, 별도 신청 | **iOS 정식 운영** |
| Apple Business Manager 맞춤형 앱 | ABM 가입 | 회사 기기 일괄 배포 | MDM 등 관리 체계 필요 | 보류 |
| Apple Enterprise Program | $299/년 | — | 임직원 100명 이상 요건, 심사 엄격 | 요건 미충족 |

**선택**: Android는 Play 조직 계정 → 내부 테스트 트랙으로 배포합니다. iOS는 Apple 조직 계정 → TestFlight 시범 후 Unlisted 배포로 운영합니다. 공개 스토어 노출은 하지 않습니다.

## 3. 출시 단계 (기록 구분)
| 단계 | Android | iOS | 증거 |
|---|---|---|---|
| ① 앱 빌드 | ✅ 디버그 APK (2026-10-12, 이 환경) | 🟡 CI(macOS) 시뮬레이터 빌드 구성 | WORK_STATUS |
| ② 내부 테스트 배포 | ⛔ 계정 대기 | ⛔ 계정 대기 | |
| ③ 스토어 제출 | ⛔ | ⛔ | |
| ④ 심사 통과 | ⛔ | ⛔ | |
| ⑤ 실제 설치 가능 | ⛔ | ⛔ | |

## 4. 대표가 직접 해야 하는 일 (한 번에 묶음)
1. **D-U-N-S 번호** 조회 또는 신청 (무료, 1~2주). Apple·Google 조직 계정에 모두 필요합니다.
2. **Apple Developer Program 조직 가입** ($99/년, 매년 자동 청구) → App Store Connect 에 개발자 초대
3. **Google Play Console 조직 계정** ($25 1회) + 본인 확인 → 개발자 초대
4. **Firebase 프로젝트** 생성(무료). Android 앱 `kr.co.dagym.workos`와 iOS 앱을 등록하고, APNs 인증 키(.p8)를 올린 뒤 서비스 계정 키를 발급합니다. 직접 하기 어려우면 개발자를 프로젝트 편집자로 초대해 주세요.
5. 개인정보처리방침의 **개인정보 보호책임자 이름·연락처** 확정 (사이트 `/privacy`에 표시)

## 5. 준비된 것
- 아이콘·스플래시 (`mobile/assets`, 자동 생성됨)
- 개인정보처리방침 페이지 `/privacy`
- 서명: Android 서명 키는 GitHub Secrets(`ANDROID_KEYSTORE_BASE64` 등)에 넣으면 CI 가 서명된 AAB 를 만듭니다. iOS 는 Apple 계정이 생기면 Xcode 자동 서명을 씁니다.
- 앱 링크 검증 파일 `/.well-known/assetlinks.json`(ANDROID_CERT_SHA256)과 `/.well-known/apple-app-site-association`(APPLE_TEAM_ID)
- 스토어 설명 초안: "다짐·하이링크·BODY LAB 임직원 전용 업무·일정 관리 앱. 관리자가 초대한 계정으로만 로그인할 수 있습니다."
- 심사용 계정: 운영 배포 후 '심사용' 직원 계정을 만들어(관리자 화면 → 직원 초대) 심사 메모에 기재합니다.
