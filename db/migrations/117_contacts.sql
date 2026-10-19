-- V31 ① 회사 공용 연락처(고객·거래처): 직접 등록·문의·발송·가져오기(엑셀·CSV·vCard)로 쌓임. 회사(tenant) 단위, 휴지통 30일.
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  name text not null,
  organization text,
  title text,
  phone text,
  phone_norm text,                      -- 숫자만(검색·중복 판정)
  email text,
  memo text not null default '',
  tags text[] not null default '{}',
  owner_id uuid references users(id) on delete set null,     -- 담당 직원
  source text not null default 'manual' check (source in ('manual', 'inquiry', 'send', 'import', 'vcard', 'quote')),
  last_contact_at timestamptz,          -- 마지막으로 보낸·받은 때
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists contacts_tenant_idx on contacts(tenant, deleted_at, name);
create index if not exists contacts_phone_idx on contacts(tenant, phone_norm) where deleted_at is null;
create index if not exists contacts_email_idx on contacts(tenant, lower(email)) where deleted_at is null;

-- 연락처 ↔ 업무(문의·발송·견적) 연결: 같은 업무의 받는 사람을 자동 완성 맨 위에
create table if not exists contact_tasks (
  contact_id uuid not null references contacts(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (contact_id, task_id)
);
create index if not exists contact_tasks_task_idx on contact_tasks(task_id);
