-- V32 4 마감 연장: 담당자는 지시자에게 연장 요청(사유 필수) → 지시자 승인·반려, 지시자는 바로 연장. 업무에 "연장 n회". 추가형.
create table if not exists task_due_extensions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  requested_by uuid not null references users(id) on delete cascade,
  from_date date,
  to_date date not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied', 'cancelled')),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists task_due_extensions_task_idx on task_due_extensions(task_id, created_at desc);
create index if not exists task_due_extensions_pending_idx on task_due_extensions(task_id) where status = 'pending';
alter table tasks add column if not exists due_extend_count int not null default 0;
