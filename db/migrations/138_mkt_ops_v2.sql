-- 대표 10/21 02:30 ①②③: 승인함 통합 · 반려 사유 → AI 재요청(v2, 3회) · 광고 예산 브랜드 축(비중·우선순위·메모) + 대표 입력 월 총액 + 세팅안 브랜드
alter table mkt_brands add column if not exists ad_priority int;                 -- 1 = 최우선(작을수록 먼저), null = 이름 기본값
alter table mkt_brands add column if not exists ad_share numeric(5, 2);         -- 월 광고 예산 비중(%), null = 기본값(하이링크 37.5·워크인 32.5·바디랩 15·다짐 10, 그 외 균등)
alter table mkt_brands add column if not exists ad_note text;                   -- 예: 바디랩 지역 한정(천안 두정·성정)
alter table mkt_settings add column if not exists ad_budget_monthly bigint;     -- 대표가 적은 월 광고 예산 총액(원), null = 월 목표 광고비 → 지난달 ×1.5
alter table mkt_ad_plans add column if not exists brand_id uuid references mkt_brands(id) on delete set null;
create index if not exists mkt_ad_plans_brand on mkt_ad_plans (tenant, brand_id);
-- 반려 → AI 고친 안 재요청: 버전·이전 카드·반영 요약(같은 줄기 최대 3회)
alter table mkt_proposals add column if not exists version int not null default 1;
alter table mkt_proposals add column if not exists revised_from uuid references mkt_proposals(id) on delete set null;
alter table mkt_proposals add column if not exists thread_id uuid;
alter table mkt_proposals add column if not exists revision_note text;          -- "반려 사유 → 반영한 점" 요약
alter table mkt_ad_budgets add column if not exists version int not null default 1;
alter table mkt_ad_budgets add column if not exists revision_note text;
alter table mkt_ad_budgets add column if not exists reject_note text;
alter table mkt_ad_budgets add column if not exists brand_plan jsonb not null default '[]'::jsonb;  -- [{brandId, name, share, monthly, priority, note, plans, needsPlan}]
alter table mkt_ad_budgets add column if not exists total_source text;          -- owner(대표 입력) · goal(월 목표 광고비) · last(지난달 ×1.5) · hint(화면 입력) · min
alter table mkt_goals add column if not exists version int not null default 1;
alter table mkt_goals add column if not exists revision_note text;
alter table mkt_goals add column if not exists reject_note text;
alter table mkt_goals drop constraint if exists mkt_goals_status_check;
alter table mkt_goals add constraint mkt_goals_status_check check (status in ('draft', 'pending', 'approved', 'closed', 'rejected'));
