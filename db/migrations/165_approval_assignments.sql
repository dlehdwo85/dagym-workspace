-- #429 (대표 10/22 23:15) 팀별·양식별 다단계 결재: (양식 종류 × 부서·팀) → 결재선 배정.
-- kind = 양식 종류 또는 '*'(모든 양식), team_id = 부서·팀(teams) 또는 null(회사 전체).
-- 고르는 순서(approvalForms.resolveLine): 작성자 지정 > 양식×요청자 팀(없으면 상위 부서) > 양식 기본(양식×회사 전체) > 팀 기본(모든 양식×팀) > 회사 기본(모든 양식×회사 전체) > 예전 방식(조직 결재선)
create table if not exists approval_line_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('*', 'leave', 'expense', 'general', 'trip', 'purchase', 'family')),
  team_id uuid references teams(id) on delete cascade,
  line_id uuid not null references approval_lines(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists approval_line_assign_uq on approval_line_assignments (tenant, kind, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists approval_line_assign_line_idx on approval_line_assignments (line_id);

-- 결재선 회사 바로잡기: 예전 저장이 tenant 를 넣지 않아 기본값 'default' 로 들어간 결재선을 실제 회사로
-- (조직 결재선은 그 조직의 회사, 회사 전체 결재선은 만든 사람의 회사)
update approval_lines l set tenant = o.tenant from org_units o where l.org_unit_id = o.id and l.tenant <> o.tenant;
update approval_lines l set tenant = u.tenant from users u where l.org_unit_id is null and l.created_by = u.id and l.tenant <> u.tenant;

-- 지금까지의 '양식 기본 결재선'(approval_forms.line_id)을 (양식 × 회사 전체) 배정으로 옮겨 둔다 — 양식 칸도 그대로 두고 둘을 같이 맞춘다
insert into approval_line_assignments (tenant, kind, team_id, line_id, created_by)
  select distinct on (f.tenant, f.kind) f.tenant, f.kind, null::uuid, f.line_id, f.created_by
  from approval_forms f join approval_lines l on l.id = f.line_id join tenants t on t.id = f.tenant
  where f.line_id is not null and f.active and l.tenant = f.tenant
  order by f.tenant, f.kind, f.updated_at desc
on conflict do nothing;
