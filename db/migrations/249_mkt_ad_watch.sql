-- 363차 #981(대표 11/05 B4 "노트북이 꺼지면 안 돌아가니 클라우드가 맞다"): 서버 광고 점검 — 매일 이상 알림 + 월요일 주간 보고.
-- 기준 5개·사업별 월 계획은 광고 집행 화면에서 고침. 입찰가·켜기/끄기는 바꾸지 않고 제안만(사람이 광고 집행 화면에서 실행).
create table if not exists mkt_ad_watch (
  tenant text primary key references tenants(id) on delete cascade,
  enabled boolean not null default true,
  kw_cost integer not null default 10000 check (kw_cost > 0),               -- 키워드 기간 비용(원) 이상 · 문의 0 → 입찰가 내림 제안
  kw_days integer not null default 7 check (kw_days between 3 and 30),     -- 그 기간(일)
  pause_weeks integer not null default 2 check (pause_weeks between 1 and 8), -- 그 기간이 몇 번 연속이면 중지 제안
  day_ratio numeric(5, 2) not null default 1.5 check (day_ratio >= 1),       -- 사업별 하루 비용이 계획(월 ÷ 그 달 날 수)의 몇 배면 확인
  cap_pct integer not null default 80 check (cap_pct between 10 and 100),   -- 회사 이번 달 누적이 월 상한의 몇 %면 대표 보고
  brand_plans jsonb not null default '{}'::jsonb,                            -- 브랜드 id → 월 계획(원)
  daily_on date,          -- 매일 점검을 한 날(서울)
  weekly_on date,         -- 주간 보고를 보낸 주의 월요일
  cap_month text,         -- 상한 % 보고를 보낸 달(YYYY-MM) — 달마다 한 번
  last_daily jsonb,
  last_weekly jsonb,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- 워크인 운영 회사(default) 처음 값: docs/handoff/AD_BUDGET_PLAN_2026-11.md 7번(하이링크 20만·워크인 14만·바디랩 두정점 10만·다짐 1만), 기준은 8번(위 기본값)
insert into mkt_ad_watch (tenant, brand_plans)
select 'default', coalesce((
  select jsonb_object_agg(id::text, amt) from (
    select distinct on (cat) id, cat, amt from (
      select b.id, b.created_at,
        case when b.name ~* '하이\s*-?\s*링크|hi-?link' then 'hilink' when b.name ~* '워크\s*인|work-?in' then 'workin' when b.name ~* '바디\s*랩|body\s*lab' then 'bodylab' when b.name ~* '다짐|dagym' then 'dagym' end as cat,
        case when b.name ~* '하이\s*-?\s*링크|hi-?link' then 200000 when b.name ~* '워크\s*인|work-?in' then 140000 when b.name ~* '바디\s*랩|body\s*lab' then 100000 when b.name ~* '다짐|dagym' then 10000 end as amt
      from mkt_brands b where b.tenant = 'default' and not b.test_mode) x
    where cat is not null order by cat, created_at) y), '{}'::jsonb)
where exists (select 1 from tenants where id = 'default')
on conflict (tenant) do nothing;
