-- V8 1번 아침 브리핑 설정 (추가형)
alter table user_settings add column if not exists briefing_time time not null default '08:30';
alter table user_settings add column if not exists briefing_enabled boolean not null default true;
alter table user_settings add column if not exists briefing_weekend boolean not null default false;
-- V8 6번 일정 종류: 연차(vacation)·반차·외근 추가 (기존 값은 그대로)
alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check check (kind in ('normal','vacation','half_day','outside','business_trip','task_block'));
-- V8 2번 개인 주간 보고 (금요일 자동 초안 → 본인이 고쳐 제출)
create table if not exists personal_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  week_start date not null,
  data jsonb not null,
  body text not null default '',
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);
