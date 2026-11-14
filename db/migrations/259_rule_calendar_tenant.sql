-- 415차(범용화 S-06): 회사 표시 없이 저장돼 칸 기본값 'default'(기본 회사)로 들어간 행을 실제 회사로 바로잡는다.
-- 추가형: 칸·제약은 그대로, 잘못 적힌 값만 고침. 기본 회사가 만든 행은 이미 'default' 라 바뀌지 않는다.
-- ① 자동화 규칙: 조직 규칙 = 그 조직의 회사 · 프로젝트 규칙 = 프로젝트 조직의 회사 · 회사 전체 규칙 = 만든 사람의 회사
--    (이 값이 틀리면 다른 회사가 만든 회사 전체 규칙이 기본 회사 것으로 보이고, 기본 회사 업무에 실행됐다)
update automation_rules r set tenant = o.tenant from org_units o
  where r.org_unit_id = o.id and r.tenant is distinct from o.tenant;
update automation_rules r set tenant = o.tenant from projects p join org_units o on o.id = p.org_unit_id
  where r.org_unit_id is null and r.project_id = p.id and r.tenant is distinct from o.tenant;
update automation_rules r set tenant = u.tenant from users u
  where r.org_unit_id is null and r.project_id is null and r.created_by = u.id and r.tenant is distinct from u.tenant;
create index if not exists automation_rules_tenant_idx on automation_rules(tenant);
-- ② 캘린더: 개인 = 주인의 회사 · 조직 = 조직의 회사 · 팀 = 팀의 회사(회사 공용 캘린더는 그대로 — 볼 수 있는지는 주인·조직·팀으로 정해 화면은 그대로)
update calendars c set tenant = u.tenant from users u
  where c.type = 'personal' and c.owner_user_id = u.id and c.tenant is distinct from u.tenant;
update calendars c set tenant = o.tenant from org_units o
  where c.type = 'org_unit' and c.org_unit_id = o.id and c.tenant is distinct from o.tenant;
update calendars c set tenant = t.tenant from teams t
  where c.type = 'team' and c.team_id = t.id and c.tenant is distinct from t.tenant;
