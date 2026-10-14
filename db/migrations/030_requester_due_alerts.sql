-- V13 6번: 내가 지시한 업무의 마감 알림(기본 켬) (추가형)
alter table user_settings add column if not exists requester_due_alerts boolean not null default true;
