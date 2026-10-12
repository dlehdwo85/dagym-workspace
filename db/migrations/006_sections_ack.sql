-- B-2 담당자 확인: 새로 배정된 업무는 담당자가 '확인'하기 전까지 내 업무 맨 위에 표시
alter table tasks add column assignee_ack_at timestamptz;
update tasks set assignee_ack_at = now() where assignee_id is not null;

-- B-3 프로젝트 섹션
create table project_sections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  sort double precision not null default 0,
  created_at timestamptz not null default now()
);
create index on project_sections(project_id, sort);
alter table tasks add column section_id uuid references project_sections(id) on delete set null;
create index on tasks(section_id);
