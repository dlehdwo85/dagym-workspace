# #652 홍보 사이트(www) ↔ CRM 화면(app) 주소 구분 설계안 (2026-10-25, 클라우드)

대표 10/25 23:58 결정: ① 주 주소 = `www.work-in.dev` 확정(15-10) ② 홍보 사이트와 CRM(로그인 뒤 화면) 주소를 구분하는 설계안을 먼저 받아 본다.
이 문서는 **설계안만**이다. 구현은 대표가 아래 '결정해 주실 것 3가지'를 정한 뒤 시작한다. 비밀값·개인정보 없음(환경 변수는 이름만).

## 0. 결론 먼저

| | 권장 | 내용 | 작업량(어림) | 바뀌는 것 |
|---|---|---|---|---|
| **A안** | ✅ 권장 | CRM 을 `app.work-in.dev` 로 분리, `www.work-in.dev` 는 홍보 화면만 | 클라우드 1.5~2일 + 로컬 1~2일(도메인·콘솔·앱 빌드) | 직원 전원 1회 재로그인, 웹 푸시 재구독, 외부 콘솔 콜백 7곳에 app. 추가, 앱 새 빌드 |
| B안 | 비권장 | 같은 호스트에서 CRM 을 `/app/…` 접두어 아래로 | 3~5일, 회귀 위험 큼 | 화면 주소 전부 바뀜(북마크·위젯·딥링크·알림 링크·시험 전부) |
| C안 | 대안 | 지금처럼 한 호스트, **경로로** 구분(이미 그렇게 동작) + 다듬기 | 0~0.5일 | 없음 |

- 지금도 `www.work-in.dev` 는 로그인 전에는 `/` 가 소개 화면이고, 검색엔진에는 공개 화면만 열려 있다(C안 상태). "주소 자체가 다르게 보이게" 하려면 A안.
- A안은 **배포를 둘로 나누지 않는다.** 같은 Vercel 프로젝트에 도메인 하나를 더 붙이고, 서버가 호스트 이름을 보고 갈라 준다. 그래서 데이터·로그인·API 는 하나다.
- B안이 비싼 이유: 워크인은 Next.js 화면 폴더 이름이 곧 주소라서 `/tasks`, `/calendar`, `/s/sales/...` 같은 모든 화면 폴더를 `/app/` 아래로 옮기고, 화면 안 링크·앱 위젯·딥링크(`workos://app/...`)·알림 링크·메일 링크·E2E 시험을 전부 고쳐야 한다. 쿠키·로그인·푸시는 안 바뀌지만, 그 이점보다 고칠 양과 회귀 위험이 크다.

### 결정해 주실 것 3가지
1. A안(app. 분리) / B안(/app 접두어) / C안(지금처럼) 중 어느 것으로 갈지.
2. A안이면 전환 때 **직원 전원 1회 재로그인**을 허용할지(허용하면 0.5일 절약). 허용하지 않으면 www 세션을 app. 으로 자동으로 이어 주는 1회용 코드 전달을 추가한다(앱 소셜 로그인 복귀와 같은 방식, +0.5일).
3. 전환 시점 — 앱 새 빌드(1.1.4)가 스토어에 올라간 **뒤**여야 한다(이유는 §3-5).

## 1. 지금 상태(코드로 확인한 사실)

| 항목 | 지금 |
|---|---|
| 호스트 | `www.work-in.dev`(주 주소) · `work-in.dev` → www 308(Vercel 도메인 설정, 코드 아님) · `dagym-workspace.vercel.app`(같은 배포) |
| 홍보 화면 | `/`(로그인 전엔 서버가 `/welcome` 을 보여 줌 — 주소는 `/` 그대로), `/welcome`, `/landing/{3개}`, `/signup`, `/login`, `/privacy`, `/terms`, `/account-deletion` |
| 갈림 규칙 | `src/middleware.ts`: `/` 에 세션 쿠키(`wos_session`)가 없고 앱(WebView)이 아니면 소개 화면. 앱은 로그인 화면 |
| 검색 색인 | `robots.ts`: 공개 화면만 허용, 앱 경로 36개 묶음은 Disallow · 사이트맵·canonical·OG 는 `NEXT_PUBLIC_SITE_URL`(기본 www) |
| 세션 쿠키 | `wos_session` — httpOnly · SameSite=Lax · Secure · path `/` · **domain 없음(호스트 전용)** → www 에서 로그인한 쿠키는 app. 으로 안 넘어감 |
| 출처 검사(CSRF) | 바꾸는 요청의 Origin 이 요청 호스트와 같거나 `APP_URL` 호스트여야 함 |
| 소셜 로그인(구글·카카오·네이버) | 콜백 = `{APP_URL}/api/auth/oauth/{제공자}/callback`. 시작할 때 서명한 **state 쿠키**(호스트 전용, path `/api/auth/oauth`)를 두고 콜백에서 읽음 → **시작한 호스트와 콜백 호스트가 같아야** 함. 앱은 시스템 브라우저에서 로그인 → `/auth/app-return` → `workos://open/auth/app?…` → 앱이 1회용 표를 `app-exchange` 로 바꿔 자기 WebView 에 쿠키를 받음 |
| 연동 콜백 | 구글 캘린더(`/api/google/callback`), 게시 채널 Meta·Threads·YouTube(`/api/marketing/publish/callback/{제공자}`), 광고 네이버·구글(`/api/marketing/ads/callback/{제공자}`): 모두 `APP_URL` 기준으로 돌아오고 **세션 쿠키로 누구인지 확인** → 같은 호스트여야 함 |
| 결제 | 나이스페이 결제창 → `/api/billing/nicepay/return`(브라우저 POST) → `APP_URL/admin/usage` 로 이동. 돌아올 주소는 결제 요청 때 보냄(콘솔 등록 아님 — 로컬 확인 필요) |
| 외부에서 들어오는 API | 하이링크 홈페이지 문의 → `{APP_URL}/api/integrations/inquiries`, 사이트 집계 비콘 `{APP_URL}/api/public/site-event`, 공개 매출 API(openapi), ICS 캘린더 구독 주소 |
| 메일·알림 링크 | `APP_URL` 로 절대 주소를 만듦(12개 모듈) — 알림 링크는 상대 경로를 서비스 워커/앱이 자기 호스트로 염 |
| 웹 푸시 | VAPID(`web-push`). 구독은 브라우저가 **출처(origin)마다** 따로 만들고 서버 `push_subscriptions` 에 endpoint 로 저장 → 호스트가 바뀌면 옛 구독은 못 쓰고 새 호스트에서 다시 구독해야 함. 앱 푸시(FCM/APNs 토큰)는 호스트와 무관 |
| 앱(Capacitor) | `server.url` = `APP_URL`(기본값을 이번에 www 로 고침), `allowNavigation` = [앱 주소 호스트, `work-in.dev`, `www.work-in.dev`] — 목록에 없는 호스트로 가면 **앱 밖 브라우저가 열림**. UA 에 `WorkInApp` |
| 앱 링크 | Android `assetlinks.json`(`ANDROID_CERT_SHA256`)·iOS `apple-app-site-association`(`APPLE_TEAM_ID`, `/tasks/*`·`/calendar*`·`/notifications*`)을 서버가 `/.well-known/` 에서 줌 — 호스트마다 그 호스트에서 받음. AndroidManifest 의 intent-filter 호스트는 빌드 때 `${appHost}` 로 들어감(네이티브·로컬) |
| 환경 변수 | `NEXT_PUBLIC_SITE_URL`(홍보 사이트 절대 주소, 기본 www) · `APP_URL`(CRM 절대 주소 — 콜백·메일·ICS·공개 API) |

## 2. 목표

- `www.work-in.dev` = 홍보 사이트: 로그인 없음, 검색 색인, 광고 랜딩, 가입 시작.
- `app.work-in.dev`(이름은 예시, `crm.` 도 가능) = CRM: 로그인 화면·업무·영업·마케팅·앱이 여는 주소·알림·메일 링크.
- 데이터·계정·API 는 하나. 배포도 하나.

## 3. A안 — `app.work-in.dev` 분리(권장)

### 3-1. 구조
- Vercel 프로젝트에 `app.work-in.dev` 도메인 추가(DNS CNAME). 같은 배포가 두 호스트를 받는다.
- `src/middleware.ts` 에 호스트 분기(환경 변수 `APP_HOST_SPLIT=1` 로 켜기 전엔 지금과 같음):
  - 호스트가 **www**: 공개 화면(§1 홍보 화면 + `/.well-known/*`, `/api/*`, 정적 파일)만 그대로. 그 밖의 앱 화면 주소는 `https://app.work-in.dev{같은 경로}` 로 308. 단 **앱(WebView, UA `WorkInApp`)이 오면 전환 유예 기간엔 308 하지 않고 그대로**(옛 앱 빌드 보호, §3-5).
  - 호스트가 **app.**: `/` 는 로그인 전엔 `/login`, 뒤엔 홈. 홍보 화면(`/welcome`, `/landing/*`, `/privacy`, `/terms`)은 www 로 308. `X-Robots-Tag: noindex` 헤더 + robots 전체 Disallow.
  - `/api/*` 는 **두 호스트 모두 응답**(308 없음) → 외부 콘솔·하이링크 문의 연동·비콘·ICS 가 www 주소를 그대로 써도 깨지지 않는다.
- 홍보 화면의 [로그인]·[무료로 시작] 링크는 `APP_URL` 로 절대 주소(가입 흐름은 app. 에서).
- 환경 변수: `NEXT_PUBLIC_SITE_URL=https://www.work-in.dev`(그대로) · `APP_URL=https://app.work-in.dev`(바꿈) · `APP_HOST_SPLIT=1`(새로, 켜는 스위치).

### 3-2. 쿠키
- 호스트 전용 쿠키라 www·app. 이 자연스럽게 분리된다(www 엔 로그인 자체가 없음). `domain=.work-in.dev` 로 넓히지 **않는다**(홍보 사이트 쪽 스크립트·광고 태그와 세션을 섞지 않기 위해).
- 전환 때 www 에 있던 세션(30일 유지 포함)은 app. 으로 안 넘어간다 → **전원 1회 재로그인**. 피하려면: 전환 뒤 www 의 앱 경로 308 전에 `/auth/handoff` 를 거쳐 1회용 표(10분, 1회)를 app. 에 넘겨 같은 세션을 다시 심는다(앱 소셜 로그인 복귀 `app-exchange` 와 같은 틀, 0.5일). 2단계 인증(MFA) 세션은 제외.
- 출처 검사는 `APP_URL` 호스트가 app. 이 되므로 그대로 통과. 플랫폼 지원 모드 쿠키(`SUPPORT_COOKIE`)도 호스트 전용 → app. 에서 다시 켬.

### 3-3. OAuth 콜백(외부 콘솔)
| 콘솔 | 지금 등록된 콜백(www) | 할 일 | 누가 |
|---|---|---|---|
| 구글 로그인(GCP "WorkIn Login") | `https://www.work-in.dev/api/auth/oauth/google/callback` | `https://app.work-in.dev/…/google/callback` **추가**(www 는 남김) | 로컬(대표 콘솔) |
| 네이버 로그인 | 같은 꼴 | app. 추가 — 네이버는 앱 '검수 요청' 전이면 그냥 추가 | 로컬 |
| 카카오 로그인 | 같은 꼴 | app. 추가 | 로컬 |
| 구글 캘린더(`FEATURE_GOOGLE_SYNC`) | `…/api/google/callback` | app. 추가 | 로컬 |
| Meta(페이스북·인스타) + Threads | `…/api/marketing/publish/callback/meta`·`/threads`, 데이터 삭제 콜백 | '유효한 OAuth 리디렉션 URI' 에 app. 추가 — 앱 검수 중이면 URI 추가는 재심사 대상이 아닌 것으로 알고 있음(**확인 못함**) | 로컬(김소담 부사장 계정) |
| YouTube(GCP) | `…/api/marketing/publish/callback/youtube` | app. 추가(검증 제출 전) | 로컬 |
| 네이버·구글 광고 | `…/api/marketing/ads/callback/{제공자}` | app. 추가 | 로컬 |
| 나이스페이 | 돌아올 주소는 요청 때 보냄 | 콘솔 변경 없음(**로컬 확인**: 허용 도메인 등록 여부) | 로컬 |

- 콘솔에 **추가**만 하고 www 는 지우지 않는다 → 되돌리기(롤백)가 env 하나로 된다.
- 코드 쪽: 콜백 주소는 전부 `APP_URL` 에서 만들므로 env 만 바꾸면 된다. 소셜 로그인의 state 쿠키는 시작·콜백이 모두 app. 이라 문제 없음. 연동 콜백은 세션 쿠키로 사람을 찾는데 app. 에서 시작하고 app. 으로 돌아오므로 그대로.

### 3-4. 웹 푸시
- 출처가 바뀌면 PC 크롬·안드로이드 크롬·iPhone 홈 화면 웹앱의 **웹 푸시 구독이 모두 끊긴다**(브라우저 규칙, 피할 수 없음).
- 할 일(클라우드 0.5일): app. 첫 접속 때 `Notification.permission === 'granted'` 이고 이 출처의 구독이 없으면 **자동으로 다시 구독**하고 서버에 등록(안내 1줄). 권한이 없던 사람은 지금처럼 설정 › 알림에서 켬. www 구독 행은 보낼 때 410/404 가 오면 서버가 지운다(이미 그렇게 동작).
- 앱 푸시(FCM/APNs)·알림 버튼·전체화면 알람은 호스트와 무관 → 영향 없음.

### 3-5. 앱(Capacitor)
- 새 빌드(1.1.4): `APP_URL=https://app.work-in.dev` 로 빌드 → `server.url` 이 app., `allowNavigation` 에 `app.work-in.dev`·`www.work-in.dev`·`work-in.dev` 셋 다. AndroidManifest intent-filter 호스트(`${appHost}`)·iOS Associated Domains(`applinks:app.work-in.dev`)·안드로이드 네이티브 기본 서버 상수 3곳(`WorkinAlarms`·`NotificationActionReceiver`·`TodayWidget` 의 `DEFAULT_SERVER`, 지금 apex) → **로컬·네이티브**.
- **순서가 중요**: 설치된 1.1.3 앱은 www 를 열고 `allowNavigation` 에 app. 이 없다. www 의 앱 경로를 app. 으로 308 하면 옛 앱은 app. 을 **앱 밖 브라우저**로 열어 버린다. 그래서 (1) 새 앱 빌드 배포 → (2) 2주쯤 www 는 앱 UA 에 한해 308 없이 그대로 서비스 → (3) 그 뒤 예외 해제. 서버 코드는 (2)를 `APP_HOST_SPLIT_APP_GRACE_UNTIL=YYYY-MM-DD` 같은 날짜 env 로 둔다.
- 앱 링크: `assetlinks.json`·`apple-app-site-association` 은 같은 배포라 app. 에서도 바로 나온다. 알림·메일의 `https://app.work-in.dev/tasks/…` 링크가 앱으로 열리려면 새 빌드의 intent-filter·Associated Domains 에 app. 이 있어야 한다. 위젯·딥링크(`workos://…`)는 호스트와 무관.
- 스토어 등록 정보(개인정보처리방침·계정 삭제 주소)는 www 그대로.

### 3-6. 검색·광고
- www 만 색인(지금과 같음). app. 은 robots 전체 Disallow + `X-Robots-Tag: noindex, nofollow` → 서치콘솔 속성·사이트맵·광고 최종 주소 전부 그대로(www).
- 광고 전환(가입 완료) 태그는 가입 흐름이 app. 으로 가므로, 가입 완료 화면의 전환 이벤트가 app. 에서 발화해도 같은 GA4/네이버/Meta 픽셀 ID 를 쓰면 된다(교차 도메인 연결 설정: GA4 'cross-domain' 에 두 호스트 — 로컬·마케팅).

### 3-7. 코드 변경 목록(클라우드)
| 파일 | 내용 |
|---|---|
| `src/middleware.ts` | 호스트 분기(§3-1), 앱 UA 유예, matcher 를 전체 경로로 |
| `src/app/robots.ts`·앱 레이아웃 | app. 에서 Disallow 전부 + noindex 헤더(`next.config` headers 에 host 조건은 없으므로 middleware 에서 헤더) |
| `src/lib/landingPages.ts`·홍보 화면 | [로그인]·[무료로 시작]·앱 다운로드 링크를 `APP_URL` 절대 주소로 |
| `src/components/native.ts`·`AppShell` | app. 첫 접속 자동 재구독(§3-4) |
| `src/lib/mail.ts` 등 | 변경 없음(`APP_URL` 사용) |
| 시험 | E2E '소개 사이트'(www 호스트 흉내: `Host` 헤더), API 미들웨어 분기 시험(www→app 308, app→www 308, /api 양쪽 200, 앱 UA 유예), 푸시 재구독 단위 시험 |
| 문서 | LOCAL_LOG 전환 체크리스트, 환경 변수 이름 |

### 3-8. 전환 순서(체크리스트)
1. 클라우드: 코드 배포(스위치 꺼짐 — 동작 변화 없음) — 1.5~2일.
2. 로컬/대표: Vercel 도메인 `app.work-in.dev` 추가 + DNS → app. 에서 화면 열림 확인(스위치 꺼진 상태라 www 와 똑같이 동작).
3. 로컬: 콘솔 7곳 콜백에 app. 추가(§3-3) — 1일.
4. 로컬: 앱 1.1.4 빌드(§3-5) → 내부 테스트 → 스토어 배포.
5. 로컬: 운영 env `APP_URL=https://app.work-in.dev` → 재배포 → 메일·알림·콜백이 app. 으로. 소셜 로그인·캘린더·Meta 연결 1회씩 확인.
6. 로컬: `APP_HOST_SPLIT=1` 켬(앱 UA 유예 날짜 함께) → www 앱 경로 308 → 직원 공지(재로그인 1회, 웹 푸시는 자동 재구독).
7. 2주 뒤 유예 해제. 문제가 나면 env 두 개를 되돌리면 전부 원상(콘솔 www 콜백은 남겨 두었으므로).

### 3-9. 위험·완화
| 위험 | 완화 |
|---|---|
| 전원 재로그인 | 공지 + (선택) 1회용 표 이어 로그인 |
| 웹 푸시 끊김 | 자동 재구독 |
| 콘솔 누락 → 소셜 로그인·연동 실패 | 콘솔에 www 콜백을 남겨 두고 env 롤백 가능 |
| 옛 앱이 app. 을 앱 밖 브라우저로 염 | 앱 UA 유예 2주 + 새 빌드 먼저 |
| 하이링크 문의 연동·비콘 주소 | `/api` 는 www 에서도 계속 응답 |
| 서치콘솔·광고 | www 그대로, app. noindex |

## 4. B안 — `/app` 접두어(비권장)

- 장점: 호스트 하나 → 쿠키·소셜 로그인·연동 콜백·웹 푸시·앱 링크·DNS·콘솔 변경이 **없다**.
- 단점: Next.js 는 폴더가 주소라서 화면 폴더 전부(`src/app/tasks`, `calendar`, `s/...`, `admin`, `settings` …)를 `src/app/app/` 아래로 옮기거나, 미들웨어 rewrite 로 `/app/*` → `/*` 를 흉내 내야 한다. 흉내 내도 **링크를 만드는 쪽**(화면 안 `href`, 알림 `link`, 메일 링크, 위젯 links, 딥링크 `workos://app/...`→경로, E2E 수백 줄)이 전부 `/app` 을 붙여야 해서 결국 같은 양이다. 북마크·공유된 주소는 308 표로 받쳐야 한다.
- 작업량 3~5일, 회귀 위험 큼. "주소가 달라 보인다"는 효과는 A안이 더 분명하다.

## 5. C안 — 지금처럼(경로로 구분) + 다듬기

- 이미 www 는 로그인 전 `/` 가 소개 화면, 공개 화면만 색인, 앱 화면은 Disallow. 바꿀 것이 거의 없다.
- 다듬기(0.5일): 소개 화면 머리줄에서 앱 머리줄 요소를 완전히 빼고, 로그인 뒤 홈에서 소개 화면으로 돌아가는 링크를 푸터에만 둔다.
- 대표가 "주소가 눈에 띄게 달라야 한다"고 보면 A안으로.

## 6. 결정 ①(주 주소 www) 코드 점검 결과 — 158차 다음 커밋에 반영

| 위치 | 전 | 후 |
|---|---|---|
| `src/lib/mktSites.ts` 비콘 주소 기본값 | apex | www |
| `src/app/api/public/revenue/openapi.json/route.ts` 서버 주소 기본값 | apex | www |
| `src/lib/ai/companyDraft.ts` 가져오기 UA | apex | www |
| `src/lib/deepLink.ts` 주석 | apex | www(호스트는 버리고 경로만 씀 — 두 호스트 다 동작) |
| `mobile/capacitor.config.ts` 앱 주소 기본값 | apex(10/20 결정) | www(`APP_URL` 로 바꿀 수 있음, allowNavigation 두 호스트 유지) |
| 로컬(네이티브) `mobile/android/.../WorkinAlarms.java`·`NotificationActionReceiver.java`·`TodayWidget.java` `DEFAULT_SERVER` | apex | **로컬 요청**: www 로(다음 앱 빌드) |
| `NEXT_PUBLIC_SITE_URL`·canonical·OG·sitemap·robots | www(#627) | 그대로 |
| 시험 `tests/api/app-113.test.mjs` 딥링크 apex 주소 | 경로만 쓰는지 확인하는 시험이라 그대로 | - |

## 7. 확인 못함
- Meta 앱 검수 중 '유효한 OAuth 리디렉션 URI' 추가가 재심사 없이 되는지.
- 나이스페이에 돌아올 주소 도메인 등록이 있는지.
- 카카오·네이버 로그인 앱의 서비스 URL 칸에 app. 추가가 필요한지(네이버는 '서비스 URL'·'Callback URL' 둘 다 있음).
- GA4·광고 픽셀의 교차 도메인 설정(마케팅 쪽).

## 8. 198차 구현(결정 15-29 A안 · #664·#683) — 스위치 꺼진 채 배포

대표 10/26 14:20 결정 15-29(A안), 16:40 #683 "이해 — 진행". 재로그인 1회는 받아들이는 것으로 보고(새벽 전환) 세션 이어 주기(§3-2 1회용 표)는 만들지 않았다.

| 무엇 | 어디 | 켜기 전(지금) | 켠 뒤(`APP_HOST_SPLIT=1`) |
|---|---|---|---|
| 호스트 갈림 | `src/lib/hostSplit.ts` · `src/middleware.ts`(모든 화면 주소, API·Next 정적 파일 제외) | 지금과 똑같음 | www = `/`(로그인했어도 소개)·`/welcome`·`/landing/*`·`/privacy`·`/terms`·`/account-deletion`·`/data-deletion`·`/ai-notice`·API·정적 파일만 그대로, 그 밖(로그인·가입·초대·업무·영업·서명 …)은 app. 으로 **308**(경로·검색어 그대로) |
| 옛 앱 유예 | `APP_HOST_SPLIT_APP_GRACE_UNTIL=YYYY-MM-DD`(서울 날짜, 그날 포함) | — | 그날까지 앱(WebView, `WorkInApp`·`; wv)`)은 www 에서 그대로. 지나면 앱도 app. 으로(첫 화면 포함) |
| app. 의 소개 화면 | 미들웨어 | — | `/welcome`·`/landing/*`·약관 → www 308 · `/` 는 로그인 전이면 `/login`(307) |
| 검색 제외 | 미들웨어 | — | app. 모든 화면 `X-Robots-Tag: noindex, nofollow` · app. `robots.txt` = `Disallow: /`(www robots 는 그대로) |
| API | — | 두 호스트 모두 응답 | 그대로(하이링크 문의 연동·사이트 집계 비콘·ICS·콘솔 콜백이 www 주소를 써도 깨지지 않음) |
| 브라우저 알림 다시 켜기 | `src/components/PushRehome.tsx` · `GET /api/push/subscribe`(받는 중인 구독 수) | 안 뜸 | app. 에서, 다른 곳에서 웹 푸시를 받던 사람이고 이 브라우저는 아직 묻지 않았으면 한 줄 안내 [알림 켜기]·[나중에]. 브라우저 알림 허용은 주소마다 따로라 **자동으로는 못 켬**(§3-4 의 '권한 그대로 자동 재구독'은 불가 — 고침) |
| 앱 허용 주소 | `mobile/capacitor.config.ts` `allowNavigation` | `app.work-in.dev` 추가(다음 빌드부터) | 1.1.4 빌드는 `APP_URL=https://app.work-in.dev` 로 |
| 소셜 로그인 시작 | `src/app/api/auth/oauth/[provider]/start` | 그대로 | www 에서 시작하면 app. 의 같은 시작 주소로 307 — 상태 쿠키(시작 호스트 전용)와 콜백(APP_URL = app.)이 같은 호스트가 되게(유예 중 옛 앱의 시스템 브라우저 로그인 포함) |

시험: `tests/api/host-split.test.mjs`(스위치 켬·유예 앞/끝·꺼짐 3가지 서버) · E2E 로그인·초대 가입·소개 사이트·전자계약 서명·가입 전환 태그(꺼진 상태 그대로).

## 9. 새벽 전환 절차서(로컬·대표) — 순서대로, 각 단계 확인 뒤 다음

준비(낮에, 서비스 영향 없음)
1. **Vercel 도메인**: 프로젝트 `dagym-workspace` › Domains 에 `app.work-in.dev` 추가 → DNS(가비아 등) CNAME `app` → Vercel 이 알려 주는 값. 확인: `curl -sI https://app.work-in.dev/api/health` 200(스위치 꺼짐이라 www 와 똑같이 동작).
2. **외부 콘솔 콜백에 app. 추가**(www 는 지우지 않음 — 되돌리기용):
   - 구글 로그인(GCP OAuth 클라이언트) `https://app.work-in.dev/api/auth/oauth/google/callback`
   - 카카오 로그인 `…/api/auth/oauth/kakao/callback` (+ 사이트 도메인 칸에 app.)
   - 네이버 로그인 `…/api/auth/oauth/naver/callback` (+ 서비스 URL 칸)
   - 구글 캘린더(켠 경우) `…/api/google/callback`
   - Meta·Threads 게시 `…/api/marketing/publish/callback/meta`·`/threads` · 데이터 삭제 콜백
   - YouTube `…/api/marketing/publish/callback/youtube`
   - 네이버·구글 광고 `…/api/marketing/ads/callback/naver`·`/google`
   - 나이스페이: 돌아올 주소는 결제 요청 때 보냄 — 콘솔 허용 도메인 칸이 있으면 app. 추가(확인 못함)
   - GA4·광고 픽셀: 교차 도메인에 두 호스트(마케팅)
3. **앱 1.1.4**(네이티브·로컬): `APP_URL=https://app.work-in.dev` 로 빌드(server.url = app., allowNavigation 은 이미 app. 포함) · AndroidManifest intent-filter 호스트 `${appHost}` · iOS Associated Domains `applinks:app.work-in.dev` · 안드로이드 `DEFAULT_SERVER` 3곳(WorkinAlarms·NotificationActionReceiver·TodayWidget) → `https://app.work-in.dev` → 내부 테스트 → 스토어 배포. **스토어에 올라간 뒤**에 아래 전환.

새벽 전환(02~05시)
4. Vercel 환경 변수(Production):
   - `APP_URL` = `https://app.work-in.dev`
   - `APP_HOST_SPLIT` = `1`
   - `APP_HOST_SPLIT_APP_GRACE_UNTIL` = 전환일 + 14일(예: `2026-11-12`)
   - `NEXT_PUBLIC_SITE_URL` 은 `https://www.work-in.dev` 그대로
   → **다시 배포(Redeploy)**(환경 변수는 새 배포부터 적용).
5. 확인(누구나, 로그인 없이):
   - `curl -sI https://www.work-in.dev/tasks` → `308` · `location: https://app.work-in.dev/tasks`
   - `curl -sI https://www.work-in.dev/` → `200`(소개)
   - `curl -sI https://app.work-in.dev/welcome` → `308` → www
   - `curl -s https://app.work-in.dev/robots.txt` → `Disallow: /`
   - `curl -sI https://app.work-in.dev/login` → `x-robots-tag: noindex, nofollow`
   - `curl -s https://www.work-in.dev/api/health` → 200(API 는 그대로)
6. 확인(로그인): app. 에서 이메일 로그인 → 홈 · 구글/카카오/네이버 로그인 1회씩 · 알림 메일 링크가 app. 인지 · 웹에서 브라우저 알림 [알림 켜기] 안내가 뜨는지(웹 푸시를 쓰던 계정) · 하이링크 홈페이지 문의 1건이 업무로 오는지(www API 그대로).
7. 직원 공지: "주소가 app.work-in.dev 로 바뀝니다. 한 번 다시 로그인해 주세요. PC 브라우저 알림은 화면 위 [알림 켜기]를 한 번 눌러 주세요. 휴대폰 앱은 업데이트(1.1.4)만 하면 됩니다."
8. 14일 뒤: 유예가 자동으로 끝남(날짜 env). 옛 앱(1.1.3)은 그 뒤 앱 화면을 앱 밖 브라우저로 열 수 있으니 업데이트 안내.
   - 유예 중 옛 앱(www)에서 할 수 없는 것: 앱 안에서 구글 캘린더·Meta·광고 계정 **연결하기**(연결 콜백이 app. 으로 와서 www 로그인 쿠키를 못 읽음) — 관리자 연결 작업은 PC(app.)에서. 소셜 로그인은 위 307 로 됨.

되돌리기(문제가 생기면 언제든)
- `APP_HOST_SPLIT` 를 지우거나 `0` → 다시 배포 → 갈림이 꺼져 www 가 예전처럼 전부 서비스. `APP_URL` 도 `https://www.work-in.dev` 로 되돌리면 메일·콜백이 www 로(콘솔에 www 콜백을 남겨 두었으므로 그대로 동작). app. 에서 새로 로그인한 쿠키는 app. 전용이라 www 에서는 다시 로그인.
