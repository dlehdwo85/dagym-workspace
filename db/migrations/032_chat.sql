-- V13 10번 사내 메신저 (추가형). 회사(tenant)별 저장, 방 종류: 1:1 · 그룹 · 회사 전체 · 업무별
create table if not exists chat_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  kind text not null check (kind in ('dm','group','company','task')),
  name text,
  task_id uuid references tasks(id) on delete cascade,
  dm_key text,                              -- 1:1 방 중복 방지(두 사람 id 정렬)
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
create unique index if not exists chat_rooms_dm_idx on chat_rooms(tenant, dm_key) where dm_key is not null;
create unique index if not exists chat_rooms_task_idx on chat_rooms(task_id) where task_id is not null;
create unique index if not exists chat_rooms_company_idx on chat_rooms(tenant) where kind = 'company';

create table if not exists chat_members (
  room_id uuid not null references chat_rooms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_id bigint not null default 0,
  muted boolean not null default false,
  primary key (room_id, user_id)
);
create index if not exists chat_members_user_idx on chat_members(user_id);

create table if not exists chat_messages (
  id bigserial primary key,
  room_id uuid not null references chat_rooms(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null default '',
  mentions uuid[] not null default '{}',
  file_key text, file_name text, file_mime text, file_size bigint,
  task_id uuid references tasks(id) on delete set null,   -- "업무로 만들기"로 만든 업무
  pinned_at timestamptz, pinned_by uuid references users(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on chat_messages(room_id, id desc);

create table if not exists chat_typing (
  room_id uuid not null references chat_rooms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (room_id, user_id)
);
