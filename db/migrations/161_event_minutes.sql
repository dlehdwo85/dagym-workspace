-- V30 ⑥ (#74) 녹음 → 회의록 AI 요약: 일정(회차)마다 받아쓰기·요약·결정 사항·할 일 후보를 보관. 월 녹음 한도(분)·원가 표시용 duration_sec·cost_usd
create table if not exists event_minutes (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  event_id uuid not null references events(id) on delete cascade,
  occ text not null default '',
  created_by uuid references users(id) on delete set null,
  duration_sec integer not null default 0,
  stt_model text,
  transcript text,
  summary text not null default '',
  decisions jsonb not null default '[]'::jsonb,
  todos jsonb not null default '[]'::jsonb,
  cost_usd numeric(10,5) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists event_minutes_event_idx on event_minutes (event_id, occ, created_at desc);
create index if not exists event_minutes_tenant_month_idx on event_minutes (tenant, created_at);
