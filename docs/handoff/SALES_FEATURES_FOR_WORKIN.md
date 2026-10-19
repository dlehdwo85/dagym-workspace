<!-- 사본: sales-os 운영 코드 2f74e84 기준 docs/FEATURES_FOR_WORKIN.md (2026-10-19, 영업관리 세션 작성, 개인정보·비밀값 없음 확인) -->
# Sales OS (영업관리) 기능 인벤토리 — 워크인 이관용

- 기준: 이 워크트리의 실제 코드(app/, components/, lib/, supabase/migrations 0001–0037, supabase/functions/, vercel.json, scripts/). 코드로 확인하지 못한 것은 "확인 필요"로 적었습니다.
- 상태 표기
  - 사용 중: 화면이나 cron에서 실제로 호출되는 기능
  - 미사용(코드만 있음): 코드나 DB 객체는 있지만 화면이나 cron에서 호출되지 않는 것
  - 확인 필요: 코드만으로는 판단할 수 없는 것
- 작성일: 2026-10-17

---

## 1. 개요

| 항목 | 내용 | 상태 |
|---|---|---|
| 스택 | Next.js 14.2.13 (App Router, Server Components, Server Actions), React 18.3, TypeScript, Tailwind 3.4, lucide-react, @dnd-kit(칸반), react-hook-form + zod, date-fns, 글꼴 IBM Plex Sans KR | 사용 중 |
| DB·인증 | Supabase(Postgres + Auth + Storage). @supabase/ssr 쿠키 세션, 이메일+비밀번호 로그인(`signInWithPassword`) | 사용 중 |
| 배포 | Vercel. `vercel.json`의 `git.deploymentEnabled`는 `claude/build-sales-crm-TCuk0`만 true이고 나머지(`*`)는 false. 운영 도메인 sales-os-flame.vercel.app (0031 시드 base_url에 등장) | 사용 중 |
| 리전 | `regions: ["icn1"]`. 수집 라우트도 `preferredRegion = "icn1"` (국내 원천 파일 다운로드 속도 때문) | 사용 중 |
| 빌드 생략 규칙 | `ignoreCommand`: *.md, docs/**, scripts/tests/**, scripts/e2e/** 만 바뀐 커밋은 빌드하지 않음 | 사용 중 |
| 미들웨어 | `middleware.ts` → `lib/supabase/middleware.ts`. 세션 갱신을 하고, 비로그인이면 /login으로 보냄. 로그인한 상태로 /login에 오면 /dashboard로 보냄(단 `?reason=inactive`이면 그대로 둠). auth 호출이 3초를 넘기면 통과시킴(fail-open, 데이터는 RLS가 보호). /api/*, 정적 파일은 제외 | 사용 중 |
| 계정 상태 검사 | `requireUser()`: 프로필이 없으면 /login, `active=false`이면 `/auth/signout?reason=inactive`. `requireAdmin()`: admin이 아니면 /dashboard | 사용 중 |
| RLS | 모든 테이블에 RLS 적용. 원칙은 8장 참고 | 사용 중 |
| SECURITY DEFINER RPC | 상태 변경 전용 함수(활성 사용자인지 검사한 뒤 쓰기): set_prospect_contact_status, set_prospect_followup, convert_prospect_to_lead, set_opportunity_work, convert_opportunity_to_lead, set_vendor_registration, ai_month_cost, find_similar_leads, is_admin, can_access_lead, handle_new_user, 0037 g2b 트리거 함수 | 사용 중 |
| Edge Function `collector-write` | 수집 데이터를 DB에 쓰는 유일한 창구. Supabase가 자동으로 주입하는 service role(`SUPABASE_SECRET_KEYS` 우선, 없으면 `SUPABASE_SERVICE_ROLE_KEY`)을 보유. Vercel은 service role을 갖지 않음. 인증은 `Authorization: Bearer <CRON_SECRET>`의 SHA-256을 `CRON_SECRET_HASH`와 비교. verify_jwt=false로 배포. 허용 action 10종: start_run, complete_run, insert_observation, insert_observations_bulk, upsert_kapt_vendor, touch_source_master, upsert_operating_prospect, derive_operating_from_kapt, upsert_operating_prospects_bulk(최대 500건), upsert_procurement_notices_bulk(최대 500건, 한 요청에 source_type 1종) | 사용 중 |
| Edge 배포 보조 | `scripts/build-edge-bundle.mjs`: _shared 3개 파일과 index를 단일 파일로 묶음(대시보드 붙여넣기용), SHA-256 출력. 공유 로직은 `supabase/functions/_shared/*`에 있고 앱은 `lib/procurement.ts`, `lib/operating-prospects.ts`에서 re-export | 사용 중 |
| PWA manifest | `app/manifest.ts`: id·start_url=/dashboard, standalone, portrait, theme #1B2B5E, 아이콘 192/512/maskable 512, 바로가기 4개(오늘 할 일 /dashboard, 영업기회 /opportunities, 진행영업 /active-sales, 일정 /calendar). appleWebApp title "영업관리" | 사용 중 |
| 서비스 워커 | `public/sw.js`: 캐시하지 않음. 화면 이동(navigate) 요청만 처리하며, 네트워크가 실패하면 "인터넷 연결이 끊겼습니다" 오프라인 HTML(503)을 보여줌. /api/* 는 처리하지 않음(첨부 다운로드 보호). install 시 skipWaiting, activate 시 clients.claim | 사용 중 |
| 설치 배너 | `components/layout/AppInstall.tsx`: 모바일(≤767px)이면서 standalone이 아닐 때만 표시. 안드로이드는 beforeinstallprompt를 받아 "설치" 버튼, iOS는 "공유 → 홈 화면에 추가" 안내. 닫으면 localStorage `salesos.install.hidden=1`. sw.js도 여기서 등록 | 사용 중 |
| VersionWatch | `components/layout/VersionWatch.tsx`: 5분마다, 그리고 창 포커스나 visibility가 바뀔 때 `/api/health`의 `build.commit`과 빌드 시 넣은 `NEXT_PUBLIC_BUILD_COMMIT`(VERCEL_GIT_COMMIT_SHA 앞 7자리)을 비교. 다르면 상단에 "새 버전이 있어요 [새로고침]" 띠를 띄움. 입력 중이 아니면 다음 화면 이동 때 자동 새로고침. SW update()도 호출. 커밋 정보가 없는 로컬 빌드에서는 동작하지 않음 | 사용 중 |
| ScrollMemory | `components/layout/ScrollMemory.tsx`: 경로+쿼리별로 window와 `main[data-scroll-root]`의 스크롤 위치를 sessionStorage(`salesos.scroll:*`)에 저장. popstate(뒤로/앞으로)로 돌아온 경우에만 최대 30회(100ms 간격)까지 복원 시도 | 사용 중 |
| AI 비서 (AiDock) | 화면 오른쪽 아래 버튼과 대화창(모바일에서는 하단 시트 82dvh). 대화는 sessionStorage `salesos.ai.chat`에 최근 30개 보관. 화면별 추천 질문 칩 제공(dashboard, opportunities, monitoring, vendors, active-sales, leads, calendar, tasks) | 사용 중 (키가 등록돼 있어야 동작) |
| AI 모델·한도 | Anthropic SDK. 모델 기본값 `claude-sonnet-5-5`(AI_MODEL로 변경). 사용자 1명당 하루 질문 수 기본 50(AI_DAILY_LIMIT, ai_usage purpose='chat' 건수로 셈). 회사 전체 월 예산 기본 30 USD(AI_MONTHLY_BUDGET_USD, RPC ai_month_cost). 도구 호출 루프는 최대 8단계, 질문 최대 2000자, 히스토리 최근 20턴. 비용은 모델별 단가표로 추정해 ai_usage에 기록 | 사용 중 |
| AI 도구 | 읽기 7종: today_summary, search_leads, get_lead, search_bids, list_schedules, list_tasks, list_vendors. 사용자 세션(RLS)으로 실행. 제안 5종: propose_create_schedule, propose_create_task, propose_set_lead_next_contact, propose_set_bid_work, propose_set_vendor_status → ai_proposals에 pending으로만 기록 | 사용 중 |
| AI 제안 확인 흐름 | `POST /api/ai/proposals/[id] {accept}`. 먼저 pending을 accepted/rejected로 조건부 update해서 같은 제안이 두 번 반영되지 않게 함. 그다음 기존 저장 함수로 반영: upsertSchedule, upsertTask, leads.next_contact_date update, setOpportunityWork, setVendorRegistration. 실패하면 status=failed, 성공하면 result_link 저장 | 사용 중 |
| AI API | `POST /api/ai/chat` (maxDuration 120): 키가 없으면 503, 한도를 넘기면 429. `GET /api/ai/status`: enabled, model, dailyLimit, remaining, admin | 사용 중 |
| /api/health | Supabase URL·키 설정 여부, `/auth/v1/health` 응답 여부(2.5초), build {commit, ref, env, deploymentUrl} 반환. no-store | 사용 중 |
| 시스템 프롬프트 규칙 | 사실은 도구로만 확인하고 지어내지 않음. 변경은 제안만. 답은 10줄 안팎, 마크다운 금지, 영업과 무관한 질문은 거절, KST 날짜 계산 | 사용 중 |

---

## 2. 메뉴·화면별 기능

### 2-0. 공통 레이아웃·메뉴

| 항목 | 내용 | 상태 |
|---|---|---|
| Sidebar (PC, md 이상) | 맨 위 "홈 · 오늘 할 일"(/dashboard), 그 아래 `lib/nav.ts` NAV_SECTIONS. "관리" 섹션은 admin만 보임 | 사용 중 |
| NAV 구조 | 영업기회(요약 / 오늘 등록 / 지금 영업 / 입찰 / 계약만료 / 신규단지 / 준공·입주 시설 / 협력사 등록), 영업 진행(진행 영업 / 칸반 / 거래처), 일정·업무(일정 / 업무), 계약·성과(계약[/proposals 포함] / 영업 ROI), 관리[admin](설정[/categories·/regions·/users 포함] / 자동수집) | 사용 중 |
| MobileNav (md 미만) | 하단 고정 5칸: 홈, 영업기회, 진행영업(/pipeline·/leads에서도 활성), 일정(/tasks에서도 활성), "전체 메뉴"(전체 화면 다이얼로그. 영업기회 섹션은 3열 타일, 나머지는 행 목록+hint. admin이 아니면 관리 섹션 숨김. 경로가 바뀌면 닫힘) | 사용 중 |
| Topbar | PC: "다짐 · 하이링크 통합 영업관리". 모바일: 아이콘 + "영업관리"(→ /dashboard). 오른쪽에 이름, 역할(관리자/영업담당자), 로그아웃(signOut → /login). 검색·알림 없음 | 사용 중 |
| SectionTabs | 탭 묶음: SALES(목록/칸반), OPPORTUNITY(8개), AGENDA(일정/업무), PERFORMANCE(계약/ROI), SETTINGS(설정 홈/카테고리/지역/사용자/자동수집). 모바일은 줄바꿈 pill, PC는 밑줄 탭 | 사용 중 |
| MobileFold | 모바일에서만 접히는 토글(기본 닫힘). PC에서는 항상 펼침. 필터·저장필터에 사용 | 사용 중 |
| 저장 필터 (SavedFilterBar) | `user_saved_filters`에 경로별로 쿼리 파라미터를 저장. "+ 현재 조건 저장"(이름 60자), 칩을 누르면 복원, ×는 confirm 후 삭제. /leads, /active-sales에서 사용 | 사용 중 |
| / (루트) | /dashboard로 redirect | 사용 중 |
| not-found / global-error | 404 안내와 복구 버튼('지금 영업' 진입점 포함) / 전역 오류 화면 | 사용 중 |
| loading.tsx | (app), dashboard, leads, leads/[id], pipeline, proposals, contracts, calendar, tasks, tasks/[id], tasks/new 스켈레톤. 대시보드 스켈레톤은 현재 레이아웃과 맞지 않음 | 사용 중 |

### 2-1. /dashboard (홈 · 오늘 할 일)

| 항목 | 내용 | 상태 |
|---|---|---|
| 데이터 | leads 전체, sales_activities 최근 8건, contracts, profiles(active), RPC dashboard_kpi, stale_leads(30), upcoming_schedules(14), active_sales_leads count, loadOpportunityOverview, data_source_run 최근 5건. revalidate=0 | 사용 중 |
| 오늘 할 일 ① 일정·연락 | upcoming_schedules에서 계약완료·실패 리드를 제외하고, 리드 next_contact_date를 "후속연락 09:00"으로 합성(종결·보류 제외, -60~+14일, 같은 리드·같은 날 일정이 있으면 건너뜀). 지연 또는 오늘 미완료 → "연락 지연/오늘 연락/지난 일정/일정 HH:MM". 전화 버튼 | 사용 중 |
| 오늘 할 일 ② 입찰·신규단지 후속 | opportunity_work.next_date ≤ 오늘, 상태가 진행영업 전환·대상아님·미참여가 아닌 것(30건). "입찰 후속"/"신규단지 후속" | 사용 중 |
| 오늘 할 일 ③ 준공시설 연락 | operating_facility_prospects.next_action_date ≤ 오늘, contact_status가 미연락 또는 연락중, lead_id 없음(30건) | 사용 중 |
| 오늘 할 일 ④ 협력사 등록 | vendor_registrations.next_date ≤ 오늘, status가 등록 완료·대상 아님이 아닌 것(20건) | 사용 중 |
| 오늘 할 일 ⑤ 입찰 오늘·내일 마감 | 관련 공고 중 마감이 오늘 또는 내일이고, (즉시 검토이거나 진행 상태가 검토중·연락중)이며, 보류·미참여·대상아님·전환 상태가 아닌 것. 나머지는 "그 밖에 N건" 한 줄 | 사용 중 |
| 오늘 할 일 ⑥⑦ 새로 들어옴 | 오늘(KST 00시 이후) first_seen인 관련 공고 건수(협력사 모집 제외) → /opportunities/today. 협력사 모집 건수 → /opportunities/monitoring?status=all&fit=recruit | 사용 중 |
| 오늘 할 일 UI | 요약 카드(총 건수, "순서대로 시작"), 지연/오늘/새로 확인 막대, 12건까지 보이고 나머지는 접힘. 정렬 tone 순서: 지연 → 오늘 → 새로. tasks 테이블은 소스가 아님 | 사용 중 |
| KPI 4개 | 진행 영업(+연락 지연 건수) → /active-sales · 입찰 마감 7일 내 → /opportunities/monitoring · 지금 영업기회(actions 수) → /opportunities/now · 이번 달 계약(+종료 90일 내 계약 수) → /contracts | 사용 중 |
| 다가오는 연락 | 3일 이내 / 7일 이내 일정(지연 칸은 항상 빈 배열을 넘김) | 사용 중 |
| 지금 영업할 곳 상위 5 | opp.actions 상위 5건 + "전체 →" /opportunities/now | 사용 중 |
| 성과·분석 더 보기(접힘) | 영업 단계 분포(6그룹), 자동수집 최근 실행(admin만), StaleLeads(30일 이상 활동 없음), 최근 상담 8건, 성과 요약(가중 forecast = expected_revenue × STAGE_WEIGHT), RevenueTrend 6개월 SVG(예상은 next_contact_date 월 기준, 계약은 start_date 월 기준) | 사용 중 |
| 미사용 | TodaysAgenda 컴포넌트, dashboard_kpi의 today/overdue/upcoming 필드 | 미사용(코드만 있음) |

### 2-2. 영업 진행

| 화면 | 보여주는 것 / 필터 / 액션 / 모바일 | 상태 |
|---|---|---|
| /active-sales (진행 영업) | `active_sales_leads` 뷰(0026: 신규리드~계약검토 + 보류), 다음 연락일 오름차순. 칩 `focus` = (전체) / overdue / today / proposal(제안서작성중~계약검토) / nonext / stalled(활동 14일 이상 공백). 칩마다 건수 표시. 저장 필터 있음. PC 표 7열(거래처·시설·지역·등록 경과일·연락처 / 상태 / 우선순위 / 다음 연락+할 일(최신 next_action) / 마지막 활동 / 예상매출 / 담당). 모바일 카드(색 막대, D-n, 전화 버튼). 수정 기능 없음(링크와 tel만) | 사용 중 |
| /pipeline (칸반) | leads 전체, 11개 상태 컬럼(dnd-kit, PointerSensor 6px). 드롭하면 `updateLeadStatus`. 실패·보류로 옮기면 prompt로 사유 필수. 화면을 먼저 바꾸는 낙관적 갱신이며 실패해도 롤백 없음. 필터 없음. 가로 스크롤. 터치로 드래그할 수 있는지 확인 필요 | 사용 중 |
| /leads (거래처 목록) | 기본 view=success(계약완료만). view: success/progress/failure/all. 필터: q(회사명), region, facility, category(관심사업), status, phase(6그룹), priority, owner(드롭다운은 admin만), sort(region_contact 기본 / contact / recent_activity / recent_created / name). 페이지네이션 없이 전체 조회. PhaseSummary, CategoryQuickFilter, 연락 지연 배지, 저장 필터. PC 표에서 인라인 수정(상태·우선순위·다음 연락일, 담당은 admin만, `quickUpdateLead`), 📝 빠른 메모(sales_activities에 "[메모 수정]" 로그), 업무 배지(지연/오늘/N). admin은 체크박스로 담당자 일괄 변경(`bulkUpdateOwner`). 모바일은 카드+전화 버튼, 필터는 접힘, CSV 버튼 숨김 | 사용 중 |
| /leads/[id] | 탭 `?tab=` info / timing(선행영업) / schedules / tasks / activities(타임라인) / proposals / contracts. 헤더 빠른 버튼 5개(상담·일정·업무·제안·계약 → Drawer 폼). 연락 바(tel/mailto, 다음 연락일). 요약 카드 8개(예상매출, 최신 제안/최종금액, 계약 예정/확정, 다음 일정, 업무 현황, 마지막 활동, 담당, 관심사업). info=LeadForm 수정과 삭제(`deleteLead`). timing=OpportunityTimingForm(`upsertOpportunityTiming`, 빈 날짜는 deriveTimingDates로 자동 계산). schedules: 등록·수정·완료 토글·삭제. tasks: 등록, 완료 토글. 타임라인은 상담·일정·업무를 합쳐 보여주고 "자동" 분류와 필터 칩 제공 | 사용 중 |
| /leads/new | LeadForm: 거래처명(필수), 시설유형, 지역(datalist list_regions), 규모, 예상매출, 담당자명·연락처·이메일, 상태(기본 신규리드), 우선순위(기본 medium), 다음 연락일, 담당 영업자(admin만), 관심사업 칩, 실패/보류 사유(해당 상태일 때 필수), 메모. 중복 검사 `find_similar_leads`(2자 이상) → 유사 목록과 "그래도 새로 등록". 저장 시 upsert_region, lead_business_interests. INSERT 트리거가 "[첫 연락]" 업무(익일 마감)를 자동 생성 | 사용 중 |
| /leads/import | admin 전용. 7장 참고 | 사용 중 |
| ActivityList(수정/삭제) | 정의만 있고 상세 화면에서 쓰지 않음 | 미사용(코드만 있음) |

### 2-3. 영업기회 (/opportunities/*)

| 화면 | 보여주는 것 / 필터 / 액션 | 상태 |
|---|---|---|
| /opportunities (요약) | 허브 카드 6개: 지금 영업할 곳(원천별 건수), 입찰(즉시 검토 수, 7일 내 마감 수), 계약만료(12개월 내, 영업 단계 수, 가장 빠른 종료일), 신규단지(지금 영업, 후속조사), 준공·입주 시설(상태별 count), 협력사 등록(전체, 모집 공고 수). 데이터가 없으면 "DB 미적용". "목록별 진행 현황" 표(입찰·계약만료·신규단지·준공시설 × 7개 상태. 공고에 lead_id가 있으면 전환으로 셈. 준공시설은 연락 상태로 매핑). 모바일은 한 줄 카드, PC는 표. "지금 영업할 곳" 상위 40. "선행영업 · 거래처 연결" 표(lead_opportunity_timing, 버킷순 → 영업시작순. 열: 영업 적기, 시설, 운영사, 계약 종료, 영업 시작, 예상 공고, 발주 단계, 근거, 원문). 파라미터·버튼 없음 | 사용 중 |
| /opportunities/today (오늘 등록) | `?date=YYYY-MM-DD`(오늘 이하만 허용). 전날/다음날/오늘 이동과 날짜 입력. first_seen_at이 그날 KST 범위인 것: 관련 입찰(300건, 마감순, 중복 정리. 숨긴 건수는 표시 안 함), 협력사 모집(중복 정리 안 함), 신규단지(100), 준공·입주 시설(30, 세대순, 전체 count). 요약 4칸과 앵커. 카드 링크는 입찰 상세, 모집 공지 원문, 시설 목록. 시설 전화는 텍스트로만 표시. 버튼 없음 | 사용 중 |
| /opportunities/now (지금 영업) | loadOpportunityOverview.actions를 원천별 그룹(선행영업, 입찰, 계약만료, 신규건축, 운영시설)으로 표시. 운영시설은 상위 30건 + "외 N건"과 전체 목록 링크, 제외·완료 건수 안내. 5,000건 초과(truncated)나 0022 미적용이면 경고. 항목: 원천 배지, 제목, sub, "다음 조치(출처)", 전화(텍스트), 날짜 라벨 + D-day(신규 준공은 "N일 경과"). 버튼 없음 | 사용 중 |
| /opportunities/monitoring (입찰) | 아래 표 참고 | 사용 중 |
| /opportunities/contracts (계약만료) | `contract_expiry_sales_pipeline` 뷰. opportunity_work가 대상아님·미참여인 건은 숨김. 구간: 12개월 내 / 12개월 이후(기본 10건, `?show=all`이면 전체) / 종료됨(접힘, 최대 50). 요약 4칸(12개월 내, 재입찰 임박, 본격 제안, 지금 영업). 표: 단계 배지, 종료일과 D-day, 발주처·사업·대표 판단, 권장 영업시작·본격 제안·재입찰(도래하면 빨강), 원문·거래처 링크. 각 행 아래 OpportunityWork(kind=notice). 모바일은 가로 스크롤 표 | 사용 중 |
| /opportunities/buildings (신규단지) | `building_sales_pipeline` 읽기 전용(영업시작순 → 승인일 역순). 대상아님은 숨김. 그룹: 지금 영업 / 영업 예정 / 후속조사 필요(영업시작일 없음). 카드: 단계·유형·우선순위·"시점 추정치" 배지, 날짜 10종, 시행·시공·관리업체, 빠진 날짜 안내, 원문·첨부 링크. OpportunityWork(kind=building, 미참여 버튼 없음). **이 테이블에 쓰는 수집기는 코드에 없음** | 사용 중(화면) / 데이터 적재 경로 확인 필요 |
| /opportunities/facilities (준공·입주 시설) | operating_facility_prospects(excluded 제외). 필터: status(open=미연락·연락중 기본 / due=조치일 도래 / 4개 상태 / all), kind(recent=최근 548일 준공·입주 기본 / 아파트 / 기타(연립·다세대) / 공공체육시설 / 산업단지 / 호텔·리조트 / all), sido(17개 약칭, 정식 명칭 prefix도 매칭), q(40자), tel(all/yes), page(50건씩). 정렬: (due이면 조치일순) → 세대수 → 규모 → 이름. 상태 칩 4개 count. 행: lane 라벨, 유형·지역·세대·규모·현 위탁, 주소, "관리사무소 전화"(tel:), 출처, 시설, 등록일, 준공·입주·경과일, 다음 연락, 최근 기록(notes 마지막 줄), 다음 조치. ContactStatusButtons: 상태 4버튼(`set_prospect_contact_status`), "연락 기록"(메모 1000자 + 다음 연락일 → `set_prospect_followup`. 미연락 상태에서 메모를 쓰면 연락중으로), 진행영업 전환(`find_similar_leads` 중복 경고 → "그래도 새로 만들기" → `convert_prospect_to_lead`) 또는 "진행영업 보기" | 사용 중 |
| /opportunities/vendors (협력사 등록) | vendor_registrations(시드 139+25=164개사). 필터는 메모리에서 적용: cat, st(상태 또는 todo=다음 할 날 도래), q(회사·메모, 대소문자 구분). 요약 그리드(전체 + 5개 상태), "오늘 할 일 N곳" 배너, "공개모집 공지 확인된 곳" 칩. 카드: 구분, 회사, 순위, 상태, 모집 공지·시기·요건·공동인증서·비고, 매칭된 모집 공고 최대 2건(최근 200건의 procurement_notices 협력사 모집과 companyKey로 매칭), 등록 신청·포털·모집 공지·홈페이지 링크. VendorWork: 상태 5버튼(실패하면 롤백), 메모 2000자 + 다음 할 날 → `set_vendor_registration` | 사용 중 |

**/opportunities/monitoring (입찰) 세부**

| 항목 | 내용 | 상태 |
|---|---|---|
| 상세 보기 | `?notice=<id>`: NoticeCard(원문, 연락처, 대표 판단, 참가자격, 첨부) + OpportunityWork | 사용 중 |
| 탭 | `tab`: 진행 중(기본) / 완료(`tab=done`). 완료 = 미참여·대상아님 + 마감이 지난 공고(취소·낙찰 포함). `month=YYYY-MM` 또는 `none`(마감일 없음)으로 월별 보기 | 사용 중 |
| status | new(최근 등록순) / open(진행중, 기본: 마감 전이고 취소·낙찰·예정 제외) / upcoming(사전규격 '예정') / awarded(낙찰 결과) / closed(마감·취소) / all | 사용 중 |
| fit | related(관련, 기본) / 다짐 / 하이링크(둘 다 포함하는 공고 포함) / recruit(협력사 모집) / all(비관련 포함) | 사용 중 |
| class·work·q·page | class=분류(즉시 검토·협력사 필요·자격 미달·중장기 영업리드·참고(비관련)), work=진행 상태(기본 active는 대상아님 숨김), q=검색, page=50건씩 | 사용 중 |
| 정렬 | new: first_seen_at · awarded: award_date · recruit: posted_date · 그 외: deadline_at | 사용 중 |
| 중복 정리 | `dedupeNotices`: (기관·단지명 + 재공고·정정·차수 표기를 뺀 제목)이 같은 묶음에서 첨부가 많은 1건(같으면 최근 게시)만 남기고 "같은 공고 N건은 첨부 있는 공고로 합쳐 표시"라고 안내. **현재 페이지 50건 안에서만** 적용되므로 총 건수는 정리 전 기준. 나라장터 옛 차수는 DB 트리거(0037)가 별도로 처리 | 사용 중 |
| 요약 4칸 | 진행중(관련), 3일 내 마감, 오늘 등록(관련), 입찰 DB 전체 | 사용 중 |
| 목록 카드 | 배지 우선순위: 정정 전 공고 → 낙찰 → 협력사 모집 → 입찰 예정 → 마감/취소 → 오늘 마감 → D-3 → D-n. 적합·분류·출처 배지, 기관·지역·세대·분류, 낙찰 정보, 공고일·DB 등록일·키워드, 전화(tel:), 원문, "첨부 N건 받기", 마감 시각, OpportunityWork | 사용 중 |
| 상세 카드 | 연락처(관리사무소 전화·주소), 마감·예산·낙찰·추정가격·계약방식·기간, 대표 판단·영업 포인트·부족 자격, 접힘(과업·참가자격·실적·지역제한·면허·공동수급·현장설명회·제안발표), 원문·공고문·첨부 개별 다운로드, 거래처 보기 | 사용 중 |
| 원천 라벨 | kapt_bid K-apt, g2b_bid 나라장터, nuri_bid 누리장터, g2b_prespec 나라장터 사전규격, lh_bid LH, lh_prespec LH 사전규격, d2b_bid 국방, onbid_lease 온비드 임대, vendor_recruit 협력사 모집 | 사용 중 |
| 첨부 다운로드 | 나라장터 첨부는 `/api/bids/file?u=&n=`로 중계: 로그인 필요, 나라장터 첨부 경로만 허용, 30MB 상한, 리다이렉트 따라가지 않음, octet-stream 강제 다운로드. K-apt 첨부는 `/api/bids/kapt-file?bid=&seq=`: 서버가 K-apt 세션을 열어 그 공고의 첨부인지 확인한 뒤 전달, k-apt.go.kr 고정, 30MB. 둘 다 저장하지 않음 | 사용 중 |
| 진행 관리 | OpportunityWork: 상태 버튼(6장), 메모(2000자), 다음 연락일, "진행영업 전환" | 사용 중 |

### 2-4. 일정·업무·계약·성과·관리

| 화면 | 내용 | 상태 |
|---|---|---|
| /calendar | schedules. 기준일은 `?date=`, 월(기본)·주 보기는 `?view=month|week`(리스트 보기 없음). 조회 범위는 기준일 −14일 ~ +56일. 리드 next_contact_date를 "{회사} 연락"(점선, 계약완료·실패·보류 제외)으로 합성. 일요일 시작 그리드, 칸당 월 3건·주 12건 + "+N건 더", 칸마다 "+"(10:00) 버튼, 담당자 색 범례, 완료 일정은 흐리게+취소선. ScheduleForm(제목, 종류, 시작, 종료, 거래처, 장소, 메모, 담당자는 admin만) → `upsertSchedule`·`deleteSchedule`. 폼 기본 종류 "미팅"은 레거시 값(DB에서는 허용). 모바일 전용 처리 없음(7열 고정). 완료 토글 `toggleScheduleComplete`는 리드 상세 일정 탭에서 사용 | 사용 중 |
| /tasks | tasks + 하위업무 수. 필터: status, priority, owner(UI는 admin만), due(today/overdue/week), only_open(기본 미완료만, 0이면 전체), lead_id(선택된 거래처 바). 필터 칩과 전체 초기화. TaskCard: 배지, D-day(지연/오늘/D-n), 자동 배지, 거래처·담당·마감, 하위 진행률 바(클라이언트 계산) | 사용 중 |
| /tasks/[id] | 상세: 관련 리드·일정·마감 카드, 완료 토글, SubtaskList(체크, 인라인 제목 편집, 삭제, 추가), TaskForm 수정·삭제. schedule_id 연결 UI는 없음. `reorderSubtasks`는 UI에서 호출하지 않음 | 사용 중 |
| /tasks/new | `?lead_id=`가 있으면 리드를 고정. 기본값은 유형 기타, 상태 대기, 우선순위 보통. 저장하면 /tasks/{id}로 이동 | 사용 중 |
| /proposals | 읽기 전용 표(updated_at desc): 거래처, 사업, 제안일, 버전, 제안금액, 최종금액(final 또는 제안−할인), 월 운영비, 계약 예상일, 상태(작성중·발송완료·협의중·수락·거절) + "발송" 배지. 등록·수정은 리드 상세 탭의 ProposalForm: 사업, 제안일, 버전, 제안·할인·최종 금액, 월 운영비, 설치비, 계약 예상일, 상태, 발송완료 체크, 첨부, 비고. 첨부는 비공개 버킷 proposal-attachments, 경로 `proposals/{lead_id}/{timestamp}_{파일명}`, 브라우저에서 직접 업로드, 25MB 이하(타입 제한 없음), 교체·삭제 시 기존 객체 삭제, 다운로드는 signed URL 60초 | 사용 중 |
| /contracts | contracts(+리드, 사업, PM) 종료일순, live(active·suspended)가 위. KPI: 90일 내 / 180일 내 / 12개월 내 종료 / 기간 경과. 재계약 단계: 종료/해지 · 종료일 미입력 · 기간 경과 · 갱신 확인 · ≤90일 재계약 협의 · ≤180일 재계약 준비 · ≤365일 관계 유지 · 운영중. 표: 단계, 종료일과 D-day, 거래처/사업, 금액(+예정), 기간·운영시작, PM, 상태, 재입찰 연동(선행영업 상태·공고 예상일·연결 공고 수). "타사 계약만료 · 재입찰 →" 링크. 등록·수정은 리드 상세의 ContractForm(사업, 예정금액, 확정금액, 상태, 시작·종료·운영시작, PM, 특이사항) | 사용 중 |
| /contracts/roi | `?p=3|6|12`(기본 6개월), `?biz=all|다짐|하이링크`. 1000행씩 페이지 조회. summarizeRoi: 계약 귀속월 = start_date 또는 created_at(KST), 매출 = contract_amount 합, ROI = (매출−비용)/비용(비용이 0이면 "비용 입력 필요"), 계약당 비용, 전환율(기간 내 등록 리드 중 현재 계약완료 비율), 평균 소요일, 퍼널(등록/연락/제안/계약), 월별, 사업별(다짐/하이링크/미분류 + 공통 비용 행), 채널별. biz 필터를 걸면 '공통' 비용은 제외. bySource: "운영시설 DB"(operating_facility_prospects.lead_id) → "입찰 DB"(procurement_notices.lead_id) → 나머지 "직접 등록". 신규단지 출처는 없음. 영업비용 입력(CostForm: 월, 사업, 항목, 금액(정수, 1000억 미만), 메모 200자 → `addSalesCost`. 삭제 `deleteSalesCost`는 본인 또는 admin). 최근 비용 50건 | 사용 중 |
| /settings | admin 전용. 설정 홈(카테고리·지역·사용자·자동수집 링크) | 사용 중 |
| /categories | admin. 사업 카테고리 CRUD(`upsertCategory`, `deleteCategory`): 이름, 설명, 사업유형, 기본단가, 정렬, 활성 | 사용 중 |
| /regions | admin. 지역 CRUD(`upsertRegion`, `deleteRegion`): 이름, 정렬, 활성 | 사용 중 |
| /users | admin. profiles 목록. 행 단위 인라인 수정(이름, 역할 admin/sales, 연락처, 활성) → `updateUser`(일반 세션, RLS). 초대·생성·삭제·비밀번호 기능 없음. 계정은 Supabase Auth에서 발급하고, 로그인 화면에 "계정 발급은 관리자에게 요청" 안내 | 사용 중 |
| /settings/collectors | admin. data_source_master 목록(enabled, 일정, 마지막 실행), data_source_run 최근 이력, Vercel 환경변수 설정 여부 점검(NEXT_PUBLIC_SUPABASE_URL, CRON_SECRET, SUPABASE_EDGE_FUNCTION_BASE, KAPT_SERVICE_KEY, MOLIT_BUILDING_HUB_KEY), 수동 실행 버튼(TriggerButton → 서버 액션 `triggerCollectorRun`이 서버에서 CRON_SECRET으로 /api/collectors/[slug]/run 호출), curl 안내 | 사용 중 |
| /login | 이메일+비밀번호(`signInWithPassword`). 오류 메시지는 한국어로 바꿔 표시 | 사용 중 |
| /auth/signout | 로그아웃 route handler. `?reason=inactive`이면 비활성 계정 안내 | 사용 중 |

### 2-5. API 라우트

| 경로 | 메서드 | 기능 | 상태 |
|---|---|---|---|
| /api/collectors/[slug]/run | GET(cron), POST(수동, JSON params) | Bearer CRON_SECRET 검증(trim, SHA-256 + timingSafeEqual). 수집기 실행 후 runId와 건수 반환. x-vercel-cron 헤더가 있으면 triggered_by=cron. maxDuration 60 | 사용 중 |
| /api/leads/export | GET | CSV 내보내기(7장) | 사용 중 |
| /api/bids/file | GET | 나라장터 첨부 중계 | 사용 중 |
| /api/bids/kapt-file | GET | K-apt 첨부 중계 | 사용 중 |
| /api/ai/chat | POST | AI 대화 | 사용 중 |
| /api/ai/status | GET | AI 사용 가능 여부와 남은 횟수 | 사용 중 |
| /api/ai/proposals/[id] | POST | AI 제안 확인/취소 | 사용 중 |
| /api/health | GET | 상태·빌드 커밋 | 사용 중 |
| /auth/signout | GET | 로그아웃 | 사용 중 |

---

## 3. 데이터 테이블

**실제 개수: 테이블 27개 + 뷰 2개 = 29개.** 요청에서 예상한 "21"과 다릅니다. 이 밖에 Storage 버킷 1개(proposal-attachments)가 있습니다.

### 3-1. 테이블

| # | 테이블 (마이그레이션) | 주요 컬럼 | 용도 | 상태 |
|---|---|---|---|---|
| 1 | profiles (0001) | id(=auth.users), email, full_name, role(admin/sales), phone, active | 사용자 | 사용 중 |
| 2 | business_categories (0001) | name(unique), business_type(다짐/하이링크), default_unit_price, sort_order, active. 시드 7개 | 관심 사업 카테고리 | 사용 중 |
| 3 | leads (0001, 0008, 0019) | company_name, facility_type(16종), region, scale, contact_*, sales_status(11종), status_reason, priority, expected_revenue, next_contact_date, memo, owner_id | 거래처·진행영업 원본 | 사용 중 |
| 4 | lead_business_interests (0001) | (lead_id, category_id) | 리드↔카테고리 N:M | 사용 중 |
| 5 | sales_activities (0001, 0014) | lead_id, activity_date, method(전화·문자·이메일·방문·미팅·메모·기타), content, customer_request, next_action, next_contact_date, author_id | 상담·자동 로그 | 사용 중 |
| 6 | proposals (0001, 0014) | lead_id, category_id, proposal_amount, monthly_fee, setup_fee, discount_amount, final_amount, version, proposal_date, expected_contract_date, sent, status(draft/sent/negotiating/accepted/rejected), attachment_url, notes | 제안/견적 | 사용 중 |
| 7 | contracts (0001, 0014) | lead_id, category_id, contract_amount, expected_amount, start/end/operation_start_date, status(active/suspended/expired/terminated), pm_id, notes | 계약 | 사용 중 |
| 8 | regions (0007) | name(unique), sort_order, active | 지역 마스터 | 사용 중 |
| 9 | schedules (0009, 0010) | lead_id, owner_id, title, kind(방문일정·1차연락·2차연락·후속연락·제안서전달·계약미팅·기타 + 레거시 미팅·현장방문·제안PT·계약), starts_at, ends_at, location, notes, completed_at, google_calendar_event_id | 일정(외부 약속) | 사용 중 (google_calendar_event_id는 미사용) |
| 10 | tasks (0012) | title, description, task_type(10종), status(대기·진행중·검토필요·완료·보류·지연), priority(긴급·높음·보통·낮음), due_date, completed_at, owner_id, lead_id, schedule_id, created_by, auto_generated | 업무(내부 할 일) | 사용 중 |
| 11 | task_subtasks (0012) | task_id, title, is_completed, sort_order | 하위업무 | 사용 중 |
| 12 | lead_opportunity_timing (0015) | lead_id(unique), facility_category, 준공·입주·입대의 날짜(실제/예정), current_operator, management_company, incumbent_contract_start/end, expected_bid_date, sales_start_date, proposal_start_date, source_*, procurement_status(발굴~계약완료 9종), timing_confidence, qualification_gap, competitors, sales_reason, notes | 리드별 선행영업 타이밍 | 사용 중 |
| 13 | procurement_monitoring_runs (0016) | run_date, started_at, completed_at, summary, 건수 3종 | 옛 모니터링 실행 이력. 앱은 마지막 실행만 읽고 쓰는 코드는 없음 | 미사용(코드만 있음) — 읽기만 |
| 14 | procurement_notices (0016, 0025, 0029, 0037) | source_type, source_external_id, source_url, attachment_urls(jsonb), issuer, facility_name, title, region, notice_type, classification, fit_business, matched_keywords, related, posted_date, deadline_at, budget/estimated_amount, contract_*, current_status(예정·진행중·마감임박·마감·취소·낙찰·장기추적·정정됨), bid_system, award_method, notice_state, bid_category, office_phone/fax/address, household_count, winner_name/amount, award_date, 수동 필드(representative_judgment, qualification_gap, sales_point 등), lead_id, first/last_seen | 입찰·위탁 공고 마스터 | 사용 중 |
| 15 | procurement_notice_observations (0016) | run_id, notice_id, observed_* | 공고 관측 스냅샷. 앱·수집기 모두 사용하지 않음 | 미사용(코드만 있음) |
| 16 | building_sales_pipeline (0018) | project_name, building_type, 인허가·착공·준공·입주 날짜, household_count, developer, constructor, current_stage, sales_start/proposal_start, sales_priority 등 | 신규단지 선행영업. 화면은 읽기만 하고 쓰는 코드는 없음 | 사용 중(읽기) / 적재 확인 필요 |
| 17 | data_source_master (0020) | slug, display_name, provider, base_url, requires_auth, auth_env_var, fallback_mode, enabled, schedule_cron, last_run_at | 수집 소스 카탈로그 | 사용 중 |
| 18 | data_source_run (0020) | source_slug, started/completed_at, status(running/success/failed/partial), provider_mode, triggered_by, 건수 4종, error_log, summary | 수집 실행 이력 | 사용 중 |
| 19 | data_source_observation (0020) | run_id, target_table, target_id, external_id, action(insert/update/skip_no_change/error/skip_filtered), change_summary | 레코드 단위 변경 로그(Edge만 기록, 화면 표시 없음) | 사용 중(기록만) |
| 20 | kapt_vendor_selection (0020) | complex_code·name, address, region, household_count, task_category·detail, selected_vendor, selected_amount, contract_start/end, verification_status, lead_id | K-apt 사업자선정 결과 원본 | 사용 중 (KAPT_SERVICE_KEY가 없으면 적재되지 않음) |
| 21 | user_saved_filters (0021) | user_id, path, name, search_params(jsonb), unique(user,path,name) | 저장 필터 | 사용 중 |
| 22 | operating_facility_prospects (0022–0024, 0027) | dedupe_key(unique), facility_type(8종), name, region, address, operating_status(운영중·입주중·준공·입주예정·미확인), completion/move_in_date, household_count, facility_scale·unit, management_company, current_operator, contract_*, source_*, sales_likelihood(상·중·하·미확인)·reason, etl_suggested_next_action, office_phone/fax, kapt_code, amenities, 수동 필드(next_action, next_action_date, notes, assigned_to, lead_id, verification_status, contact_status(미연락·연락중·영업완료·대상아님), contact_updated_*) | 준공·운영 시설 위탁 잠재수요 | 사용 중 |
| 23 | sales_costs (0028) | cost_month(1일), business_type(다짐·하이링크·공통), channel(광고·인건비·영업활동비·입찰·제안·기타), amount, memo, created_by | ROI용 영업비용 | 사용 중 |
| 24 | opportunity_work (0032, 0036) | kind(notice/building), ref_id, work_status(7종), memo(≤2000), next_date, lead_id, unique(kind,ref_id) | 공고·신규단지 진행 관리 | 사용 중 |
| 25 | vendor_registrations (0033, 0034) | sort_no, category(시공사·시행사·공공 시행자·신탁사·관리주체·기타), company(unique), rank_label, homepage/portal/register/recruit_url, recruit_visibility·timing, requirements, cert_required, note, status(5종), memo, next_date | 협력사 등록 관리. 시드 139+25 | 사용 중 |
| 26 | ai_usage (0035) | user_id, model, purpose, input/output_tokens, cost_usd | AI 사용량 | 사용 중 |
| 27 | ai_proposals (0035) | user_id, kind(5종), payload, summary, status(pending/accepted/rejected/failed), result_link, decided_at | AI 변경 제안 | 사용 중 |

### 3-2. 뷰

| 뷰 | 정의 | 상태 |
|---|---|---|
| active_sales_leads (0015 → 0026) | security_invoker. leads 중 상태가 신규리드·1차연락완료·미팅예정·현장방문완료·제안서작성중·제안서발송완료·견적협의·계약검토·보류인 것 | 사용 중 |
| contract_expiry_sales_pipeline (0018) | security_invoker. procurement_notices 중 contract_end_date가 있는 공고. 권장 영업시작 = 종료 −12개월(notice_type에 아파트·커뮤니티·위탁·체육 포함) 또는 −9개월(그 외), 본격 제안 = −6개월, 재입찰 예상 = −3개월 | 사용 중 |

### 3-3. RPC 함수

| 함수 | 목적 | R/W | 보안 | 상태 |
|---|---|---|---|---|
| is_admin() | 활성 admin 여부 | R | definer | 사용 중 |
| can_access_lead(uuid) | admin이거나 리드 owner인지 | R | definer | 사용 중 |
| owner_summary() | 담당자별 리드·계약·진행·연락예정·예상매출 | R | invoker | 미사용(코드만 있음) — 확인 필요 |
| region_summary() | 지역별 집계 | R | invoker | 미사용(코드만 있음) — 확인 필요 |
| list_regions() | 활성 지역 이름(0007부터 regions 테이블 기준) | R | invoker | 사용 중 |
| upsert_region(text) | 지역 자동 추가 | W | invoker | 사용 중 |
| category_summary() | 카테고리별 집계 | R | invoker | 미사용(코드만 있음) — 확인 필요 |
| stale_leads(days) | N일 이상 활동이 없는 진행 리드 50건 | R | invoker | 사용 중 |
| find_similar_leads(text) | 회사명이 비슷한 리드 5건(RLS를 무시하고 전체에서 검색) | R | definer | 사용 중 |
| leads_last_activity() | 리드별 마지막 활동일 | R | invoker | 사용 중 |
| upcoming_schedules(days) | -60일 ~ +N일 일정 500건 | R | invoker | 사용 중 |
| dashboard_kpi() | KPI 10개(KST 기준) | R | invoker | 사용 중 |
| task_progress(uuid) | 하위업무 진행률(앱은 클라이언트에서 같은 로직으로 계산) | R | invoker | 미사용(코드만 있음) |
| leads_task_summary() | 리드별 미완료·지연·오늘 업무 수 | R | invoker | 사용 중 |
| leads_pipeline_summary() | 리드별 최신 제안, 활성 계약, 다음 일정, 마지막 활동 | R | invoker | 사용 중 |
| set_prospect_contact_status(id,status) | 운영시설 연락 상태 변경 | W | definer(활성 사용자) | 사용 중 |
| set_prospect_followup(id,status,note,next_date) | 상태, 최근 메모(next_action), 메모 누적(notes에 KST 시각 포함), 다음 연락일. 메모 1000자 | W | definer | 사용 중 |
| convert_prospect_to_lead(id) | 운영시설을 리드로 전환(행 잠금, 이미 전환됐으면 기존 리드 반환. 연락중이면 1차연락완료, 아니면 신규리드. 미연락이면 연락중으로 변경) | W | definer | 사용 중 |
| set_opportunity_work(kind,ref,status,memo,next,clear_next) | 진행 상태 upsert. '진행영업 전환'은 거부하고, 이미 전환된 건은 상태를 되돌리지 않음. null 인자는 기존 값 유지 | W | definer | 사용 중 |
| convert_opportunity_to_lead(kind,ref) | 공고·신규단지를 리드로 전환. 공고는 procurement_notices.lead_id도 연결. 시설유형·우선순위·메모(입찰명·마감·낙찰·원문·메모·출처) 자동 작성 | W | definer | 사용 중 |
| set_vendor_registration(id,status,memo,next,clear_next) | 협력사 등록 상태 변경 | W | definer | 사용 중 |
| ai_month_cost() | 이번 달(KST) 전체 AI 비용 | R | definer | 사용 중 |
| g2b_ord_of(text), g2b_no_of(text) | 나라장터 '공고번호-차수' 분해 | R | immutable | 사용 중 |

### 3-4. 트리거

| 트리거 | 동작 | 상태 |
|---|---|---|
| trg_*_updated (profiles, categories, leads, activities, proposals, contracts, regions, schedules, tasks, subtasks, timing, notices, building, data_source_master, kapt_vendor, saved_filters, ofp, sales_costs) | updated_at 갱신 | 사용 중 |
| on_auth_user_created | 가입하면 profiles(role=sales) 생성 | 사용 중 |
| trg_lead_status_log | 상태가 바뀌면 sales_activities에 "영업 상태 변경: A → B (사유: …)" 기록 | 사용 중 |
| trg_lead_owner_log | 담당자가 바뀌면 "담당자 변경: A → B" 기록 | 사용 중 |
| trg_lead_first_task | 리드가 INSERT되고 owner가 있으며 상태가 신규리드이면, "[첫 연락] {회사}" 업무(우선순위 높음, 익일 마감, auto_generated)와 활동 로그를 생성 | 사용 중 |
| g2b_supersede_before (0037) | g2b_bid에 같은 공고번호의 더 높은 차수가 있으면 related=false로 하고, 상태가 낙찰·취소가 아니면 '정정됨'으로 변경 | 사용 중 |
| g2b_supersede_after (0037) | 최신 차수가 들어오면 옛 차수의 opportunity_work(상태·메모·다음일·리드)와 lead_id를 최신 차수로 옮기고, 옛 차수를 다시 갱신해 before 트리거로 정리. 마이그레이션에서 이미 쌓인 데이터도 한 번 정리 | 사용 중 |

### 3-5. RLS 원칙

| 대상 | 정책 | 상태 |
|---|---|---|
| leads | admin은 전체, sales는 owner_id=본인인 것만 CRUD | 사용 중 |
| 리드 하위(lead_business_interests, sales_activities, proposals, contracts, lead_opportunity_timing) | can_access_lead(lead_id) | 사용 중 |
| schedules | admin, owner 본인, 접근 가능한 리드에 연결된 일정 | 사용 중 |
| tasks / task_subtasks | admin, owner, created_by, 접근 가능한 리드. 하위업무는 부모를 따름 | 사용 중 |
| profiles | 로그인 사용자 전원 읽기, 본인 또는 admin만 수정 | 사용 중 |
| business_categories | 읽기는 전원, 쓰기는 admin | 사용 중 |
| regions | 읽기 전원, insert는 로그인 사용자 누구나, update·delete는 admin | 사용 중 |
| 수집 데이터(procurement_*, building_sales_pipeline, data_source_*, kapt_vendor_selection, operating_facility_prospects) | 활성 사용자는 읽기만. 쓰기는 service_role(Edge) 또는 definer RPC만 | 사용 중 |
| opportunity_work, vendor_registrations | 활성 사용자 읽기. 쓰기는 definer RPC만(직접 쓰기 정책 없음) | 사용 중 |
| sales_costs | 활성 사용자 읽기. insert는 본인(created_by), update·delete는 작성자 또는 admin | 사용 중 |
| user_saved_filters | 본인 것만 | 사용 중 |
| ai_usage | insert는 본인(활성), select는 본인 또는 admin | 사용 중 |
| ai_proposals | 본인 것만 select·insert·update | 사용 중 |
| storage proposal-attachments | 로그인 사용자 누구나 read·upload·update·delete(리드 소유와 무관) | 사용 중 |

---

## 4. 수집기 (lib/collectors/registry.ts, 12개)

공통 흐름
- Vercel cron이 `GET /api/collectors/{slug}/run`을 호출합니다(Bearer CRON_SECRET).
- runner가 `start_run` → `collector.run` → `complete_run`(status: success / partial / failed) → `touch_source_master` 순으로 실행합니다.
- DB 쓰기는 전부 Edge `collector-write`를 거칩니다.
- 수동 필드는 덮어쓰지 않고, 원천 값이 null이면 기존 값을 지우지 않습니다.
- cron은 UTC 기준이며, 아래 KST는 +9시간한 값입니다.

| # | slug | 원천 | cron(UTC) → KST | 적재 테이블 | 조건·규칙 | 필요한 env 이름 | 상태 |
|---|---|---|---|---|---|---|---|
| 1 | kapt_sa_sun | K-apt 사업자선정 결과 OpenAPI(apis.data.go.kr/B553530/kaptBidResult, KAPT_API_BASE로 변경 가능) | 0 23 * * * → 매일 08:00 | kapt_vendor_selection | 최근 18×30일. 키가 없으면 건너뜀(오류 0건, summary에 안내) | KAPT_SERVICE_KEY, KAPT_API_BASE(선택) | 사용 중(키 등록 여부 확인 필요) |
| 2 | operating_from_kapt | DB 내부 파생(외부 호출 없음) | 30 23 * * * → 08:30 | operating_facility_prospects | kapt_vendor_selection 중 KAPT_RELEVANT_TASK(커뮤니티·주민공동·피트니스·헬스·운동·체육·골프·수영·사우나·GX·필라테스·요가·독서실·위탁운영)인 것만 → 아파트·운영중, 단지코드를 dedupe 키로 사용. limit 500 | (없음) | 사용 중 |
| 3 | kicox_industrial_complexes | 한국산업단지공단 전국산업단지현황통계 CSV(CP949) 4종(국가·일반·농공·도시첨단). data.go.kr 페이지에서 최신 파일 URL을 확인하고, 실패하면 fallback | 0 22 * * * → 07:00 | operating_facility_prospects | 합계행 제외. 조성 완료 → 운영중, 조성중이면서 가동>0 → 입주중, 가동 0 → 입주예정, 미개발은 제외. 규모 = 가동업체 수 | (없음) | 사용 중 |
| 4 | public_sports_facilities | 문체부 전국 공공체육시설 현황 XLSX(자체 리더) | 15 22 * * * → 07:15 | operating_facility_prospects | 시트: 수영장·생활체육관·구기체육관·골프연습장·빙상장. 관리주체에 '위탁'이 있으면 current_operator를 추출, 직영·공단이면 위탁 없음을 명시. 규모 = 연면적㎡. 준공 연도는 scale_note에만 기록. 순환 적재 | PUBLIC_SPORTS_FILE_URL(선택) | 사용 중 |
| 5 | tourist_hotels_localdata | 행안부 관광숙박업 조회 OpenAPI(apis.data.go.kr/1741000/tourist_accommodations/info) | **cron 없음**(seed enabled=false) | operating_facility_prospects | 영업/정상(01)만. 하루 12쪽(1,200건)씩 순환. 0건이면 실패로 처리 | DATA_GO_KR_SERVICE_KEY | 미사용(코드만 있음) |
| 6 | reb_recent_complexes | 한국부동산원 공동주택 단지 식별정보 CSV(약 40MB, UTF-8/EUC-KR 자동 판별) | 30 22 * * * → 07:30 | operating_facility_prospects | 사용승인일이 최근 548일(18개월) 이내인 단지만 → 입주중. 연립·다세대는 기타. K-apt 단지 정보로 관리사무소 전화·팩스·입주월·시설 보강(PNU 법정동+번지로 매칭, 최대 900건). 이후 카카오 로컬로 관리사무소 전화 보강(같은 시군구, 이름 포함, 전화가 있는 결과가 유일할 때만) | KAKAO_REST_API_KEY(선택) | 사용 중 |
| 7 | kapt_bid_notices | K-apt 전국 입찰공고 HTML(k-apt.go.kr/bid/bidList.do, K-APT·조달청·민간 전자입찰 통합) | 45 21 * * * → 06:45 | procurement_notices(source_type kapt_bid) | 100건씩 최대 40쪽 전체를 적재(비관련은 참고(비관련)). matchFit(제목+'공동주택')에 걸린 공고는 상세(최대 150건)에서 전화·팩스·주소·세대수·분류·내용·첨부를 가져옴. 관련 공고를 먼저 쓰고 250건씩 나눠 씀. 52초 예산 | (없음) | 사용 중 |
| 8 | g2b_bid_notices | 조달청 나라장터(BidPublicInfoService) + 누리장터(PrvtBidNtceService), 용역·물품 4개 대상 | 30 21 * * * → 06:30 | procurement_notices(g2b_bid, nuri_bid) | 최근 14일, 검색어 15개(피트니스·헬스·체력단련·스포츠센터·체육센터·체육시설·수영장·골프·커뮤니티·주민공동·위탁운영·출입통제·안면인식·키오스크·회원관리) × 4대상, 4병렬. external_id = '공고번호-차수'. 첨부 최대 10개. 키가 없으면 '건너뜀' | DATA_GO_KR_SERVICE_KEY | 사용 중 |
| 9 | g2b_prespec_awards | 나라장터 사전규격(HrcspSsstndrdInfoService, ServiceKey) + 낙찰정보(ScsbidInfoService) | 40 21 * * * → 06:40 | procurement_notices(g2b_prespec는 '예정', g2b_bid는 낙찰 병합) | 사전규격은 최근 4일 전체를 받아 matchFit으로 거름. 낙찰은 검색어로 최근 28일과, 매일 돌아가며 지난 1년 중 한 달. merge_scope='award'이면 낙찰 필드만 갱신. 서비스별로 따로 실패 처리 | DATA_GO_KR_SERVICE_KEY | 사용 중 |
| 10 | kapt_bid_results | K-apt 입찰결과 HTML(bidResultListAjax, 세션 쿠키 + _csrf, sortType=01) | 55 21 * * * → 06:55 | procurement_notices(kapt_bid 낙찰 병합 또는 신규) | 검색어 18개(헬스·피트니스·운동기구·커뮤니티·주민공동·주민운동·체력단련·GX·골프·수영·사우나·위탁운영·위탁 운영·출입통제·출입관리·안면인식·키오스크·무인), 최근 1년. 관련 없는 결과는 적재하지 않음 | (없음) | 사용 중 |
| 11 | public_agency_bids | LH 입찰공고(B552555/OpenBidInfoList, 최근 7일), LH 사전규격(의견마감 오늘~+30일), 방위사업청 경쟁입찰(최근 30일, 검색어 9개), 온비드 공유재산 임대(+90일 개찰, 검색어 7개) | 50 21 * * * → 06:50 | procurement_notices(lh_bid, lh_prespec, d2b_bid, onbid_lease) | matchFit에 걸린 건만. 활용신청이 안 된 서비스(SERVICE ACCESS DENIED 등)는 '활용신청 필요'로 기록. 웹 스크래핑 없음(d2b·KISCON robots 금지) | DATA_GO_KR_SERVICE_KEY | 사용 중 |
| 12 | vendor_recruit_watch | 시공사·시행사 공지 페이지 21곳(VENDOR_WATCH_PAGES, 로그인 불필요한 곳만) | 10 22 * * * → 07:10 | procurement_notices(vendor_recruit, notice_type '협력사 모집') | RECRUIT_RE(협력업체·회사·사, 파트너사, 신규업체, 업체등록, 정기등록 … 모집/등록/공개/접수/신청/안내)로 표·목록·링크를 검사. 사이트당 최대 30건. external_id = 회사 해시 + 제목 해시. EUC-KR 지원 | (없음) | 사용 중 |

**data_source_master 카탈로그 중 수집기 코드가 없는 소스**

0020 시드의 kapt_complex_basic, molit_building_hub, data_go_kr_public_files, lh_project_list, univ_facility_tenders, kicox_industrial이 여기에 해당합니다. enabled=true로 시드됐지만 registry와 cron에 없어 실행되지 않습니다. 상태: 미사용(코드만 있음). `lib/collectors/kapt_complex.ts`는 독립 수집기가 아니라 reb 수집기의 보강용 모듈입니다.

### 4-1. 적합 분류 matchFit (`supabase/functions/_shared/procurement.ts`)

| 규칙 | 내용 | 상태 |
|---|---|---|
| DAGYM_KEYWORDS | 피트니스, 휘트니스, 헬스, 헬스장, 운동시설, 주민운동, 체력단련, 스포츠센터, 체육센터, 국민체육센터, 생활체육, 실내체육관, 체육시설, 수영장, 사우나, 목욕탕, 골프연습장, 골프장, 스크린골프, 골프, GX, 필라테스, 요가, 스피닝, 줌바, 커뮤니티, 주민공동시설, 주민공동, 부대복리시설, 독서실, 도서관, 작은도서관, 게스트하우스, 카페, 조식, 위탁운영, 운영위탁, 운영업체, 강사 | 사용 중 |
| HILINK_KEYWORDS | 출입통제, 출입관리, 출입시스템, 출입구축, 출입장치, 자동출입, 통합보안, 안면인식, 얼굴인식, 생체인식, 스피드게이트, 스피드 게이트, 게이트, 키오스크, 무인, 회원관리, 예약시스템, 예약 시스템, 통합관리시스템, 커뮤니티시스템, 커뮤니티 시스템, 커뮤니티 프로그램, 타석, 골프타석, 타석관제, 오토티업, RFID, 카드리더, 락커, 사물함, IoT | 사용 중 |
| EXCLUDE_TOPICS | 하나라도 있으면 적합 아님: 어린이집, 보육, 알뜰, 장터, 야시장, 자판기, 주차관제, 주차장, 음식물, 종량기, 재활용, 택배, 이동통신, 중계기, 헬스케어, 구내식당, 급식, 매점, 학위복, 방과후, 영어마을, 정보시스템, 전산, 선거, 투표, 돼지, 가축, 축산, 양돈, 농장, 개체식별, 해외연수, 바이오헬스, 헬스산업, 조기경보, 재난, 하천, 임대공실, 공실, 점포, 장서 | 사용 중 |
| NOISE_KEYWORDS | 도장, 방수, 보수공사, 공사, 청소, 소독, 경비, 승강기, 전기, 소방, 도색, 조경, 수목, 전지, 급수, 배관, 누수, 하자, 옥상, 외벽, 주차, 차단기, CCTV, 보험, 회계감사, 감사, 변압기, 택배, 리모델링, 바닥재, 인테리어, 교체. 이 단어가 있으면 넓은 단어(WEAK)만으로는 적합 판정하지 않음 | 사용 중 |
| WEAK | 커뮤니티, 주민공동시설, 주민공동, 부대복리시설, 카페, 강사, 골프, 게이트, 무인, 도서관, 운영업체, IoT, 락커, 사물함, 통합관리시스템. 강한 단어가 없으면, 잡음 단어가 없고 APT_CONTEXT가 있을 때만 인정 | 사용 중 |
| APT_CONTEXT | /아파트\|단지\|주민\|입주\|공동주택\|커뮤니티\|관리사무소\|오피스텔\|레지던스/ (K-apt 공고는 '공동주택'을 함께 넘김) | 사용 중 |
| DIRECT | 위탁운영·운영위탁·운영업체·운영사업자·운영자·위탁용역·출입통제·출입시스템·출입구축·출입장치·자동출입·통합보안·안면/얼굴인식·키오스크·회원관리·예약시스템·타석·스크린골프·커뮤니티시스템 → direct(즉시 검토) | 사용 중 |
| CONSTRUCTION_RE | 공사·관급자재·설계·감리·측량·폐기물·골재·건립·신축·증축·개축·철거·타일·안전진단·기술지도·시공(제목만 검사), 또는 나라장터 분류가 '공사'이면, DIRECT가 아닌 한 다짐에서 제외. 하이링크 판정은 유지 | 사용 중 |
| FACILITY_SERVICE_RE | 청소·경비·소독·방역·안전점검·정기점검·점검용역·제습·공조기·냉난방·보일러·여과기·승강기(제목) → DIRECT가 아니면 다짐에서 제외 | 사용 중 |
| OPERATION_ONLY | 위탁운영, 운영위탁, 운영업체, 강사, 조식만 걸린 경우 다짐 아님(시설 단어가 필요) | 사용 중 |
| 결과 | fit_business = 다짐 / 하이링크 / 다짐·하이링크 / null. matched_keywords. 띄어쓰기 무시 비교, 긴 단어에 포함된 짧은 단어는 하나로 셈 | 사용 중 |

### 4-2. 분류·상태·병합

| 규칙 | 내용 | 상태 |
|---|---|---|
| initialClassification(최초 적재 때만) | 협력사 모집 → 즉시 검토. fit 없음 → 참고(비관련). direct → 즉시 검토. 그 외 → 중장기 영업리드. 이후 수집기는 classification을 바꾸지 않음(담당자 판단 존중). DB 허용값에는 협력사 필요·자격 미달도 있음(수동용) | 사용 중 |
| related | fit이 있거나, 협력사 모집이면서 오래되지 않은 공고(staleRecruit: 제목의 연도가 작년보다 이전이거나 게시 후 400일 초과)이면 true | 사용 중 |
| noticeStatus | 취소공고 → 취소. 낙찰자 있음 → 낙찰. 사전규격·발주계획 → 예정. 마감이 지남 → 마감. 3일 이내 → 마감임박. 그 외 → 진행중. 원천 시각은 +09:00으로 저장하고, 시각이 없으면 23:59 | 사용 중 |
| planNoticeBatch | (source_type, external_id) 키. 같은 실행 안의 중복은 첫 건만. 신규는 insert(attachment_urls 기본 []). 기존 건은 PROCUREMENT_ETL_FIELDS 중 새 값이 있고 달라진 것만 patch(fit_business와 matched_keywords는 null로도 갱신). 이미 낙찰된 공고는 재수집으로 상태가 되돌아가지 않음. award 범위는 winner_name·winner_amount·award_date·current_status만. 바뀐 게 없으면 last_seen만 갱신. 첨부는 http(s) 또는 /api/bids/*만, 최대 20개 | 사용 중 |
| 운영시설 병합(planBatch/planMerge) | dedupe_key = 업종\|정규화 이름\|시도약칭+시군구, 원천 코드가 있으면 code:값. 배치 안의 중복은 계약종료일이 가장 늦은 것을 남김. ETL_OWNED_FIELDS만 갱신하고 MANUAL_FIELDS는 건드리지 않음. null은 기존 값 유지(예외: operator_explicitly_none). 관측시각 등 사소한 변화는 skip | 사용 중 |

---

## 5. 입찰·RFP 예측 로직

| 로직 | 내용 | 상태 |
|---|---|---|
| deriveTimingDates (lib/pre-rfp-timing.ts) | ① 기존 계약 종료일 기준: 공공(공공체육시설·시설관리공단·지자체)이나 아파트·오피스텔이면 영업시작 −12개월, 그 외 −9개월. 제안 −6개월, 예상 공고 −3개월. ② 아파트·오피스텔이면서 입주(예정)일 기준: 영업 −9개월, 제안 −6개월. ③ 공공이면서 준공(예정)일 기준: 영업 −12개월, 제안 −9개월, 공고 −4개월. ④ 그 밖에 준공 또는 입주가 있으면: 영업 −9개월, 제안 −6개월. 사람이 입력한 날짜를 우선하고, 월말은 보정 | 사용 중 |
| getTimingBucket | 상태가 공고중 → 공고중. 공고임박 → 지금 접촉. 마감·계약완료 → 종료. 예상 공고 ≤30일 → 공고 임박(0). 제안 시작이 지남 → 지금 접촉(1). 영업 시작이 지남 → 지금 접촉. ≤30일 → 30일 이내(2). ≤90일 → 90일 이내(3). 그 외 관찰(4) | 사용 중 |
| 계약만료 단계 | 뷰: 영업시작 −12개월(아파트·커뮤니티·위탁·체육) 또는 −9개월, 제안 −6개월, 재입찰 −3개월. contractExpiryStage: 종료 지남 → 계약 종료됨(5). 재입찰일 도래 → 재입찰 임박(0). 제안일 도래 → 본격 제안(1). 영업일 도래 → 지금 영업(2). 그 외 → 영업 대기(3) | 사용 중 |
| 신규단지 영업 시작 | building_sales_pipeline.sales_start_date ≤ 오늘이면 '지금 영업'(urgent는 rank 1, 그 외 2). 날짜가 비어 있으면 후속조사(buildingMissingDates: 승인일, 준공(예정), 입주(예정), 영업시작일) | 사용 중 |
| 운영시설 lane (prospect-assessment.ts) | 제외(excluded 또는 영업완료·대상아님) → 계약갱신 6개월(종료 D-0~180, rank: ≤60일이면 0, ≤120일이면 1, 그 외 2) → 입주·준공 6개월(예정 D-0~180, ≤90일이면 1, 그 외 2) → 신규 준공 단지(준공·입주 후 1~548일, ≤180일이면 1, 그 외 2) → 운영중 위탁검토(운영중·입주중이면서 가능성 상·중, rank 3) → 후속조사 필요(5). 수동 조치일이 오늘 이전이면 rank 0. 화면 라벨: 계약 종료 6개월 전 / 준공·입주 예정 6개월 전 / 신규 준공 단지 / 준공·입주 완료 · 위탁 검토 | 사용 중 |
| 영업가능성 점수 | 핵심 업종 +1. 세대 ≥1000이면 +2, ≥300이면 +1. 계약종료 D-0~180이면 +3, 181~365일이면 +1, 경과 ≤90일이면 +1. 입주·준공 예정 6개월 이내 +2, 준공 후 ≤180일 +2, 준공 후 ≤548일 +1. 운영중·입주중 +1. 규모(가동업체 200/50, 연면적 10000/3000, 객실 300/100)면 +2/+1. 현 위탁사 있음 +1. verified +1. 등급: 점수 ≥5 상, ≥3 중, 그 외 하. 근거 신호가 없으면 미확인 | 사용 중 |
| 다음 조치 문구 | 수동 next_action → 수집기 제안 → 규칙 문구(오늘 기준 D-n, DB에는 저장하지 않음) 순서 | 사용 중 |
| 후보 조회 (loadProspectCandidates) | (A) 급한 건: 6개월 창, 최근 18개월 준공, 조치일 도래 — 1000건씩 최대 5000건, 초과하면 truncated 알림. (B) 가능성 상·중이거나 1년 내 종료 — 상위 200건. (C) verified 전체. 영업완료·대상아님·excluded는 제외 | 사용 중 |
| "지금 영업" 목록 (loadOpportunityOverview.actions) | 5개 원천: 선행영업(timing 버킷이 공고중·공고 임박·지금 접촉), 입찰(관련·진행 중·분류가 즉시 검토 또는 협력사 필요, 마감 ≤7일이면 rank 0, 그 외 1), 계약만료(12개월 내, stage rank ≤2), 신규건축(영업시작 도래), 운영시설(isNowProspect). opportunity_work가 대상아님·미참여인 공고·단지는 제외. 정렬: rank 오름차순 → 날짜 오름차순(없으면 마지막) → 가능성 점수 내림차순 | 사용 중 |

---

## 6. 진행 관리

| 대상 | 상태값 | 규칙 | 상태 |
|---|---|---|---|
| opportunity_work (입찰 공고·계약만료 = notice, 신규단지 = building) | 미검토(기록 없음), 검토중, 연락중, 보류, 미참여(공고 전용), 대상아님, 진행영업 전환 | 미참여·대상아님은 '완료' 탭으로 가고 오늘 할 일·지금 영업에서 빠짐. 되돌리기 가능. '진행영업 전환'은 전환 함수로만 가능하고 이후 상태는 고정(메모·다음일은 수정 가능). 처음 저장할 때 상태를 주지 않으면 검토중. 메모는 빈 문자열을 넣으면 지워짐. clear_next로 다음일 삭제 | 사용 중 |
| 진행영업 전환 (공고·단지) | — | convert_opportunity_to_lead: 리드 생성. 시설유형: kapt_bid·lh는 아파트, vendor_recruit는 시행·시공, 그 외 기타. 단지는 building_type으로 매핑. 우선순위: 즉시 검토·urgent·high면 high. 상태: 연락중이었으면 1차연락완료, 아니면 신규리드. 담당 = 전환한 사람. 메모 자동 작성. 공고의 lead_id 연결. 이미 전환됐으면 기존 리드 반환 | 사용 중 |
| 운영시설 연락 상태 | 미연락(기본), 연락중, 영업완료, 대상아님 | 영업완료·대상아님은 '지금' 목록에서 빠짐. 후속 기록: 메모는 notes에 "YYYY-MM-DD HH:MI 메모"로 누적되고 next_action은 최신 메모 | 사용 중 |
| 운영시설 → 리드 | — | convert_prospect_to_lead: 관리사무소 연락처, 세대수, 메모(주소·시설·최근 메모·출처). 미연락이면 연락중으로 변경 | 사용 중 |
| vendor_registrations | 미등록, 신청 준비, 신청 완료, 등록 완료, 대상 아님 | 메모 2000자, 다음 할 날짜(오늘 할 일에 노출) | 사용 중 |
| 리드 sales_status | 신규리드 → 1차연락완료 → 미팅예정 → 현장방문완료 → 제안서작성중 → 제안서발송완료 → 견적협의 → 계약검토 → 계약완료 / 보류 / 실패 | 전이 제약 없음. 실패·보류는 폼과 칸반에서 사유 필수(목록 인라인 select는 사유 없이 저장). 변경은 트리거가 로그로 남김. 6그룹: 신규 / 접촉중 / 제안중 / 계약검토 / 계약완료 / 보류·실패. 가중치 0~0.85 | 사용 중 |
| lead_opportunity_timing.procurement_status | 발굴, 영업시기대기, 선제접촉, 관계형성, 발주예정, 공고임박, 공고중, 마감, 계약완료 | 버킷 계산에 사용 | 사용 중 |

---

## 7. CSV 가져오기·내보내기

| 항목 | 내용 | 상태 |
|---|---|---|
| 내보내기 경로 | `GET /api/leads/export?…`. /leads 화면의 "CSV 내보내기"(PC만)가 현재 쿼리를 그대로 붙여 호출. requireUser(역할 제한 없음, 범위는 RLS) | 사용 중 |
| 내보내기 컬럼(순서) | id, company_name, facility_type, region, scale, contact_name, contact_phone, contact_email, sales_status, priority, expected_revenue, next_contact_date, status_reason, owner_name, memo, created_at (헤더는 영문 그대로. owner_name = full_name, 없으면 email) | 사용 중 |
| 내보내기 형식 | UTF-8 + BOM, 쉼표 구분, 필요한 경우 따옴표로 감싸고 따옴표는 두 번(csvEscape), 줄바꿈 CRLF. 파일명 `leads_YYYY-MM-DD.csv`(UTC 날짜). Content-Type text/csv; charset=utf-8, no-store | 사용 중 |
| 내보내기 필터 | 반영: q(회사명 ilike), region, facility, status, priority, owner, category. 반영 안 함: view, phase, sort. 그래서 목록 기본값(계약 고객)과 달리 전체 상태가 나옴. 정렬은 updated_at desc, 행 제한 없음, 관심사업 컬럼 없음 | 사용 중 |
| 가져오기 경로 | /leads/import(requireAdmin) → LeadImport → 서버 액션 `importLeads`(requireAdmin) | 사용 중 |
| 가져오기 헤더 | 영문 헤더와 정확히 일치해야 함: company_name(필수), facility_type, region, scale, contact_name, contact_phone, contact_email, sales_status, priority, expected_revenue, memo. 모르는 컬럼은 경고 후 무시. 한글 헤더나 별칭은 지원하지 않음 | 사용 중 |
| 가져오기 인코딩 | `readAsText(file, "utf-8")`만 사용, BOM 제거. CP949/EUC-KR은 지원하지 않음 | 사용 중 |
| 가져오기 처리 | 자체 CSV 파서(따옴표 처리). 미리보기 20행. 행 수 제한 없음. 한 행씩 insert(트랜잭션 없음). 기본값: 상태 신규리드, 우선순위 medium, 예상매출 숫자 변환 실패 시 0, owner = 실행한 admin. 지역이 있으면 upsert_region. 중복 검사 없음. 관심사업 없음. 값 검증은 DB check 제약에 맡김. 결과: "N건 성공 / M건 실패" + "행 i+2: 사유". 각 행 INSERT 시 첫 연락 업무가 자동 생성됨(트리거) | 사용 중 |

---

## 8. 권한

| 항목 | admin | sales | 상태 |
|---|---|---|---|
| 리드와 리드 하위 데이터 | 전체 | 본인 owner인 것만(RLS) | 사용 중 |
| 수집 DB(입찰·운영시설·신규단지·협력사) | 활성 사용자는 모두 같은 데이터를 봄. 상태 변경 RPC도 활성 사용자 누구나 | 같음 | 사용 중 |
| 관리 메뉴(/settings, /categories, /regions, /users, /settings/collectors) | 가능 | 접근하면 /dashboard로 redirect | 사용 중 |
| CSV 가져오기 | 가능 | 불가 | 사용 중 |
| CSV 내보내기 | 가능 | 가능(본인 리드만) | 사용 중 |
| 담당자 변경(폼, 목록 인라인, 일괄 변경, 일정·업무 담당자) | 가능 | 불가(서버가 본인으로 강제) | 사용 중 |
| 담당자 필터 | 드롭다운 표시 | 드롭다운은 숨김. 단 URL ?owner=는 서버가 그대로 적용하고 결과는 RLS로 제한됨 | 사용 중 |
| 리드 삭제, 상태·메모 수정 | 가능 | 가능(본인 리드, RLS) | 사용 중 |
| 대시보드 자동수집 카드 | 표시 | 숨김 | 사용 중 |
| 영업비용 | 모두 수정·삭제 | 본인이 입력한 것만 | 사용 중 |
| AI 사용량 조회 | 전체 | 본인 | 사용 중 |
| 비활성 사용자(active=false) | — | requireUser가 /auth/signout?reason=inactive로 보내 강제 로그아웃. is_admin()도 active를 확인. 수집 DB·RPC·AI도 active를 확인 | 사용 중 |
| 신규 가입 | handle_new_user가 role=sales, active=true로 profiles 생성. admin 지정은 /users에서 | — | 사용 중 |

---

## 9. 외부 연동·환경변수 이름 (값 없음)

| 이름 | 위치 | 용도 | 상태 |
|---|---|---|---|
| NEXT_PUBLIC_SUPABASE_URL | Vercel | Supabase URL, Edge URL 조합 | 사용 중 |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Vercel | 브라우저·서버 anon 키 | 사용 중 |
| CRON_SECRET | Vercel | cron·수동 실행 Bearer, Edge 호출 토큰 | 사용 중 |
| SUPABASE_EDGE_FUNCTION_BASE | Vercel(선택) | Edge base URL을 바꿀 때 | 사용 중(선택) |
| CRON_SECRET_HASH | Supabase Edge | CRON_SECRET의 SHA-256(hex) | 사용 중 |
| SUPABASE_URL, SUPABASE_SECRET_KEYS, SUPABASE_SERVICE_ROLE_KEY | Supabase Edge(자동 주입) | admin client | 사용 중 |
| SUPABASE_SERVICE_ROLE_KEY | .env.example 문서 | Vercel에는 두지 않는 것이 원칙 | 미사용(코드만 있음) |
| DATA_GO_KR_SERVICE_KEY | Vercel | 나라장터·누리장터·사전규격·낙찰·LH·국방·온비드·관광호텔. 서비스별 활용신청 필요(15129394, 15129456, 15129437, 15129397, 15159012, 15159011, 15158416, 15157216, 15155090) | 사용 중 |
| KAPT_SERVICE_KEY, KAPT_API_BASE | Vercel | K-apt 사업자선정 OpenAPI | 사용 중(키 없으면 건너뜀) |
| KAKAO_REST_API_KEY | Vercel | 카카오 로컬 관리사무소 전화 보강 | 사용 중(선택) |
| PUBLIC_SPORTS_FILE_URL | Vercel(선택) | 공공체육시설 연간 파일 URL 교체 | 사용 중(선택) |
| MOLIT_BUILDING_HUB_KEY | Vercel | 국토부 건축HUB. 설정 화면에서 점검만 하고 수집기는 없음 | 미사용(코드만 있음) |
| LOCALDATA_KEY | 0022 시드 auth_env_var | 코드 사용 없음 | 미사용(코드만 있음) |
| ANTHROPIC_API_KEY, AI_MODEL, AI_DAILY_LIMIT, AI_MONTHLY_BUDGET_USD | Vercel | AI 비서 | 사용 중 |
| VERCEL_GIT_COMMIT_SHA, VERCEL_GIT_COMMIT_REF, VERCEL_ENV, VERCEL_URL, NEXT_PUBLIC_BUILD_COMMIT | Vercel 자동 주입 / next.config | /api/health 빌드 정보, VersionWatch | 사용 중 |
| NEXT_BUILD_CPUS | 로컬 빌드(선택) | 빌드 worker 수 | 사용 중(로컬) |
| E2E_APP_PORT, E2E_MOCK_PORT, E2E_CDP_PORT, CHROME_PATH | 테스트 | E2E | 사용 중(테스트) |

외부 원천: K-apt(k-apt.go.kr 웹과 OpenAPI), data.go.kr(조달청, LH, 방위사업청, 온비드, 행안부, 부동산원 파일, 산단공 파일), 문체부(mcst.go.kr XLSX), 카카오 로컬 API, 시공사·시행사 공지 페이지 21곳, Anthropic API.

---

## 10. 테스트·검증 도구

| 도구 | 내용 | 상태 |
|---|---|---|
| test:unit | `node --import scripts/tests/register-ts.mjs --test scripts/tests/*.test.mjs`. Node type stripping과 별칭 해석 훅 사용. 26개 파일: ai-assistant, attachments, bid-file, bid-results, build-info, collectors(cron = registry = seed enabled, 마이그레이션 additive 검사), cron-auth, file-prospects, g2b, hotels, kapt-complex, kicox, mock-supabase, nav-links(내부 링크가 실제 page로 이어지는지 AST로 검사, '지금 영업' CTA 5곳), notice-dedupe, operating-prospects, opportunity-work, plan-batch, procurement, prospect-candidates, public-agency-bids, reb-recent, roi, sports, vendor-recruit, vendor-registrations | 사용 중 |
| e2e (scripts/e2e) | mock Supabase(127.0.0.1:54399)를 대상으로 전용 빌드한 뒤 next start. 세션 쿠키는 admin. route-status(리다이렉트·404·RSC 응답), operating-prospects(지금 영업 노출, 테이블이 없을 때 처리), click-now(Chrome CDP로 실제 클릭, 진입점 5곳), facilities-contact(영업완료 클릭 → RPC 호출, 시도 필터, ROI 비용 1건 쓰기 등) | 사용 중 |
| mock-supabase.mjs | /auth/v1/user, /rest/v1/<table>(고정 행, 선택적 필터), /rest/v1/rpc/*(기록만). 쓰기 감시: READ_ONLY_RPCS와 KNOWN_WRITE_RPCS 목록. 예상하지 않은 쓰기는 차단 | 사용 중 |
| cdp.mjs | 의존성 없는 headless Chrome CDP 클라이언트(임시 프로필) | 사용 중 |
| verify-routes.mjs | 빌드 매니페스트에 핵심 22개 라우트가 있는지 검사(/opportunities/facilities 등 일부는 목록에 없음) | 사용 중 |
| typecheck / typecheck:edge | tsc. tsconfig.edge.json은 supabase/functions를 Deno shim으로 검사 | 사용 중 |
| build-edge-bundle.mjs | Edge 단일 파일 번들 + SHA-256 | 사용 중 |
| ai-review-local.py | Claude·Codex 로컬 리뷰 루프(배포 없음) | 사용 중(개발 보조) |

---

## 11. 운영 데이터 규모

2026-10-17 운영 DB 에서 직접 센 값 (count(*), 공개 스키마 테이블 27개·뷰 2개).

| 구분 | 테이블 | 건수 | 메모 |
|---|---|---|---|
| 사용자 | profiles | 2 | 활성 2 (role=admin 0 — 확인 필요: 관리자 계정 역할 값) |
| 거래처(리드) | leads | 21 | 단계: 신규리드 4 · 1차연락완료 1 · 미팅예정 4 · 현장방문완료 4 · 제안서발송완료 2 · 실패 6 |
| 관심 사업 | lead_business_interests | 30 | |
| 사업 카테고리 | business_categories | 7 | |
| 상담 기록 | sales_activities | 4 | |
| 일정 | schedules | 0 | |
| 업무 | tasks / task_subtasks | 8 / 1 | |
| 제안서·계약·영업비 | proposals / contracts / sales_costs | 0 / 0 / 0 | |
| 선행영업 시점 | lead_opportunity_timing | 2 | |
| 입찰공고 | procurement_notices | 4,356 | 관련 654 · 관련 중 진행(마감 전) 112. 출처: kapt_bid 3,827 · g2b_bid 410 · vendor_recruit 70 · g2b_prespec 24 · d2b_bid 7 · onbid_lease 7 · 기타 수동 11 |
| 공고 관측 | procurement_notice_observations | 14 | 미사용 |
| 수집 실행(구) | procurement_monitoring_runs | 4 | 쓰는 곳 없음 |
| 준공·입주 시설 | operating_facility_prospects | 4,346 | 공공체육시설 2,241 · 산업단지 1,269 · 아파트 317 · 기타 519 |
| 신규단지 | building_sales_pipeline | 22 | |
| 협력사 등록 대상 | vendor_registrations | 164 | 시공사 100 · 시행사 12 · 공공 시행자 15 · 신탁사 12 · 관리주체 25 |
| 영업기회 진행 기록 | opportunity_work | 30 | |
| 수집 원천·실행·관측 | data_source_master / data_source_run / data_source_observation | 19 / 62 / 19,861 | |
| K-apt 업체 선정 | kapt_vendor_selection | 0 | |
| AI 비서 | ai_usage / ai_proposals | 2 / 1 | |
| 분류 정리 백업 | procurement_reclass_backup_20261014 / _20261015 | 257 / 47 | 되돌리기용, 앱에서 안 읽음 |

지역(regions)은 별도 표가 없다 — 거래처 region 값과 RPC(list_regions·upsert_region)로 관리.

| 테이블 | 행 수 | 비고 |
|---|---|---|
| | | |

---

### 부록: 확인 필요 항목 모음

- building_sales_pipeline을 누가 적재하는지: 앱·수집기 코드에 쓰기 경로가 없음
- KAPT_SERVICE_KEY 등록 여부: 없으면 kapt_sa_sun이 건너뛰므로 operating_from_kapt도 새 데이터가 없음
- owner_summary / region_summary / category_summary RPC가 화면에서 쓰이는지: 검색상 쓰이지 않음
- 칸반의 모바일 터치 드래그 지원(PointerSensor만 있음)
- Drawer(제안·계약 폼, 600px)의 모바일 표시, 공통 Table 컴포넌트의 가로 스크롤
- proposal-attachments 버킷의 크기·MIME 제한(코드에는 25MB 클라이언트 검사만 있음)
- 입찰 화면에서 완료 공고 id를 URL에 넣는 방식의 건수 한계, opportunity_work를 1000건까지만 매칭하는 화면(계약만료·신규단지·요약)

### 부록: 코드에서 확인된 동작상 주의점 (이관 때 그대로 따라 할지 결정 필요)

- /leads 목록 인라인 select나 빠른 메모로 실패·보류로 바꾸면 사유 없이 저장됨(폼과 칸반은 사유 필수)
- CSV 내보내기는 view/phase를 반영하지 않아 화면(계약 고객)과 결과가 다름
- 대시보드 "지연/오늘" 판정은 서버 로컬 시각, KPI는 KST 기준
- StaleLeads는 30일 기준인데 연결 링크는 14일 필터
- 칸반은 상태 변경이 실패해도 롤백하지 않음
- 입찰 완료 탭에서 필터를 다시 조회하면 진행 중 탭으로 돌아감(hidden tab 입력 없음)
- sales 사용자가 URL에 ?owner=를 넣으면 서버가 적용함(결과는 RLS로 본인 데이터만)
