-- COMPANY-WORK-OS 초기 스키마
-- 모든 시각은 timestamptz(UTC 저장), 화면 기본 시간대는 Asia/Seoul.

create table brands (
  id text primary key,                -- dagym / hilink / bodylab
  name text not null,
  color text not null default '#4b5563',
  sort int not null default 0
);

create table org_units (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references org_units(id),
  brand_id text references brands(id),
  type text not null check (type in ('hq','department','branch','site')),
  name text not null,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index on org_units(parent_id);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  title text,
  phone text,
  role text not null check (role in ('owner','admin','dept_lead','site_manager','staff')),
  status text not null default 'active' check (status in ('invited','active','disabled','left')),
  password_hash text,
  timezone text not null default 'Asia/Seoul',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_uq on users (lower(email));

create table memberships (
  user_id uuid not null references users(id) on delete cascade,
  org_unit_id uuid not null references org_units(id) on delete cascade,
  primary key (user_id, org_unit_id)
);
create index on memberships(org_unit_id);

create table sessions (
  id text primary key,                -- sha256(token)
  user_id uuid not null references users(id) on delete cascade,
  client text not null default 'web', -- web / android / ios
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index on sessions(user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text not null,
  role text not null,
  org_unit_ids uuid[] not null default '{}',
  token_hash text not null unique,
  invited_by uuid not null references users(id),
  user_id uuid references users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_by uuid references users(id),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  org_unit_id uuid not null references org_units(id),
  brand_id text references brands(id),
  owner_id uuid references users(id),
  color text not null default '#2563eb',
  archived boolean not null default false,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  parent_id uuid references tasks(id),
  org_unit_id uuid not null references org_units(id),
  brand_id text references brands(id),
  title text not null,
  description text not null default '',
  status text not null default 'todo' check (status in ('todo','in_progress','review','on_hold','done')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee_id uuid references users(id),
  start_date date,
  due_date date,
  due_time time,                       -- null 이면 '날짜만 있는 마감'
  tags text[] not null default '{}',
  approval_required boolean not null default true,
  review_requested_at timestamptz,
  review_requested_by uuid references users(id),
  approved_at timestamptz,
  approved_by uuid references users(id),
  completed_at timestamptz,
  recurrence_rule text,                -- RRULE (반복 업무)
  recurrence_source_id uuid references tasks(id),
  recurrence_stopped boolean not null default false,
  sort_order double precision not null default 0,
  version int not null default 1,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on tasks(org_unit_id) where deleted_at is null;
create index on tasks(assignee_id) where deleted_at is null;
create index on tasks(project_id) where deleted_at is null;
create index on tasks(parent_id);
create index on tasks(due_date) where deleted_at is null;

create table task_collaborators (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  primary key (task_id, user_id)
);
create index on task_collaborators(user_id);

create table task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  done_by uuid references users(id),
  done_at timestamptz,
  sort int not null default 0
);
create index on task_checklist_items(task_id);

create table task_dependencies (
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_id),
  check (task_id <> depends_on_id)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index on comments(task_id);

create table calendars (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('company','org_unit','personal')),
  org_unit_id uuid references org_units(id),
  owner_user_id uuid references users(id),
  name text not null,
  color text not null default '#0f766e',
  created_at timestamptz not null default now()
);
create unique index calendars_personal_uq on calendars(owner_user_id) where type = 'personal';
create unique index calendars_unit_uq on calendars(org_unit_id) where type = 'org_unit';
create unique index calendars_company_uq on calendars(type) where type = 'company';

create table events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id),
  title text not null,
  description text not null default '',
  location text not null default '',
  kind text not null default 'normal' check (kind in ('normal','vacation','business_trip','task_block')),
  all_day boolean not null default false,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Asia/Seoul',
  rrule text,                           -- 반복 규칙 (마스터만)
  exdates timestamptz[] not null default '{}',
  recurring_event_id uuid references events(id) on delete cascade, -- 예외(이번 일정만) 행
  original_start timestamptz,
  cancelled boolean not null default false,
  task_id uuid references tasks(id) on delete set null,
  version int not null default 1,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_at >= start_at)
);
create index on events(calendar_id) where deleted_at is null;
create index on events(start_at, end_at) where deleted_at is null;
create index on events(recurring_event_id);
create unique index events_exception_uq on events(recurring_event_id, original_start) where recurring_event_id is not null and deleted_at is null;

create table event_attendees (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  response text not null default 'needsAction' check (response in ('needsAction','accepted','declined','tentative')),
  primary key (event_id, user_id)
);
create index on event_attendees(user_id);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  kind text not null check (kind in ('file','link')),
  storage_key text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  upload_status text not null default 'ready' check (upload_status in ('pending','ready')),
  url text,
  doc_title text,
  doc_version text,
  doc_base_date date,
  doc_owner text,
  source text not null default 'upload' check (source in ('upload','google_drive','chatgpt','notion','web','other')),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((task_id is not null) <> (event_id is not null))
);
create index on attachments(task_id);
create index on attachments(event_id);

create table templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  payload jsonb not null,
  org_unit_id uuid references org_units(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived boolean not null default false
);

-- 변경 이력 (업무·일정·파일)
create table activities (
  id bigserial primary key,
  entity_type text not null,
  entity_id uuid not null,
  actor_id uuid references users(id),
  action text not null,
  changes jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on activities(entity_type, entity_id, created_at);

-- 관리자 감사 기록
create table audit_logs (
  id bigserial primary key,
  actor_id uuid references users(id),
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index on audit_logs(created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  link text not null default '/',
  entity_type text,
  entity_id uuid,
  actor_id uuid references users(id),
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_uq on notifications(user_id, dedupe_key);
create index on notifications(user_id, created_at desc);

create table notification_prefs (
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  in_app boolean not null default true,
  push boolean not null default true,
  primary key (user_id, type)
);

create table user_settings (
  user_id uuid primary key references users(id) on delete cascade,
  due_soon_hours int not null default 24,
  quiet_start time,
  quiet_end time,
  updated_at timestamptz not null default now()
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('webpush','fcm')),
  endpoint text not null,               -- webpush endpoint 또는 FCM 토큰
  keys jsonb,
  platform text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  disabled_at timestamptz,
  fail_count int not null default 0
);
create unique index push_subscriptions_endpoint_uq on push_subscriptions(endpoint);

create table notification_deliveries (
  id bigserial primary key,
  notification_id uuid not null references notifications(id) on delete cascade,
  subscription_id uuid references push_subscriptions(id) on delete set null,
  channel text not null,
  status text not null check (status in ('pending','sent','failed','skipped')),
  attempts int not null default 0,
  error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, subscription_id)
);
create index on notification_deliveries(status, next_attempt_at);

create table idempotency_keys (
  user_id uuid not null references users(id) on delete cascade,
  key text not null,
  route text not null,
  status_code int,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table job_runs (
  id bigserial primary key,
  job text not null,
  trigger text not null default 'scheduler',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','error','skipped')),
  detail jsonb not null default '{}'
);
create index on job_runs(job, started_at desc);

create table job_locks (
  name text primary key,
  locked_until timestamptz not null,
  holder text not null
);

create table error_logs (
  id bigserial primary key,
  source text not null,
  message text not null,
  stack text,
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on error_logs(created_at desc);

-- Google Calendar 연동
create table google_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  google_email text,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text not null default '',
  status text not null default 'active' check (status in ('active','reauth_required','revoked')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table google_calendar_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  google_calendar_id text not null,
  google_calendar_name text not null default '',
  local_calendar_id uuid not null references calendars(id),
  sync_token text,
  channel_id text,
  channel_resource_id text,
  channel_token text,
  channel_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','error')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, google_calendar_id)
);

create table google_event_map (
  link_id uuid not null references google_calendar_links(id) on delete cascade,
  local_event_id uuid not null references events(id) on delete cascade,
  google_event_id text not null,
  google_etag text,
  local_version int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (link_id, google_event_id),
  unique (link_id, local_event_id)
);

create table sync_logs (
  id bigserial primary key,
  link_id uuid references google_calendar_links(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  direction text not null,              -- pull / push / watch / auth
  action text not null,
  status text not null check (status in ('ok','error','conflict','skipped')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on sync_logs(user_id, created_at desc);
