alter table google_calendar_links add column direction text not null default 'both' check (direction in ('both','import'));
alter table google_calendar_links add column fail_count int not null default 0;
alter table google_event_map add column google_updated timestamptz;
alter table google_event_map add column deleted_local boolean not null default false;
create table google_oauth_states (
  state text primary key,
  user_id uuid not null references users(id) on delete cascade,
  mode text not null,
  created_at timestamptz not null default now()
);
