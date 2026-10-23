# 워크인 Meta 앱 — 이용 사례·권한·심사 시연 시나리오 (2026-10-19 초안)

> 앱 소유: 김소담 부사장 계정(안내서 `docs/handoff/META_APP_SETUP_GUIDE.md`). 앱 ID 가 나오면 Vercel 에 `META_APP_ID`·`META_APP_SECRET` 를 넣는다.
> 대표 방향: '경쟁사보다 높은 수준으로'. 기능 설계는 `MKT_PUBLISHING_DESIGN.md` 6절과 `AI_ADS_OPERATIONS_DESIGN.md` 6절에 있다.
> **권한 이름·심사 요건·정책 수치는 기억과 조사를 바탕으로 정리했다. 제출 직전 Meta 공식 문서(앱 대시보드의 이용 사례 화면·권한 참고 문서)로 다시 확인한다.** 확실하지 않은 칸은 '확인 필요'로 표시했다.
> 비밀값·검수자 로그인 정보는 이 문서에 쓰지 않는다. 검수자 정보는 심사 양식에만 넣는다.

## 1. 체크하는 이용 사례 5개와 지금 제외하는 것

| # | 이용 사례(앱 대시보드) | 워크인 기능 | 필요 권한(확인 필요) |
|---|---|---|---|
| 1 | Instagram 메시지 및 콘텐츠 관리 | ⑤-2 인스타 게시(지금은 도우미) · **A 통합 문의함**(DM·댓글) · **E 부스트** 후보 고르기 | instagram_basic, instagram_content_publish, instagram_manage_messages, instagram_manage_comments, instagram_manage_insights, pages_show_list, pages_read_engagement |
| 2 | 페이지의 모든 부분 관리 | 페이스북 페이지 게시 · **A 문의함**(페이지 댓글·Messenger 수신은 제외 범위 확인) · 페이지 웹후크 | pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_read_user_content, pages_manage_metadata(웹후크 구독) |
| 3 | 마케팅 API — 광고 성과 측정 | 광고 성과(읽기, 지금 있음) · **D 광고비 → 계약·매출 보고** | ads_read, read_insights, business_management |
| 4 | 마케팅 API — 잠재 고객 확보·관리(Lead Ads) | **B 리드 → 영업 리드 자동 등록** · 리드 폼 만들기(V44 세팅안) | leads_retrieval, pages_manage_ads, pages_manage_metadata, pages_show_list, ads_management(폼 생성 시) |
| 5 | 광고 MCP 서버로 광고 만들기·관리 | **C AI 비서 광고 운영** · **E 승인된 콘텐츠 부스트** | ads_management, ads_read, business_management, pages_manage_ads — MCP 서버의 인증 방식·권한 묶음 **확인 필요** |

- Threads: 이용 사례 목록에 없어서 앱을 만든 뒤 '이용 사례 추가'로 넣는다. 권한은 threads_basic, threads_content_publish(확인 필요)이고, OAuth 는 따로 받는다.
- 지금 제외(심사 부담): 카탈로그, Messenger 플랫폼, WhatsApp, 퍼가기(oEmbed), 라이브, Audience Network, 기부.
  - A 문의함은 페이스북 페이지 **Messenger DM 을 제외**하고 시작한다. Messenger 를 넣으면 pages_messaging 심사가 추가된다(확인 필요).
  - 인스타 DM 은 1번 이용 사례(instagram_manage_messages)로 받는다.

## 2. 공통 심사 준비물

1. 앱 기본 정보
   - 앱 이름 '워크인'과 아이콘(1024×1024)
   - 카테고리: 비즈니스
   - 앱 도메인: work-in.dev
   - 개인정보처리방침: https://www.work-in.dev/privacy
   - 약관
   - 데이터 삭제 콜백: `https://www.work-in.dev/api/marketing/publish/meta/data-deletion` (구현됨)
2. OAuth 리디렉션 URI
   - 게시: `…/api/marketing/publish/callback/meta`
   - 광고: `…/api/marketing/ads/callback/meta`
   - 운영 주소 기준 값은 연결 계정 화면의 '플랫폼 관리자: Meta 앱 설정 값'에 나온다.
3. 비즈니스 인증: 하이링크 사업자 정보로 진행(대표 진행). 고급(Advanced/Full) 액세스의 전제 조건이다.
   - 리드 광고 실운영에 신청할 고급 액세스(로컬 10/23): **leads_retrieval · pages_manage_metadata · pages_manage_ads · ads_read** — 비즈니스 인증을 마친 뒤 앱 심사로 신청한다.
   - 그 전(개발 모드, `META_APP_LIVE_MODE` ≠ 1)에는 실제 광고 리드 웹후크가 오지 않는다 → 워크인이 30분마다 놓친 리드를 불러와 등록한다(리드 광고 상자에 '개발 모드' 안내). 앱 심사·라이브 뒤에는 웹후크로 실시간.
4. 웹후크
   - 콜백 `…/api/marketing/meta/webhook` — **B(리드 광고) 구현됨(2026-10-23)**: GET 확인(hub.verify_token = env `META_WEBHOOK_VERIFY_TOKEN`) · POST 서명 확인(X-Hub-Signature-256 = 앱 시크릿 HMAC).
   - 앱 대시보드 › 웹후크 › 'Page' 객체에 콜백 URL·확인 토큰을 넣고 `leadgen` 필드를 구독한다. 페이지마다 앱 설치(`POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`)는 워크인 [리드 광고 받기]가 한다.
   - 리드 권한(Meta 문서 '리드 가져오기' 기준): leads_retrieval · pages_manage_ads · pages_manage_metadata · ads_management (+ pages_show_list · pages_read_engagement).
   - Meta 문서: '리드 광고 테스트 도구'는 개발 모드 앱에서 못 쓴다 → 워크인 [시험 리드 보내기](`POST /{form-id}/test_leads`)로 확인.
   - 남은 구독 필드: instagram(messages, comments), page(feed) — A(문의함) 구현 때.
5. 검수자 시험 계정
   - 우리 회사 페이지와 인스타 비즈니스 계정
   - 앱 역할(테스터)에 등록한다.
   - 광고 계정은 결제수단이 있는 시험용 계정을 쓴다. 광고는 **꺼진 상태로만** 만든다.
6. 개인정보처리방침에 'Meta 사용자 데이터' 문단을 추가해야 한다(문구 대표 확인). 들어갈 내용:
   - 받는 데이터: 페이지·인스타 계정, DM·댓글, 리드, 광고 성과
   - 쓰는 목적
   - 보관 기간
   - 삭제 방법

## 3. 권한별 시연 녹화 시나리오(각 1~3분, 화면 녹화 + 자막)

공통 시작: 브라우저 주소창에 www.work-in.dev 가 보이게 한다 → 로그인 → 마케팅 공간 → 설정 › 연결 계정 → [연결] → Facebook 동의 화면에서 앱 이름 '워크인'과 요청 권한이 보이게 멈춘다 → 허용 → 돌아와 '연결됨'.

| 녹화 | 보여 줄 권한 | 장면 |
|---|---|---|
| R1 게시 | instagram_basic, instagram_content_publish, pages_show_list, pages_read_engagement, pages_manage_posts | 승인된 콘텐츠 → [게시] → 인스타·페이지에 올라간 글 확인(새 탭) → 워크인 게시 기록에 주소 → 연결 끊기 |
| R2 문의함(A) | instagram_manage_messages, instagram_manage_comments, pages_manage_engagement, pages_read_user_content, pages_manage_metadata | 다른 계정으로 DM·댓글 → 워크인 문의함에 자동 등록 → AI 답장 초안 → 사람이 고쳐 [보내기] → 인스타에서 답장 확인 → 24시간 지난 대화는 보내기 잠김 표시 |
| R3 인사이트 | instagram_manage_insights, read_insights | 게시물별 도달·참여 → 부스트 추천 카드(E) |
| R4 광고 성과(D) | ads_read, read_insights | 광고 성과 화면(노출·클릭·비용·리드) → 월간 보고의 '광고비 → 문의·리드·계약·매출' |
| R5 리드(B) | leads_retrieval, pages_manage_ads, pages_manage_metadata | 리드 광고 테스트 도구로 리드 제출 → 워크인 영업 리드 자동 생성·담당 배정·'5분 안에 연락' 알림 → 전화 버튼 |
| R6 광고 만들기(C·E) | ads_management, business_management | AI 비서에게 요청 → 세팅안 미리보기 → [승인하고 시작] → 광고 관리자에서 **꺼진(PAUSED)** 캠페인 확인 → 워크인에서 [켜기]는 누르지 않고 변경 기록·되돌리기만 보여 줌 |

자막 공통: "워크인은 고객 회사의 관리자가 직접 연결한 계정에서만 동작합니다. 돈이 나가는 변경과 메시지 발송은 모두 사람이 승인합니다."

## 4. 권한별 사용 설명(제출 양식 초안 — 한 권한에 2~4문장)

- **instagram_manage_messages**: 고객 회사가 자기 인스타그램 비즈니스 계정으로 받은 DM 을 워크인 문의함에 모아, 담당자가 답장을 쓰고 보낼 수 있게 합니다. 답장은 담당자가 [보내기]를 누를 때만 나가며, 자동 발송·대량 발송은 하지 않습니다. 메시지는 문의 처리 목적으로만 쓰고, 연결을 끊으면 삭제합니다.
- **instagram_manage_comments / pages_manage_engagement**: 게시물 댓글을 문의함에 모아 담당자가 답글을 달거나 숨길 수 있게 합니다.
- **instagram_content_publish / pages_manage_posts**: 고객 회사 안에서 승인된 콘텐츠를 담당자가 [게시]를 눌러 자기 계정·페이지에 올립니다.
- **leads_retrieval**: 고객 회사의 리드 광고로 들어온 신청을 워크인 영업 리드로 등록해 담당자가 바로 연락하게 합니다. 리드 정보는 그 회사 안에서만 보이고, 광고·제3자 제공에는 쓰지 않습니다.
- **ads_read / read_insights**: 고객 회사의 광고·게시물 성과를 읽어 보고서로 보여 줍니다.
- **ads_management**: 고객이 승인한 광고 세팅안을 **꺼진 상태로** 만들고, 고객이 승인한 변경(켜기·예산·입찰)만 반영합니다. 월 광고비 상한을 넘으면 워크인이 광고를 끕니다.

## 5. 정책 체크리스트(제출 전 공식 문서로 확인)

- 인스타·Messenger 24시간 표준 응답 창. 사람 상담원 태그로 7일까지 늘릴 수 있는지와 조건 — 확인 필요.
- 고급 액세스 조건(최근 호출 수·오류율 기준 등) — 확인 필요. AI_ADS_API_SURVEY.md 에 Marketing API 기준을 적어 두었다.
- 광고 MCP 서버의 인증 방식(우리 앱 OAuth 토큰을 쓰는지, 별도 연결인지)과 사용 조건 — 확인 필요.
- Lead Ads 리드 보관·삭제 의무(90일 다운로드 기한 등) — 확인 필요.

## 6. 추가 아이디어로 늘어나는 권한·요건 (🔺, V44 7절 — 확인 필요)

| 아이디어 | 늘어나는 것 | 이용 사례 | 메모 |
|---|---|---|---|
| 2 전환 추적(Conversions API) | 데이터셋(픽셀) 만들기·서버 이벤트 전송 — ads_management·business_management 범위 안인지, 별도 권한·이용 사례인지 확인 필요 | 마케팅 API(성과 측정) 범위 확인 | 해시 전송, 처리방침에 '전환 정보 전송' 문단. 시연 녹화 R7 추가: 문의 등록 → 이벤트 관리자에서 서버 이벤트 수신 확인 |
| 7 경쟁 광고 모니터링(광고 라이브러리 API) | ads_archive 접근 + **앱 사용자 신원 확인**(Meta 신원 확인 절차) | 광고 라이브러리(별도) | 한국 일반 광고 검색 범위가 제한될 수 있음 — 확인 필요. 범위가 좁으면 하지 않음 |
| 8 맞춤·유사 타겟 | ads_management + 맞춤 타겟 약관 동의(광고 계정별) | 마케팅 API(광고 만들기) 범위 | 고객사 동의 체크·해시 업로드·원본 미보관. 녹화 R8: 동의 체크 → 해시 업로드 → 타겟 생성(꺼진 광고) |
| 4 댓글 → 비공개 답장 | 추가 권한 없음(instagram_manage_comments·instagram_manage_messages) | 인스타 메시지·콘텐츠 | 비공개 답장 조건(댓글 1건당 1회 등) 확인 필요 |

- Google 쪽은 탐색자 등급으로 시작한다(10/19 승인).
- 고객 일치(Customer Match)는 Google 정책 요건(계정 이력·정책 준수)을 확인해야 한다.
