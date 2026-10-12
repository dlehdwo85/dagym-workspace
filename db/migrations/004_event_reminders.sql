-- 일정 시작 전 알림 (분). 0 이면 끔
alter table user_settings add column event_reminder_minutes int not null default 30 check (event_reminder_minutes between 0 and 1440);
