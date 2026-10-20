-- 대표 10/21 03:00 ①②: 월 매출 목표 AI 추천(보수/기본/도전) 보관 · AI 마케터 상시 운영(매일 지표 스냅숏·변화 감지 '운영 신호' 카드·아침 브리핑·지금 상태)
alter table mkt_revenue_goals add column if not exists suggest jsonb;              -- {at, options[{key,label,target,rationale}], summary, basis}
alter table mkt_proposals drop constraint if exists mkt_proposals_kind_check;
alter table mkt_proposals add constraint mkt_proposals_kind_check check (kind in ('direction', 'collab', 'influencer', 'analysis', 'plan', 'alert'));
create table if not exists mkt_ops_daily (
  tenant text not null references tenants(id) on delete cascade,
  day date not null,
  metrics jsonb not null default '{}'::jsonb,   -- {posts, impressions, clicks, cost, cpc, inquiries, signups, contracts, contractAmount, approvals, late, delayed, budgetRate}
  signals jsonb not null default '[]'::jsonb,   -- [{key, level, title, detail}]
  status text not null default 'ok' check (status in ('ok', 'warn', 'action')),
  brief text,                                   -- 아침 한 줄 브리핑(07시 이후 하루 1번)
  brief_at timestamptz,
  reviewed_at timestamptz not null default now(),
  primary key (tenant, day)
);
