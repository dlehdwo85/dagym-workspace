-- 대표 10/20 19:00 제작의뢰실: 의뢰(브리프) → AI 30년차 마케터 프롬프트 → 생성(Higgsfield 연동 전엔 제작 요청 카드) → 승인 대기
create table if not exists mkt_briefs (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete set null,
  channel text not null,
  kind text not null,                             -- feed·story·reels·shorts·blog_cover·video
  purpose text not null,                          -- awareness·inquiry·hiring·trust·launch
  message text not null,                          -- 핵심 메시지 1줄
  refs jsonb not null default '{}'::jsonb,        -- {mediaIds[], contentIds[], links[]}
  tone text,
  quantity int not null default 1 check (quantity between 1 and 5),
  due_date date,
  status text not null default 'queued' check (status in ('queued', 'prompting', 'ready', 'generating', 'review', 'published', 'rejected', 'failed', 'canceled')),
  prompt jsonb,                                   -- {promptEn, negativeEn, summaryKo, caption, refMediaIds[], aspect, model, source}
  content_id uuid references mkt_contents(id) on delete set null,
  est_credits numeric(10, 2) not null default 0,
  result jsonb,                                   -- {provider, requestIds[], mediaIds[], error}
  error text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_briefs_tenant on mkt_briefs (tenant, status, created_at desc);
alter table mkt_production_requests add column if not exists brief_id uuid references mkt_briefs(id) on delete set null;
