-- V20 월 마감 기록: 매월 1일 지난달 업무 숫자를 고정 저장(나중에 업무가 바뀌어도 그 달 기록은 그대로). 추가형.
-- user_id null = 회사 전체, 그 밖 = 담당자별. estimated = 달이 끝나고 하루 넘게 지나 소급 계산한 값(배포 전 달 등)
create table if not exists task_month_close (
  id bigserial primary key,
  tenant text not null,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  user_id uuid references users(id) on delete cascade,
  done_count int not null default 0,
  carried_count int not null default 0,
  overdue_count int not null default 0,
  created_count int not null default 0,
  estimated boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists task_month_close_uniq on task_month_close (tenant, month, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
