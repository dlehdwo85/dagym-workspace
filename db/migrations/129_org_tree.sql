-- 대표 10/20 15:15 부서·팀 재정비: 조직 = 트리(본사 > 부서 > 하위 부서 > 팀), 사람은 주 소속 1개 + 겸직 n개
-- 부서 아래 부서를 허용(parent_id 그대로 재귀), 소속은 team_members 에 주 소속 표시만 추가. 기존 사람은 첫 소속(장인 곳 우선)을 주 소속으로.
alter table team_members add column if not exists is_primary boolean not null default false;
update team_members m set is_primary = true
  where not exists (select 1 from team_members x where x.user_id = m.user_id and x.is_primary)
    and m.team_id = (select x.team_id from team_members x join teams t on t.id = x.team_id where x.user_id = m.user_id and not t.archived order by x.is_lead desc, t.name limit 1);
create unique index if not exists team_members_primary_uq on team_members(user_id) where is_primary;
