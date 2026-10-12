-- 일정별 알림(분 단위, 여러 개). null 이면 각 사용자의 기본 설정(user_settings.event_reminder_minutes)을 따른다
alter table events add column reminder_minutes int[];
