-- 로컬 10/20 알림 다이어트 + 알림에서 바로 처리: 묶음 수, 처리 결과("승인함 ✓"), 액션용 메타(업무·연장 요청·댓글 id), 조용한 시간 끔(기본 22:00~07:00 적용 안 함). 추가형만.
alter table notifications add column if not exists count int not null default 1;
alter table notifications add column if not exists action_done text;
alter table notifications add column if not exists action_done_at timestamptz;
alter table notifications add column if not exists meta jsonb not null default '{}';
alter table user_settings add column if not exists quiet_off boolean not null default false;
