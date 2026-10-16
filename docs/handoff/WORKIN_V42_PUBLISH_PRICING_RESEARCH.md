# 워크인 V42 — 자동 게시 경로 · AI 제작 원가 · 마케팅 요금 조사

- 조사일: 2026-10-17 (로컬 세션, 웹 검색). 커밋하지 않은 조사 문서.
- 원칙: 공식 페이지 우선. 공식 확인이 안 된 것은 **"확인 필요"**로 표시함. 제3자 글은 "(제3자)"로 표시함.
- 환율은 **가정값 1달러 = 1,400원**(검증하지 않은 계산용 숫자)으로 계산함.

---

## 한눈에 보는 결론

| 주제 | 결론 |
|---|---|
| 네이버 블로그 | 공식 글쓰기 API는 **2020-05-06에 종료**됨. 지금 쓸 수 있는 공식 대체 수단은 **확인되지 않음**. 네이버 약관은 사전 허락 없이 자동화된 수단으로 로그인하거나 글을 올리는 것을 **금지**함. 그래서 "완전 자동 게시"는 약관 위반 위험이 큼. |
| 인스타·페이스북 | 직접 붙이려면 Meta 앱 심사(고급 액세스), 비즈니스 인증, 기술 제공업체 접근 인증까지 3단계를 거쳐야 함. 처음에는 **통합 게시 API(Zernio·Upload-Post·Ayrshare)**를 쓰는 편이 빠름. |
| 유튜브 | 업로드는 2026-06-01부터 **별도 할당량(하루 100회, 1회 1유닛)**으로 바뀜. "미감사 프로젝트는 비공개로 잠김" 규칙은 공식 문서끼리 서로 다르게 적혀 있어 **확인 필요**(실제 시험 필요). |
| Higgsfield | 소비자 요금제와 **별도인 API**(선불 Units)가 있음. 생성물의 소유권과 상업적 이용은 이용자에게 있고, 고객에게 넘겨주는 것도 허용됨. 다만 **서비스 자체를 재판매하는 것은 금지**됨. |
| 요금 초안 | 마케팅 공간 **39,000 / 79,000 / 149,000원(회사/월)**, 채널 추가 5,000원. AI 크레딧은 1크레딧 = 100원 기준으로 이미지 1~4크레딧, 영상(5초) 15~40크레딧. |

---

## 1. 네이버 블로그

### 1-1. 공식 API 상태

| 항목 | 내용 | 출처 |
|---|---|---|
| 개발자센터 글쓰기 API | 공지 「블로그 오픈 API 종료 안내」(게시 2020-04-06). 종료 대상은 **로그인 방식 블로그 오픈 API(글쓰기)**이고, 종료일은 **2020-05-06** | https://developers.naver.com/notice/article/7527 |
| 종료 이유 | 반복적·기계적으로 비슷한 광고성 글을 대량으로 올리는 문제 때문. API로 이미 올라간 글은 그대로 유지됨 | https://www.newsis.com/view/NISX20200413_0000992012 , https://www.newspim.com/news/view/20200413000737 |
| MetaWeblog / XML-RPC | 종료 공지에는 XML-RPC 언급이 없음. 현재 쓸 수 있다는 공식 안내도 **없음 → 확인 필요**(사실상 쓸 수 없다고 보는 것이 안전). 오픈소스 라이브러리는 "네이버 정책 변경으로 글 수정이 막혔다"고 적고 있음 | https://packagist.org/packages/lovizu/laravel-naver-blog-xmlrpc , https://github.com/yousung/naver-blog-xmlrpc |
| 커뮤니티 확인 | 2025-02 강사 답변: "네이버 블로그는 진작에 API 기능이 종료" (제3자) | https://www.inflearn.com/community/questions/1513877 |
| 네이버 클라우드 API HUB | 블로그 관련 기능은 **블로그 검색(읽기)**뿐이고, 글쓰기 기능은 확인되지 않음 | https://api.ncloud-docs.com/docs/en/naver-api-hub-search-blog , https://www.ncloud.com/product/applicationService/naverApiHub |
| 통합 게시 API의 네이버 지원 | Ayrshare 지원 목록에 네이버·카카오가 **없음**. Zernio·Upload-Post 목록에도 없음 | https://www.ayrshare.com/docs/help-center/product/what_social_networks_are_supported , https://www.upload-post.com/ |

### 1-2. 약관상 위험 (크롬 확장 · PC 앱 방식)

| 근거 | 내용(요약) | 출처 |
|---|---|---|
| 네이버 이용약관(시행 2026-10-01 판) 주의사항 | 네이버의 **사전 허락 없이** 자동화된 수단(매크로·봇 등)으로 **로그인하거나 게시물을 올리는 것을 금지**함. IP를 바꿔 가며 접속하는 것, 캡차를 우회하는 것도 금지 | https://policy.naver.com/rules/service.html |
| 같은 약관 | 자동화된 수단으로 올린 게시물은 **게재가 제한될 수 있음**. 계정 대여·양도·공유와 타인 계정 무단 사용도 금지 | https://policy.naver.com/rules/service.html |
| 게시물 운영정책 | 사전 허락 없이 자동화된 수단으로 올린 게시물은 **게재 제한 대상** | https://policy.naver.com/rules/service_group.html |
| 네이버 관계자(2025-03 보도) | "광고, 스팸성, 도배 혹은 매크로 등의 어뷰징 유형"에 해당하면 제재한다고 밝힘 | https://bizhankook.com/articles/29309.html |
| 구체적인 계정 정지 사례 | 공식 통계나 언론에 보도된 구체 사례는 **확인 필요**. 블로거 경험담만 있음 | — |

**쉬운 해석**
- **서버에서 고객 아이디로 로그인하는 방식**은 약관 위반이 명확함. 고객이 아이디를 넘겨주면 계정 공유에도 해당함. → **쓰지 않음**
- **고객 본인 브라우저에서 돌아가는 확장 프로그램이 편집기에 글을 채우기만 하고, 고객이 직접 [발행]을 누르는 방식**은 위험이 낮음. 다만 "자동화된 수단으로 게시"에 해당하는지는 약관 문구만으로 판단하기 어려움(**법률 검토 필요**).
- **확장 프로그램이 정해진 시간에 혼자 발행하는 방식**(예약·무인 발행)은 약관 문구에 직접 걸릴 가능성이 큼.

### 1-3. 국내 서비스는 네이버 발행을 어떻게 하나

| 서비스 | 방식 | 예약 발행 | 가격 | 출처 |
|---|---|---|---|---|
| 글웨이(GeulWay) | 고객이 켜 둔 Mac·Windows의 **글웨이 앱**이 로그인된 브라우저 편집기에 입력하고 발행함. 로그인 정보는 서버에 저장하지 않음 | Pro 요금제만 | 할인가 기준 Lite 월 29,500 / Plus 74,500 / Pro 199,500원 (정가 59,000 / 149,000 / 399,000원) | https://geulway.com/ |
| 가제트 AI | **크롬 확장**으로 제목·본문·이미지·해시태그 입력과 발행 준비를 자동화함("클릭 한 번") | 확인 필요 | 확인 필요 | https://gazet.ai/cs/notice/1174 (2026-07-11 공지) |
| 1004AI 네이버 블로그 도우미 | **크롬 확장**. 플랫폼에서 만든 글을 편집기에 넣고, 사용자가 확인한 뒤 발행 | 확인 필요 | 확인 필요 | https://chromewebstore.google.com/detail/immoejifpkndoibfpoabfiamobenblan (페이지 직접 열람 실패, 검색 요약 기준) |
| OPO 블로그 발행 도우미 | 크롬 확장. OPO에서 쓴 글을 네이버 편집기로 옮기고 예약 발행도 지원한다고 소개. 권한 검사에서 scripting 권한이 'Critical'로 표시됨 (제3자 분석) | 지원한다고 소개 | 확인 필요 | https://extensionauditor.com/scan/opo-jcliojahjgpgbpfllidfedgnpjpndnjg |
| SNS오피스(이카본) | 인스타·스레드·네이버 자동화를 내세움. 네이버 기능의 범위는 확인 필요 | 인스타·스레드 지원 | $14.99 / Pro $29.99 | https://sns-office.com/blog/threads-marketing-tools-comparison-2026 |
| 크몽 개별 제작 도구(N-Flow 등) | 확장이나 설치형 프로그램. 일부는 프록시 IP 변경 기능까지 있어 약관과 충돌함 | 일부 | 10만~60만 원대(보도) | https://kmong.com/gig/797234 , https://www.i-boss.co.kr/ab-2987-525818 |

→ **공통점**: 공식 API가 없기 때문에 모든 서비스가 **고객 PC의 로그인된 브라우저**를 이용함. 네이버의 승인을 받았다고 밝힌 곳은 없음.

---

## 2. Meta(인스타그램 · 페이스북) 게시

### 2-1. 직접 개발할 때 필요한 것

| 항목 | 내용 | 출처 |
|---|---|---|
| 인스타 권한 (Instagram 로그인 방식) | `instagram_business_basic` + `instagram_business_content_publish` | https://developers.facebook.com/docs/instagram-platform/content-publishing |
| 인스타 권한 (Facebook 로그인 방식) | `instagram_basic` + `instagram_content_publish` + `pages_read_engagement`(경우에 따라 `ads_management`, `ads_read` 추가) | 같은 페이지 |
| 페이스북 페이지 게시 | `pages_manage_posts`, `pages_show_list` 등. 정확한 조합은 권한 문서에서 **확인 필요** | https://developers.facebook.com/docs/permissions |
| 게시 형식·한도 | 피드 사진·영상, 릴스, 스토리, 캐러셀 가능. 계정당 **24시간에 API 게시 100건**(캐러셀은 1건으로 계산) | https://developers.facebook.com/docs/instagram-platform/content-publishing |
| 고급 액세스 + 앱 심사 | 앱에 역할이 없는 사람(=고객사)이 쓰려면 권한마다 앱 심사를 받아 고급 액세스를 얻어야 함 | https://developers.facebook.com/docs/development/release/tech-providers/ |
| 비즈니스 인증 | 기술 제공업체 자격을 유지하려면 필요함. 인증이 풀리면 자격도 잃음 | 같은 페이지 |
| 기술 제공업체 접근 인증 | 다른 회사의 데이터에 접근하는 업체가 받는 인증. **보통 영업일 5일** | https://developers.facebook.com/blog/post/2022/06/02/access-verification-process-for-tech-provider-apps/ |
| 앱 심사·비즈니스 인증 기간 | 공식 FAQ에 "수 주"라는 언급이 있다는 요약만 있음. 공식 페이지를 직접 열어 보지는 못함 → **확인 필요**. 계획은 4~8주로 잡는 것을 권함(추정) | — |

### 2-2. 통합 게시 API (이미 Meta 심사를 받은 업체)

| 업체 | 지원 채널 | 가격 | 화이트라벨·재판매 | 한국 고객 |
|---|---|---|---|---|
| **Zernio** (구 Late / getlate.dev) | 인스타·페북·유튜브·틱톡·스레드·X·링크드인·핀터레스트·레딧·블루스카이·구글 비즈니스·텔레그램·스냅챗 등. **네이버 없음** | **연결 계정당** 월 $6(3~10개) → $3(11~100개) → $1(101개 이상). 2개까지 무료. 게시 무제한. 엔터프라이즈는 별도 협의 | API 문서에 "화이트라벨" 언급이 있음. 연결 화면 브랜딩·재판매 조건은 **확인 필요** | 국가 제한 언급 없음 → 확인 필요 |
| **Upload-Post** | 인스타·페북·유튜브·틱톡·스레드·링크드인·X·핀터레스트·레딧 등 22개. **네이버 없음** | 프로필 = 고객 1명(여러 SNS 계정 연결). Basic $16(5개), **Professional $33(25개)**, Advanced $118(75개), Business $350(225개). 연간 결제 기준 | Professional 이상에서 **화이트라벨 연동** 제공. 연결 화면은 자체 제작하거나 JWT 링크 방식 | 한국어 페이지 있음. 국가 제한 언급 없음 |
| **Ayrshare** | 인스타·페북·유튜브·틱톡·스레드·X·링크드인·핀터레스트·레딧·스냅챗·텔레그램·왓츠앱·블루스카이·구글 비즈니스. **네이버·카카오 없음** | Premium $149(프로필 1개), Launch $299(10개), **Business $599(30개, 31~100번째는 개당 $8.99)**, Enterprise 별도 | Launch 이상에서 커스텀 브랜딩. "자사 제품에 내장" 용도로 설계됨 | 국가 제한 언급 없음 |
| **Buffer API** | 인스타·페북·유튜브(쇼츠)·틱톡·스레드·링크드인·핀터레스트 등 | Buffer 요금(채널당 월 $5~10)에 포함 | 다른 회사 고객용 제품을 만들어도 되는지 공식 문구가 없음 → **확인 필요**(자기 계정 자동화용으로 보임) | — |

출처: https://zernio.com/pricing , https://docs.zernio.com/api/openapi , https://www.upload-post.com/ , https://docs.upload-post.com/guides/user-profile-integration/ , https://www.ayrshare.com/pricing/ , https://www.ayrshare.com/docs/help-center/product/what_social_networks_are_supported , https://buffer.com/pricing , https://developers.buffer.com/

→ **추천**: 처음에는 **Zernio**(적게 쓸 때 저렴하고 계정당 과금이라 원가 계산이 쉬움)나 **Upload-Post Professional**(25개사에 월 $33, 화이트라벨 포함)로 시작함. 고객사가 늘면 자체 Meta 앱 심사를 함께 진행함.

---

## 3. YouTube Data API 업로드

| 항목 | 내용 | 출처 |
|---|---|---|
| 기본 할당량 | 프로젝트당 하루 10,000유닛(일반 메서드) | https://developers.google.com/youtube/v3/determine_quota_cost |
| 업로드 비용 | 2025-12-04: 업로드 1회가 약 1,600유닛에서 **약 100유닛으로 인하**됨. 2026-06-01: `videos.insert`가 **별도 할당량**으로 분리되어 **1회 1유닛, 하루 기본 100회** | https://developers.google.com/youtube/v3/revision_history , https://developers.google.com/youtube/v3/docs/videos/insert |
| 미감사 프로젝트의 비공개 제한 | 2020-07-28 공지: 그 이후 만든 미감사 프로젝트에서 올린 영상은 **비공개로 잠기고, 감사를 받아야 풀림**. 그런데 현재 `videos.insert` 문서에는 "미감사 프로젝트에서 올린 영상은 비공개로 제한되지 않는다"고 적혀 있음. 이 규칙을 없앴다는 변경 기록은 찾지 못함 → **확인 필요(실제 업로드로 시험)** | https://developers.google.com/youtube/v3/revision_history (2020-07-28 항목), https://developers.google.com/youtube/v3/docs/videos/insert |
| 감사 절차 | "Audit and Quota Extension Form"을 제출하면 YouTube 팀이 연락함. 할당량을 늘리려면 먼저 준수 감사를 통과해야 함 | https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits |
| 감사 기간 | 공식 문서에는 "가능한 한 빨리"라고만 되어 있음 → **확인 필요** | 같은 페이지 |
| Google OAuth 검증 | 업로드 범위(youtube.upload)는 민감 범위라 OAuth 앱 검증이 따로 필요할 수 있음 → **확인 필요** | — |

---

## 4. Higgsfield

| 항목 | 내용 | 출처 |
|---|---|---|
| 소비자 요금제 | Free $0(크레딧 0, 상업 이용 "미포함" 표시) / **Starter 월 $19(연간 결제) 270크레딧** / **Plus 월 $59(월간)·$47(연간) 1,200크레딧** / **Ultra 월 $129(월간)·$99(연간) 3,000크레딧(최대 9,000)** | https://higgsfield.ai/pricing |
| 팀 요금제 | 좌석당 월 $65부터(연간 결제), 좌석당 1,000크레딧부터, 공유 크레딧 최대 37,500 | https://higgsfield.ai/pricing |
| 엔터프라이즈 | 별도 계약(Enterprise Use Agreement). IP 침해 배상은 엔터프라이즈 요금제만 제공. 가격은 **확인 필요** | https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially |
| **API** | 있음(open.higgsfield.ai). **선불 Units**로 결제하며 소비자 구독·크레딧과는 별개. Units는 1년 뒤 만료. 서버 오류(5xx)는 청구하지 않음 | https://open.higgsfield.ai/terms-of-service , https://open.higgsfield.ai/ |
| 이미지 1건 크레딧(소비자) | Soul 2.0 0.12 / Soul 0.25 / Nano Banana 1 / Nano Banana Pro 2 / Pro 4K 4 / GPT Image 1 / Seedream 1 / FLUX.2 Pro 1 크레딧 | https://higgsfield.ai/pricing |
| 영상 크레딧(소비자) | Kling 2.5 Turbo 720p 약 4크레딧/5초, 1080p 약 6크레딧/5초. Veo 3.1 Fast 약 16크레딧/4초, Veo 3.1 약 40크레딧/4초 (가격 페이지를 요약한 내용, 직접 대조는 **확인 필요**) | https://higgsfield.ai/pricing |
| API 단가(달러) | 이미지: Soul 2 $0.003부터, Marketing Studio $0.014부터, Ads Studio $0.084부터. 영상(초당): **Kling 3.0 $0.042(50% 할인가, 정가 약 $0.084)**, **Seedance 2.5 $0.144부터(30% 할인가)**, Wan 3.0 $0.020부터. 할인은 한시적일 수 있음 | https://open.higgsfield.ai/ , https://www.all-ai.de/news/news26/higgsfield-ki-api (제3자) |
| 소유권·상업적 이용 | Higgsfield는 생성물 소유권을 주장하지 않고, 상업적 이용을 제한하지 않음. **고객에게 양도·재라이선스 가능**(약관 4.4) | https://higgsfield.ai/creator-hub/help-center/account/who-owns-my-generations-and-can-i-use-them-commercially |
| 재판매 제한 | 소비자 약관: 서비스 자체의 재판매나 상업적 이용은 서면 허락 없이 금지. API 약관 4.1~4.6: 단순히 API를 다시 파는 것은 금지되고, **의미 있는 기능을 더한 앱 안에서만** 최종 사용자에게 제공 가능. 최종 사용자와 동등한 약관 체결, 18세 이상 확인, 키는 서버에만 둘 것, 워터마크 제거 금지 | https://open.higgsfield.ai/terms-of-service , https://www.higgsfield.company/terms-of-use-agreement |
| 무료 요금제의 상업 이용 | 가격 페이지는 Free에 "상업 이용 미포함"이라고 표시함. 반면 도움말은 "상업 이용 권리는 요금제와 무관"이라고 함 → **서로 다름, 확인 필요** | 위 두 페이지 |

→ **워크인에 주는 의미**: 소비자 구독 계정을 서버에서 함께 쓰는 것은 금지(재판매에 해당)되므로 **API 계약으로 가야 함**. 워크인은 승인 흐름과 자동 게시 같은 기능을 더하므로 "의미 있는 기능" 조건은 충족할 가능성이 큼. 다만 **고객 약관에 Higgsfield 조건을 반영**해야 함.

---

## 5. 워크인 마케팅 요금 구조 초안 (VAT 별도)

### 5-a. 경쟁 도구 가격 비교

| 도구 | 과금 단위 | 가격 | 원화 환산(가정) | 비고 |
|---|---|---|---|---|
| Buffer | 채널당/월 | Essentials $5, Team $10(연간) / 무료 3채널 | 7,000 / 14,000원 | 네이버 없음. https://buffer.com/pricing |
| Later | 묶음/월(연간 결제) | Starter $18.75(1세트 = 8프로필, 1인) / Growth $37.50(16프로필, 승인 기능) / Scale $82.50(48프로필) | 26,000 / 52,500 / 115,500원 | AI 크레딧 5/50/100 포함. https://later.com/pricing/ |
| Hootsuite | 사용자당/월(연간) | Standard $99(10계정) / Professional $199 / Advanced $399 | 138,600 / 278,600 / 558,600원 | https://www.hootsuite.com/plans |
| 글웨이(국내) | 계정/월 | 할인가 29,500 / 74,500 / 199,500원 (예약 발행은 Pro만) | — | 네이버·티스토리 블로그 중심. https://geulway.com/ |
| SNS오피스(국내) | 월 | $14.99 / Pro $29.99 | 21,000 / 42,000원 | 인스타·스레드·네이버 |
| **원가 참고: Zernio** | 연결 계정당 | $6 → $3 → $1 | 8,400 → 4,200 → 1,400원 | 쓰는 계정 수가 늘수록 저렴해짐 |
| **원가 참고: Upload-Post** | 고객(프로필)당 | $33 / 25개사 | 약 1,850원/개사 | 화이트라벨 포함 |

### 5-b. 마케팅 공간 추가 요금 (회사/월) — 채널 수에 따른 구간 (= 요청 5-c 포함)

| 구간 | 월 요금 | 자동 게시 채널 | 포함 기능 | 원가 추정(Zernio 기준) |
|---|---|---|---|---|
| 마케팅 라이트 | **39,000원** | 3개 (예: 인스타·페북·스레드) | 콘텐츠 캘린더, 승인 후 자동 게시, 네이버 블로그 **발행 도우미**(사람이 최종 발행 클릭) | 3 × 1,400~8,400원 = 4,200~25,200원 |
| 마케팅 스탠다드 | **79,000원** | 8개 (+유튜브·틱톡 등) | + 외부(고객사) 승인 링크, 성과 요약 | 11,200~67,200원 |
| 마케팅 프로 | **149,000원** | 20개 (여러 브랜드·지점) | + 브랜드별 공간, 우선 지원 | 28,000~168,000원 |
| 채널 추가 | 5,000원/채널 | — | — | 1,400~8,400원 |

- 위치: Later Growth(약 52,500원)와 Hootsuite(13만 원 이상) 사이. 국내 블로그 도구(글웨이 29,500~199,500원)와 비슷한 수준.
- 주의: 초기 계정이 10개 미만이면 Zernio 원가가 계정당 $6로 높음. **초기에는 Upload-Post Professional($33 정액)**이 더 유리할 수 있음.
- 네이버 블로그는 "자동 게시 채널" 수에서 빼고 **"발행 도우미(반자동)"**로 따로 표시하기를 권함(약관 위험 때문).

### 5-c. AI 제작 크레딧 팩 (원가 × 2~3배 가정)

**원가 → 판매 단가 (1크레딧 = 100원 기준)**

| 종류 | 예시 모델 | 원가(API) | 원화 원가(가정) | 판매 크레딧 | 판매가 | 배수 |
|---|---|---|---|---|---|---|
| 기본 이미지 | Soul 2 / Marketing Studio | $0.003~0.014 | 4~20원 | 1 | 100원 | 5배 이상(최저 단위) |
| 고급 이미지 | Nano Banana Pro 수준 (소비자 2크레딧 ≈ Plus 기준 $0.10) | 약 $0.10 (API 단가는 **확인 필요**) | 약 140원 | 4 | 400원 | 약 2.9배 |
| 광고 이미지 세트 | Ads Studio | $0.084부터 | 약 118원 | 3 | 300원 | 약 2.5배 |
| 짧은 영상 5초 | Kling 3.0 (정가 $0.084/초) | $0.42 | 약 590원 | 15 | 1,500원 | 약 2.5배 |
| 고급 영상 5초 | Seedance 2.5 (정가 약 $0.206/초 추정) | 약 $1.03 | 약 1,440원 | 40 | 4,000원 | 약 2.8배 |

- 할인가(Kling $0.042/초 등)가 아니라 **정가로 원가를 잡음**. 할인이 끝나도 손해 보지 않게 하기 위함.

**기존 AI 크레딧 팩에 맞춤 (회사별)**

| 팩 | 가격 | 크레딧 | 예시 (하나만 만든다면) |
|---|---|---|---|
| 기본 | 9,900원 | 99 | 고급 이미지 24장, 또는 짧은 영상 6개 |
| 표준 | 29,000원 | 320 (약 10% 추가) | 고급 이미지 80장, 또는 짧은 영상 21개 |
| 대량 | 59,000원 | 700 (약 18% 추가) | 고급 이미지 175장, 또는 짧은 영상 46개 |

- 글 생성(캡션·블로그 원고)은 기존 AI 크레딧(텍스트)과 함께 쓰는 것으로 가정함. 텍스트 원가는 이번 조사 범위가 아님.

---

## 6. 대표 결정이 필요한 것

| # | 결정 | 선택지 |
|---|---|---|
| 1 | 네이버 블로그 범위 | (A) 발행 도우미: 고객이 최종 클릭 / (B) 확장 프로그램 예약 발행: 약관 위험 큼 / (C) 원고만 제공하고 복사 |
| 2 | 게시 API | Zernio(계정당 과금) vs Upload-Post(정액 + 화이트라벨) vs 자체 Meta 앱 심사 병행 |
| 3 | AI 영상 | Higgsfield API 계약(선불 Units). 약관 반영과 18세 이상 확인 필요 |
| 4 | 요금 | 위 초안(39,000 / 79,000 / 149,000원, 크레딧 100원)으로 진행할지 |

## 7. 아직 확인이 필요한 것

- 네이버 XML-RPC가 실제로 작동하는지(시험하지 않음, 약관상 권하지 않음), 확장 프로그램 방식에 대한 법률 의견
- Meta 앱 심사·비즈니스 인증의 공식 소요 기간
- YouTube 미감사 프로젝트 업로드가 실제로 비공개로 잠기는지(테스트 업로드 1회로 확인)
- Zernio의 화이트라벨·재판매 약관, Buffer API를 제3자 제품에 써도 되는지
- Higgsfield API의 Nano Banana·Veo 단가, 엔터프라이즈 가격, Free 요금제 상업 이용 표기가 서로 다른 점
- 환율(1,400원 가정)

## 8. 대표 결정(2026-10-17)
- 금액은 실제 상용화 때 확정. 지금은 **구조만**: 마케팅 공간 = **베이직 · 프로 · 마스터** 3구간(자동 게시 채널 수·브랜드 수·외부 승인 링크로 구분) + 채널 추가 + AI 제작 크레딧 팩. 업무 공간 요금(V27)과 별개로 '공간 추가'.
- 통합 게시 API(Upload-Post) 구간: Basic $16(5개사) · Professional $33(25개사) · Advanced $118(75개사) · Business $350(225개사) — 고객사 수가 늘면 상위 구간으로 올리는 방식(원가는 회사당 약 $0.5~1.6).
- 우리 회사 블로그 게시: 지금 방식 유지.
