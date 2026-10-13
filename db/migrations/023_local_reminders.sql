-- 휴대폰 예약 알림(로컬 알림): 이 기기가 미리 알림을 직접 예약하면 서버는 같은 알림을 푸시하지 않는다 (추가형)
alter table push_subscriptions add column if not exists local_reminders boolean not null default false;
