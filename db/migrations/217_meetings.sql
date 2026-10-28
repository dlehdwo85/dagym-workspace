-- 218차 화상회의(결정 15-37, 설계 docs/research/VIDEO_MEETINGS_DESIGN_2026-10-28.md): 회의 · 참가자 · 회의 기록 (추가형)
-- 기능 스위치 FEATURE_MEETINGS=1 일 때만 쓰임(기본 꺼짐). 영상은 엔진(중계 서버)으로 가고, 여기에는 회의 규칙·참가 상태·기록만.
create table if not exists meetings (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  code text not null unique,                       -- 회의 주소(/meet/<code>) — 추측 불가 무작위
  kind text not null default 'instant' check (kind in ('event', 'room', 'instant', 'personal')),
  event_id uuid references events(id) on delete set null,
  room_id uuid references chat_rooms(id) on delete set null,
  title text not null default '',
  host_id uuid references users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'live', 'ended')),
  lobby text not null default 'guests' check (lobby in ('guests', 'everyone', 'invited', 'none')),
  staff_first boolean not null default true,       -- 직원이 한 명도 없으면 손님은 들어올 수 없음
  locked boolean not null default false,
  share text not null default 'all' check (share in ('all', 'host')),
  engine text,
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null default now() + interval '90 days',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists meetings_event_uq on meetings (event_id) where event_id is not null;
create unique index if not exists meetings_personal_uq on meetings (tenant, host_id) where kind = 'personal';
create index if not exists meetings_tenant_idx on meetings (tenant, created_at desc);
create index if not exists meetings_room_idx on meetings (room_id) where room_id is not null;

create table if not exists meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  guest_name text,
  guest_secret_hash text,                          -- 손님 브라우저 비밀값의 해시(원문은 저장 안 함)
  role text not null default 'member' check (role in ('host', 'cohost', 'member', 'guest')),
  state text not null default 'waiting' check (state in ('waiting', 'admitted', 'joined', 'left', 'denied', 'removed')),
  first_joined_at timestamptz,
  last_joined_at timestamptz,
  left_at timestamptz,
  seconds integer not null default 0,
  last_seen_at timestamptz,
  admitted_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (user_id is not null or guest_name is not null)
);
create unique index if not exists meeting_participants_user_uq on meeting_participants (meeting_id, user_id) where user_id is not null;
create index if not exists meeting_participants_state_idx on meeting_participants (meeting_id, state);

create table if not exists meeting_log (
  id bigserial primary key,
  meeting_id uuid not null references meetings(id) on delete cascade,
  participant_id uuid references meeting_participants(id) on delete set null,
  kind text not null,
  by_user uuid references users(id) on delete set null,
  at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists meeting_log_meeting_idx on meeting_log (meeting_id, at);
