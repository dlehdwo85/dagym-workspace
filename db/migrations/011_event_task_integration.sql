-- 일정 × 업무 통합 (TASK_SCHEDULE_INTEGRATION S-1~S-9). 추가형.

-- S-1 일정–업무 N:M. 반복 일정은 마스터 id 에 연결하고, 특정 회차에서 만든 업무는 occurrence_start 를 남긴다
create table if not exists event_tasks (
  event_id uuid not null references events(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  role text not null default 'link' check (role in ('link','block','followup','prep','series')),
  offset_days int,                 -- prep: 일정 시작일 - n일이 마감
  note_line text,                  -- followup: 회의 메모의 원래 줄
  occurrence_start timestamptz,    -- 반복 일정의 회차
  series_rule_id uuid,             -- series: 만든 규칙
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (event_id, task_id)
);
create index if not exists event_tasks_task_idx on event_tasks(task_id);

-- 기존 업무 시간 블록(events.task_id) 을 N:M 표로 옮겨 적기 (events.task_id 는 호환을 위해 유지)
insert into event_tasks (event_id, task_id, role, created_by)
  select coalesce(e.recurring_event_id, e.id), e.task_id, 'block', e.created_by from events e
  where e.task_id is not null and e.deleted_at is null
on conflict do nothing;

-- S-2 회의 메모 (반복 일정은 회차별: occ = 회차 시작 ISO, 단일 일정은 '')
create table if not exists event_notes (
  event_id uuid not null references events(id) on delete cascade,
  occ text not null default '',
  body text not null default '',
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (event_id, occ)
);

-- S-6 예상 소요 시간(분)
alter table tasks add column if not exists estimate_minutes int check (estimate_minutes is null or estimate_minutes between 0 and 100000);

-- S-9 반복 회의마다 만드는 업무 규칙
create table if not exists event_series_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  title text not null,
  days_before int not null default 1 check (days_before between 0 and 60),
  assignee_id uuid references users(id),
  active boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists event_tasks_series_occ_uq on event_tasks(series_rule_id, occurrence_start) where series_rule_id is not null;
