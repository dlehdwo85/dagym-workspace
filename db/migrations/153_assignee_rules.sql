-- 대표 10/20 15:00 (#100) 담당자 지정: 역할별 주·부 담당 규칙(마케팅 브랜드별 · 영업 원천별 · 업무 배정 부서/팀별 · 마케팅 승인자).
-- 자동으로 생기는 업무·카드·알림이 이 규칙의 담당자에게 가고, 주 담당이 연차·출장이면 부 담당에게. 규칙으로 배정된 업무는 tasks.assigned_by_rule 로 표시.
create table if not exists assignee_rules (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('marketing_brand', 'sales_source', 'task_unit', 'approver')),
  ref text not null default '',                 -- 브랜드 id · 영업 원천(bid/building/facility/vendor/lead) · 부서/팀 id · '' = 기본
  primary_user_id uuid not null references users(id) on delete cascade,
  backup_user_id uuid references users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, kind, ref)
);
alter table tasks add column if not exists assigned_by_rule uuid references assignee_rules(id) on delete set null;
