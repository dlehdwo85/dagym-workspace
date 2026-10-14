-- 16차 추가: 문의 유형별 기본 담당자 여러 명 + 등록 방식(together = 한 업무에 주 담당+협업자, each = 담당자마다 각각). 추가형.
alter table inquiry_settings add column if not exists assignee_ids uuid[] not null default '{}';
alter table inquiry_settings add column if not exists mode text not null default 'together';
update inquiry_settings set assignee_ids = array[assignee_id] where assignee_id is not null and assignee_ids = '{}';
