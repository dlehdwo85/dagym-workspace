# 광고 매체 공식 API — 광고 "만들기·수정" 가능 범위 조사 (워크인 AI 광고 비서용)

- 확인일: 2026-10-19 (각 매체의 공개 문서를 이날 기준으로 확인)
- 범위: 리포트 조회가 아니라 **캠페인·광고그룹·키워드·소재·입찰가·예산·ON/OFF를 만들고 고치는 API**
- 전제: 고객 본인 광고계정에 연결하고, 돈이 드는 변경은 **고객이 하나하나 승인**한 뒤 실행
- 표기: "확인 필요" = 공식 문서로 확인하지 못한 항목. 추정으로 채우지 않았다.

## 1. 요약표

| 매체 | 공식 API | 만들기/수정 범위 | 일시중지 상태로 생성 | 승인 요건 | 비용 | 출처 | 확인 필요 |
|---|---|---|---|---|---|---|---|
| 네이버 검색광고 (SA) | 있음 (`api.searchad.naver.com`, REST + HMAC 서명) | 캠페인 생성 `campaignTp` 값: `WEB_SITE`(파워링크)·`SHOPPING`·`POWER_CONTENTS`·`BRAND_SEARCH`·`PLACE`. 광고그룹(`LOCAL_AD`=플레이스 검색 등)·키워드·소재(`TEXT_45`, `RSA_AD`, `PLACE_AD`, `ADVOOST_PLACE_AD` 등)·입찰가(`bidAmt`)·일예산(`dailyBudget`)·ON/OFF(`userLock`)·비즈채널(사이트·플레이스·콘텐츠) 생성과 검수 요청 | 가능. 캠페인·그룹·소재 모두 `userLock=true`로 생성하면 노출 중지 상태 | 광고주센터 → 도구 → API 사용관리에서 라이선스(액세스 라이선스·비밀키) 발급. 공식 문서에는 심사 절차 언급이 없음 | 공식 문서에 요금 언급 없음 | [API 문서](https://naver.github.io/searchad-apidoc/), [swagger(ncc)](https://naver.github.io/searchad-apidoc/assets/json/ncc-heroes-ncc.json), [README](https://github.com/naver/searchad-apidoc), [FAQ](https://github.com/naver/searchad-apidoc/wiki/FAQ) | 무료 여부. 브랜드검색은 계약을 조회만 할 수 있어서 API만으로 집행할 수 있는지. 플레이스·파워콘텐츠의 실제 생성 시험(실계정) |
| Google Ads | 있음 (Google Ads API, gRPC/REST) | 캠페인·예산·광고그룹·키워드·반응형 검색광고(RSA)·Performance Max 생성/수정(mutate) | 가능 (`status=PAUSED`) | 2026-09-09부터 **개발자 토큰이 폐지**되고 접근 등급은 **Google Cloud 프로젝트 기준**. Test(테스트 계정만) → Explorer(운영 계정은 하루 2,880건) → Basic(하루 15,000건, 브랜드 인증 필요) → Standard(무제한, 수동 심사) | 무료. Standard 의 RMF 심사에서 위반이 나오면 수수료가 붙을 수 있음 | [접근 등급](https://developers.google.com/google-ads/api/docs/api-policy/access-levels), [개발자 토큰 폐지](https://developers.google.com/google-ads/api/docs/api-policy/developer-token), [운영 준비](https://developers.google.com/google-ads/api/docs/productionize/access-levels), [PMax](https://developers.google.com/google-ads/api/performance-max/overview) | 우리 403의 정확한 오류 코드 |
| Meta (페이스북·인스타그램) | 있음 (Marketing API) | 캠페인·광고세트·광고·소재·예산·입찰·상태 | 가능. 생성할 때 `status`는 `ACTIVE`와 `PAUSED`만 허용 | 남의 광고계정을 관리하려면 `ads_management` **Advanced(=Full) Access** 필요 → 앱 심사(App Review) + 비즈니스 인증. Full 등급은 최근 15일 성공 호출 500건 이상, 최근 500건 오류율 15% 미만 | 공식 문서에 요금 언급 없음 | [권한](https://developers.facebook.com/docs/marketing-api/get-started/authorization), [캠페인 레퍼런스](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group), [호출 한도](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting) | 무료 여부. 심사 기간 |
| 카카오모먼트 | 있음 (권한이 있는 비즈앱만 사용 가능) | 일부 캠페인 유형·목표(비즈보드·디스플레이 전환/방문, 동영상 조회, 채널 도달 등), 디스플레이·메시지 광고그룹, 일부 디스플레이 소재 생성·수정·삭제. **계약형 상품(비즈보드 CPT, 포커스 보드 등)은 API 지원 안 함** | 확인 필요 | 카카오디벨로퍼스 앱 → 비즈앱 전환(대행사·광고주 정보 입력) → 앱 소유자 본인인증 → 카카오모먼트 API 사용 권한 신청 → 카카오 심사 | 공식 문서에 API 요금 언급 없음 | [카카오모먼트 API 공통](https://developers.kakao.com/docs/ko/kakaomoment/common), [DevTalk 계약형 미지원](https://devtalk.kakao.com/t/x-api/139627), [DevTalk 권한](https://devtalk.kakao.com/t/api/125853) | **외부 SaaS가 여러 고객 계정을 대신 관리할 수 있는지**(공식대행사로만 제한되는지) |
| 당근 비즈니스 | **공개 API를 찾지 못함** | — | — | — | — | [당근 DSP 기술블로그(내부 API)](https://about.daangn.com/blog/archive/%EB%8B%B9%EA%B7%BC-%EA%B4%91%EA%B3%A0-%EA%B0%9C%EB%B0%9C%EC%9E%90-dsp/) | 비공개 파트너 API가 있는지 → 당근에 직접 문의 |
| TikTok | 있음 (TikTok API for Business / Marketing API) | 캠페인·광고그룹·광고·오디언스·소재를 만들고 관리 | 확인 필요 | Business API 포털에서 개발자 등록 → 앱 생성 → 광고주 OAuth 인가 | 확인 필요 | [TikTok 도움말](https://ads.tiktok.com/help/article/marketing-api?lang=en), [포털](https://business-api.tiktok.com/portal/docs) | 앱 심사 절차·기간, 상태 필드, 비용 |
| 네이버 스마트플레이스 (업체정보·소식) | **공식 쓰기 API를 찾지 못함** | — | — | — | — | (공식 문서 없음) | 비공개·제휴 API가 있는지 |
| 네이버 GFA (성과형 디스플레이) | **공개된 집행 API 문서를 찾지 못함** | — | — | — | — | (공식 문서 없음. 2025-09 검색광고센터와 통합된 뒤 대용량 리포트 일부만 검색광고 API로 옮겨졌다는 제3자 글이 있음) | 집행 API가 있는지 → 네이버에 문의 |

## 2. 매체별 메모

### 2-1. 네이버 검색광고 API
- 캠페인 생성 `POST /ncc/campaigns` 의 `campaignTp` 허용 값은 `WEB_SITE`, `SHOPPING`, `POWER_CONTENTS`, `BRAND_SEARCH`, `PLACE` 다섯 개(swagger `CampaignRequest` enum)이다. 문서상으로는 **플레이스와 파워콘텐츠도 생성 가능**하고, 읽기 전용으로 표시된 유형은 없다. [swagger](https://naver.github.io/searchad-apidoc/assets/json/ncc-heroes-ncc.json)
- **플레이스**: 광고그룹 유형 `LOCAL_AD`(플레이스 검색)를 `POST /ncc/adgroups` 로 만든다. 이 그룹은 플레이스 캠페인 안에서만 쓸 수 있고 플레이스 비즈채널만 연결된다(2021-06-21 릴리스 노트). 집행 가능한 채널은 `GET /ncc/purchasable-place-channels` 로 조회한다. 2026-09-16 릴리스부터 `useAdvoost=true` 로 설정하면 스마트플레이스 정보 기반 소재(`ADVOOST_PLACE_AD`)가 자동으로 생성된다(업체 이미지 1장 이상 필요, 병의원 업종 제외). 플레이스·브랜드검색 캠페인에서는 공유예산을 쓸 수 없다. [2021-06-21](http://naver.github.io/searchad-apidoc/release/2021/06/21/release-note/), [2026-09-16](http://naver.github.io/searchad-apidoc/release/2026/09/16/release-note/), [2023-04-26](http://naver.github.io/searchad-apidoc/release/2023/04/26/release-note/)
- **파워콘텐츠**: `POWER_CONTENTS` 캠페인 + `INFORMATION` 그룹 + `CONTENTS` 비즈채널(블로그·포스트 URL) + `CONTENTS_AD_INFORMATION` 소재 조합이다. 비즈채널은 `POST /ncc/channels` 로 만들고 `PUT /ncc/channels/{id}/inspect` 로 검수를 요청한다. [2017-02-01 노트](http://naver.github.io/searchad-apidoc/release/2017/02/01/release-note/), [FAQ](https://github.com/naver/searchad-apidoc/wiki/FAQ)
- **파워링크**: 캠페인(`dailyBudget`, `useDailyBudget`, `deliveryMethod`) → 그룹(`bidAmt` 70~100,000원, 그룹 일예산) → 키워드(`POST /ncc/keywords`, 키워드별 입찰가) → 소재 `TEXT_45`/`RSA_AD` → 제외검색어(`restricted-keywords`, 파워링크 그룹 전용) 순서로 만든다. 확장소재 일부(파워링크 이미지 등)는 API로 만들 수 없다고 문서에 적혀 있다.
- **ON/OFF**: 캠페인·그룹·키워드·소재 모두 `userLock`(true=중지)이 있다. **먼저 OFF 상태로 만들고, 고객 승인을 받은 뒤 `userLock=false` 로 바꾸는 흐름**이 가능하다.
- **브랜드검색**: 계약(`brand-new/contracts`, `time-contracts`)은 조회(GET) API만 있다. API만으로 구매·집행까지 할 수 있는지는 확인 필요.
- **호출 한도**: 총량 제한은 없다. 광고주(Customer ID)별 초 단위 속도 제한이 시스템 부하에 따라 바뀌며 수치는 공개하지 않는다. 한도를 넘으면 HTTP 429가 오므로 잠시 후 재시도한다. 권한을 위임받은 계정의 라이선스 하나로 여러 광고주를 관리할 수 있다. [FAQ](https://github.com/naver/searchad-apidoc/wiki/FAQ)

### 2-2. Google Ads API
- **2026-09-09 개발자 토큰 폐지**: 접근 등급은 이제 OAuth 클라이언트(또는 서비스 계정)를 만든 **Cloud 프로젝트**에 붙는다. 헤더에 토큰을 보내도 무시된다. [개발자 토큰](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- **403 대응**: 운영 계정에서 `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` 이 나오면 → Cloud 콘솔의 Google Ads API 개요 페이지에서 Explorer 를 신청한다. Free Trial 이거나 결제가 정지된 프로젝트는 Explorer/Basic 신청이 거절될 수 있다. 2026-09-09 이후 등급을 올린 일부 프로젝트에서 `AUTHORIZATION_ERROR` 가 나는 알려진 문제가 있고, Google이 수정을 배포 중이다. 같은 문서.
- **등급별 차이**: Test(테스트 계정만, 하루 15,000건) / Explorer(운영 계정은 하루 2,880건, 계정 생성·사용자 관리·계획 도구·결제 서비스는 막힘) / Basic(하루 15,000건, 브랜드 인증 필요) / Standard(무제한, 수동 심사 약 10영업일). [접근 등급](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)
- **생성·수정 범위**: 캠페인·예산·광고그룹·키워드·RSA 생성/수정(mutate)을 지원하고, Performance Max 도 "생성·수정·리포트"를 지원한다고 공식 문서에 적혀 있다. [PMax](https://developers.google.com/google-ads/api/performance-max/overview)
- **비용**: 무료. [운영 준비](https://developers.google.com/google-ads/api/docs/productionize/access-levels)

### 2-3. Meta Marketing API
- 고객의 광고계정을 관리하려면 `ads_management` 권한의 **Advanced(=Full) Access** 가 필요하다. 이는 권한별 앱 심사로 승인받는다. 민감 데이터에 접근하거나 다른 비즈니스의 자산을 다루면 비즈니스 인증도 필요하다. 등급 이름이 바뀌어 Standard는 Limited, Advanced는 Full 이다. [권한](https://developers.facebook.com/docs/marketing-api/get-started/authorization)
- 캠페인 생성 시 `status` 는 `ACTIVE`/`PAUSED` 만 받는다. 공식 예제도 `PAUSED` 로 만든다. `special_ad_categories` 는 **필수**이고, 해당 없으면 `NONE` 이나 빈 배열을 보낸다. [캠페인](https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group)
- 호출 한도(광고계정·1시간 기준 `ads_management`): Limited 는 300 + 40×활성광고, Full 은 100,000 + 40×활성광고. 점수제로 읽기 1점·쓰기 3점이고, 최대 점수는 Limited 60 / Full 9,000. [호출 한도](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting)
- Full 승급 조건: 최근 15일 성공 호출 500건 이상, 최근 500건 오류율 15% 미만. 같은 문서.

### 2-4. 카카오모먼트
- "권한을 보유하고 비즈니스 인증을 도입한 카카오디벨로퍼스 앱에서만 사용"할 수 있고, 비즈니스 토큰이 필요하다. 신청 순서는 앱 생성 → 비즈앱 전환 → 본인인증 → 앱 권한 신청. [공통 문서](https://developers.kakao.com/docs/ko/kakaomoment/common)
- 비즈앱 정보에 대행사나 광고주 정보를 넣지 않으면 반려된다. 정보를 넣으면 권한이 부여된다(카카오 담당자 답변). [DevTalk 125853](https://devtalk.kakao.com/t/api/125853)
- 대행사 오픈API 앱의 멤버(팀 관리)로 등록된 광고주는 그 앱으로 호출할 수 있다. [DevTalk 125995](https://devtalk.kakao.com/t/api/125995)
- 비즈보드 CPT·포커스 보드·포커스 풀뷰·리치팝 올데이(도달)는 계약형이라 API로 지원하지 않는다. 캐러셀 메시지 소재는 API로 수정할 수 없다. [DevTalk 139627](https://devtalk.kakao.com/t/x-api/139627), [공통 문서](https://developers.kakao.com/docs/ko/kakaomoment/common)
- **확인 필요**: "공식대행사·사전 협의 광고주만 가능", "외부 플랫폼 직접 연동 미지원" 같은 문구는 제3자 정리글에서만 봤고 공식 원문은 찾지 못했다. → [에이전시 사이트](https://agency.ad.kakao.com)·[모먼트 공지](https://moment.kakao.com/noticeboard)나 카카오에 직접 문의한다.

### 2-5. 당근 비즈니스
- 공개 개발자 포털이나 광고 집행 API 문서를 찾지 못했다. 당근 기술블로그에 따르면 광고 DSP에 API가 150여 개 있지만 **내부 서비스**다. [기술블로그](https://about.daangn.com/blog/archive/%EB%8B%B9%EA%B7%BC-%EA%B4%91%EA%B3%A0-%EA%B0%9C%EB%B0%9C%EC%9E%90-dsp/)
- 결론: **공개 API 없음(2026-10-19 기준 찾지 못함)**. 비공개 파트너 제도가 있는지는 확인 필요. 그동안은 화면 안내(체크리스트)로만 지원한다.

### 2-6. TikTok
- Marketing API로 캠페인·광고그룹·광고를 "대량으로 생성·관리"할 수 있다(공식 도움말). Business API 포털에서 개발자로 등록하면 쓸 수 있다. [도움말](https://ads.tiktok.com/help/article/marketing-api?lang=en)
- 앱 심사 절차·기간, 상태 필드, 비용은 공식 원문으로 확인하지 못했다(확인 필요). 포털 문서가 스크립트로 렌더링돼 이번 조사에서 읽지 못했다.

### 2-7. 네이버 스마트플레이스 / GFA
- 스마트플레이스: 업체정보 수정이나 소식 등록용 공개 API 문서를 찾지 못했다(확인 필요). 검색광고 API에서 할 수 있는 일은 플레이스 **비즈채널 연결**과 플레이스 광고 집행뿐이다.
- GFA: 공개 집행 API 문서를 찾지 못했다(확인 필요). 검색광고 API 문서에도 GFA 집행 엔드포인트는 없다.

## 3. 구현 순서 제안

1. **네이버 SA 쓰기 (지금 바로)** — 파워링크부터, 그다음 플레이스
   - 흐름: 생성할 때는 항상 `userLock=true`(OFF) → 고객이 금액·키워드·입찰가를 확인하고 승인 → `userLock=false`. 예산·입찰가를 바꿀 때도 같은 승인 절차를 거친다.
   - 플레이스: 고객 스마트플레이스가 비즈채널로 등록돼 있어야 한다(`purchasable-place-channels` 로 확인). 실계정에서 `PLACE` 캠페인 + `LOCAL_AD` 그룹을 생성하는 시험이 필요하다(문서상 가능, 실증 전).
   - 파워콘텐츠는 2순위다. 콘텐츠 비즈채널 검수가 끼어 있어 자동화 효용이 낮다. 쇼핑과 브랜드검색은 보류한다(브랜드검색은 계약을 조회만 할 수 있음).
   - 429 대비: 광고주별로 요청을 직렬화하고 지수 백오프로 재시도한다.
2. **Google Ads (403 해결 후)**
   - 개발자 토큰은 이미 폐지됐다. OAuth 클라이언트를 만든 **Cloud 프로젝트**의 등급(Test → Explorer)을 콘솔에서 확인하고 신청하는 것이 먼저다. 결제가 활성화된 프로젝트여야 한다.
   - 고객이 늘면 브랜드 인증 → Basic, 규모가 커지면 Standard(수동 심사).
   - 생성은 `PAUSED` 로 하고, 승인 후 `ENABLED` 로 바꾼다. 검색(RSA)부터 시작하고 PMax 는 그다음.
3. **Meta (앱 심사 병행)**
   - 비즈니스 인증 → `ads_management` Advanced 심사(화면 녹화·사용 사례·개인정보처리방침 필요) 순서로 진행한다. 심사 전에는 우리 계정으로만 개발한다.
   - 생성할 때 `PAUSED` 와 `special_ad_categories=[]`, 승인 후 `ACTIVE`.
4. **카카오모먼트 (문의 먼저)** — 제3자 SaaS가 고객 계정을 대신 다룰 수 있는지 카카오에 서면으로 확인한 뒤 착수한다. 계약형 상품은 범위에서 뺀다.
5. **TikTok** — 국내 SMB 수요를 확인한 뒤 진행한다. 앱 심사 요건부터 확인한다.
6. **당근·스마트플레이스·GFA** — 공개 API가 없으므로 "고객이 직접 입력할 문구·설정 안내"까지만 지원한다. 화면 자동조작(스크래핑)은 약관 위반 위험이 있어 쓰지 않는다.

> 공통 원칙: 돈이 드는 변경(ON 전환·예산·입찰가)은 모두 "AI 제안 → 고객 승인 → API 실행 → 결과 기록" 순서로 처리한다. 가짜 서버로 통과한 시험을 실제 연동 완료로 보고하지 않는다.
