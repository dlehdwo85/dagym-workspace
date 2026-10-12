-- B-12 업무 유형, B-7 사진 증빙
alter table tasks add column task_type text not null default 'normal' check (task_type in ('normal','milestone','approval','inspection'));
alter table tasks add column photo_required int not null default 0 check (photo_required between 0 and 20);
alter table attachments add column captured_at timestamptz;   -- 촬영 시각(기기 파일 시각)

-- B-11 프로젝트별 사용자 지정 필드
create table project_fields (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  type text not null check (type in ('select','number','percent','date','person','text')),
  options jsonb not null default '[]',          -- select: [{id,label,color}]
  aggregate text not null default 'none' check (aggregate in ('none','sum','avg','min','max')),
  sort double precision not null default 0,
  created_at timestamptz not null default now()
);
create index on project_fields(project_id);
create table task_field_values (
  task_id uuid not null references tasks(id) on delete cascade,
  field_id uuid not null references project_fields(id) on delete cascade,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (task_id, field_id)
);

-- B-9 다단계 결재
create table approval_lines (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_unit_id uuid references org_units(id),       -- null = 전사
  steps jsonb not null,                            -- [{label, type:'role'|'user', role?, userId?}]
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
alter table tasks add column approval_line_id uuid references approval_lines(id);
create table task_approvals (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  round int not null default 1,                    -- 반려 후 다시 올리면 회차 증가
  step int not null,
  label text not null,
  approver_type text not null,
  approver_role text,
  approver_user_id uuid references users(id),
  status text not null default 'waiting' check (status in ('waiting','pending','approved','rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  comment text,
  unique (task_id, round, step)
);

-- B-10 자동화 규칙
create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_unit_id uuid references org_units(id),       -- null = 전사(관리자만)
  project_id uuid references projects(id) on delete cascade,
  trigger text not null check (trigger in ('task_created','status_changed','task_completed','section_moved','due_soon')),
  conditions jsonb not null default '{}',
  actions jsonb not null,
  enabled boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table automation_runs (
  id bigserial primary key,
  rule_id uuid not null references automation_rules(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  dedupe_key text not null,
  status text not null check (status in ('ok','error','skipped')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (rule_id, dedupe_key)
);

-- B-8 현장 신고 양식 (QR)
create table site_forms (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id),
  kind text not null check (kind in ('facility','complaint','supply')),
  title text not null,
  token text not null unique,
  default_assignee_id uuid references users(id),
  enabled boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create table form_submissions (
  id bigserial primary key,
  form_id uuid not null references site_forms(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  reporter_name text,
  reporter_phone text,
  reporter_user_id uuid references users(id),
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index on form_submissions(form_id, created_at);
create index on form_submissions(ip_hash, created_at);
