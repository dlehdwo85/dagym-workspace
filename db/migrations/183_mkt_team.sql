-- #499-7 AI 마케팅팀(테크트리 3장 F — docs/handoff/TECHTREE_VIDEOS_2026-10-23.md). 지금 운영실(제안 → 승인) 위에 역할 이름·일정·기록·역할별 기억을 붙인다.
-- 역할 7개(기획·디자인·광고 리서처·광고 세팅·예산·응대·보고)는 코드 상수(src/lib/mktTeam.ts). 돈이 나가는 일은 지금 승인 규칙 그대로.
-- 새로 하는 일: 기획 담당이 매일 07시 이후 브랜드별 '오늘 주제' 3안 → 대표 채택·반려(기억) → 디자인 담당이 채택 즉시 카드뉴스 초안·제작 의뢰.
create table if not exists mkt_team_roles (
  tenant text not null references tenants(id) on delete cascade,
  role text not null check (role in ('planner', 'designer', 'researcher', 'adsetter', 'budget', 'responder', 'reporter')),
  enabled boolean,                                                   -- null = 기본값(코드) — 지금 돌던 일은 켬, 새 일(기획 담당)은 끔
  settings jsonb not null default '{}'::jsonb,                       -- 기획 담당 {brandIds[]} (비우면 시험 브랜드를 뺀 전체)
  last_run_at timestamptz,                                           -- 마지막으로 일한 때(건너뜀 포함)
  last_result jsonb,                                                 -- {status done|skipped|error, summary}
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, role)
);
create table if not exists mkt_team_log (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  role text not null,
  status text not null default 'done' check (status in ('working', 'done', 'skipped', 'error')),
  title text not null,
  detail text,
  link text,
  run_key text,                                                      -- 하루 한 번 같은 일(기획 담당 'planner:2026-10-24:{브랜드}')
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_team_log_run on mkt_team_log (tenant, run_key) where run_key is not null;
create index if not exists mkt_team_log_recent on mkt_team_log (tenant, role, created_at desc);
create table if not exists mkt_team_memory (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  role text not null,
  brand_id uuid references mkt_brands(id) on delete cascade,        -- 없으면 회사 전체
  kind text not null check (kind in ('adopt', 'reject', 'edit', 'note')), -- 채택·반려·수정 요청·대표 메모
  text text not null,
  reason text,
  source_type text,
  source_id uuid,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mkt_team_memory_recent on mkt_team_memory (tenant, role, created_at desc);
create table if not exists mkt_team_ideas (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid not null references mkt_brands(id) on delete cascade,
  day date not null,                                                 -- 서울 날짜
  title text not null,                                               -- 주제(표지 질문)
  hook text,                                                         -- 첫 문장
  format text not null default 'carousel' check (format in ('carousel', 'reels', 'feed')),
  pattern text,                                                      -- 카드뉴스 틀 vs|howto|types|checklist
  product text,
  angle text,                                                        -- 노리는 고객·상황
  basis jsonb not null default '[]'::jsonb,                          -- 근거 [{kind season|goal|competitor|memory|recent, text}]
  score int,                                                         -- 첫 문장 콘텐츠형 훅 점수
  status text not null default 'pending' check (status in ('pending', 'adopted', 'rejected', 'expired')),
  note text,                                                         -- 채택 메모·반려 사유
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  result_status text check (result_status is null or result_status in ('working', 'done', 'draft', 'error')), -- 디자인 담당이 만든 결과
  result_type text,                                                  -- carousel | brief
  result_id uuid,
  result_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_team_ideas_day on mkt_team_ideas (tenant, day desc, brand_id);
