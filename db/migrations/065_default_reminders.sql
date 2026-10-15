-- 2026-10-15 대표 지시: 모든 업무·일정 기본 알림 = 1시간 전
-- 일정 기본값 10분 → 60분(예전 기본값 10분 그대로인 사람만 바꿈, 받지 않음(0)·직접 고른 다른 값은 유지)
alter table user_settings alter column event_reminder_minutes set default 60;
update user_settings set event_reminder_minutes = 60 where event_reminder_minutes = 10;
