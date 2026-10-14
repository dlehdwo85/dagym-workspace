-- V14 2·5·6번: AI 비서 대화 보관 + 회사별 AI 설정(보관 기간·1인 일 한도·입력 길이) (추가형)
create table if not exists ai_threads (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  user_id uuid not null references users(id) on delete cascade,
  title text not null default '새 대화',
  task_id uuid references tasks(id) on delete set null,
  pinned boolean not null default false,
  summary text,                 -- 오래된 앞부분 요약(문맥 비용 절감)
  summarized_upto bigint not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists ai_threads_user_idx on ai_threads(user_id, updated_at desc) where deleted_at is null;
create index if not exists ai_threads_task_idx on ai_threads(task_id) where task_id is not null and deleted_at is null;

create table if not exists ai_messages (
  id bigserial primary key,
  thread_id uuid not null references ai_threads(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  text text not null default '',
  file_ids uuid[] not null default '{}',
  file_names text[] not null default '{}',
  proposal_ids uuid[] not null default '{}',
  status text not null default 'ok' check (status in ('ok','blocked','error')),
  block_reason text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_thread_idx on ai_messages(thread_id, id);

create table if not exists ai_settings (
  tenant text primary key,
  retention_days int not null default 90,   -- 0 = 무기한
  daily_limit int not null default 50,      -- 1인 하루 요청 수
  input_max int not null default 4000,      -- 1회 입력 글자 수
  topic_filter boolean not null default true,
  console_note text,                        -- Claude Console 잔액 메모(대표 입력, 선택)
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
