-- 로컬 10/19(대표): 부서 › 팀 2단 구조 + 팀 격리('회사 안의 작은 회사').
-- kind: dept(부서, 상위 없음) · team(팀, 부서 아래). 기존 행은 상위가 있으면 팀, 없으면 부서(예전 '팀 = 부서').
alter table teams add column if not exists kind text not null default 'dept' check (kind in ('dept', 'team'));
update teams set kind = case when parent_id is null then 'dept' else 'team' end;
-- 부서 기본 공간: 이 부서·팀으로 초대하면 제안되는 공간(업무·영업·마케팅)
alter table teams add column if not exists default_spaces text[] not null default '{work}';
-- 격리: 구성원(대표·관리자 제외)은 자기 팀(하위 팀 포함)과 자기에게 배정된 것만 봄. 기존 팀은 꺼 둠(동작 그대로), 새 팀은 켜짐
alter table teams add column if not exists isolated boolean not null default false;
-- 팀 일정(팀 캘린더): 팀장 편집·팀원 조회·부서(상위) 구성원 편집·본사 전체
alter table calendars add column if not exists team_id uuid references teams(id) on delete cascade;
alter table calendars drop constraint if exists calendars_type_check;
alter table calendars add constraint calendars_type_check check (type in ('company', 'org_unit', 'personal', 'team'));
create unique index if not exists calendars_team_uq on calendars(team_id) where type = 'team';
