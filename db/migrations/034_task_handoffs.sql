-- V14 1번: 담당자 본인의 "다른 사람에게 넘기기" 요청(지시자 승인) (추가형)
create table if not exists task_handoffs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  from_user uuid not null references users(id) on delete cascade,
  to_user uuid not null references users(id) on delete cascade,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists task_handoffs_task_idx on task_handoffs(task_id) where status = 'pending';
