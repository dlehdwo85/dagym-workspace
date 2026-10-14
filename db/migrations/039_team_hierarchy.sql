-- R-16 팀 권한 계층: 상위 팀(관리 팀) 구성원은 하위 팀 업무 전체를 보고·고치고·배정. 하위 팀에는 상위 팀 업무 비공개 (추가형)
alter table teams add column if not exists parent_id uuid references teams(id) on delete set null;
create index if not exists teams_parent_idx on teams(parent_id);
-- R-15 6번: 체크리스트 항목별 담당자
alter table task_checklist_items add column if not exists assignee_id uuid references users(id) on delete set null;
