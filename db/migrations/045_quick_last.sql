-- 검수 20(V8 9번): 업무 등록 창의 마지막 설정(담당·지시·우선순위·프로젝트·알림)을 기기가 아닌 사용자 단위로 기억. 추가형.
alter table user_settings add column if not exists quick_last jsonb;
