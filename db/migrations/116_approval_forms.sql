-- V30 ④ 결재 양식(휴가·지출결의·일반 품의): 기존 결재선(approval_lines)·결재 회차(task_approvals) 위에 양식만 더한다.
-- 결재 요청 1건 = 결재 업무(tasks.task_type='approval', status review) 1건 + 양식 값(approval_requests). 휴가 최종 승인 → 연차·반차 일정 자동 등록.
create table if not exists approval_forms (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  kind text not null check (kind in ('leave', 'expense', 'general')),
  name text not null,
  fields jsonb not null default '[]',                       -- [{key,label,type(text|number|date|daterange|select|textarea|file),required,options[]}]
  line_id uuid references approval_lines(id) on delete set null, -- 기본 결재선(없으면 요청자 조직의 결재선)
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists approval_forms_tenant on approval_forms (tenant, kind);
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  kind text not null,
  form_id uuid references approval_forms(id) on delete set null,
  task_id uuid not null references tasks(id) on delete cascade,
  requester_id uuid not null references users(id) on delete cascade,
  data jsonb not null default '{}',
  amount bigint,                                            -- 지출결의 금액(엑셀·합계)
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  event_id uuid,                                            -- 휴가 승인으로 만든 일정
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approval_requests_tenant on approval_requests (tenant, created_at desc);
create unique index if not exists approval_requests_task on approval_requests (task_id);
