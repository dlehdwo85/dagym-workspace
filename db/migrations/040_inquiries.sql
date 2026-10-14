-- 16차: 다짐·하이링크 웹사이트 문의 → 워크인 업무 자동 등록. 다짐 회사(tenant 'default') 전용. 추가형.
create table if not exists integration_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  site text not null check (site in ('dagym', 'hilink')),
  name text not null default '',
  token_hash text not null unique,          -- 원문은 발급 때 한 번만 보여 주고 저장하지 않는다
  hint text not null default '',            -- 끝 4자리(구분용)
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists inquiry_settings (
  tenant text not null default 'default',
  inquiry_type text not null,               -- 위탁운영 / HILINK 플랫폼 / 운영 진단·컨설팅 / 기타
  assignee_id uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, inquiry_type)
);

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  lead_id text not null,
  site text not null,
  inquiry_type text not null,
  organization text,
  task_id uuid references tasks(id) on delete set null,
  token_id uuid references integration_tokens(id) on delete set null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant, lead_id)                  -- 같은 문의 재전송은 한 건만
);
create index if not exists inquiries_created_idx on inquiries (tenant, created_at desc);
