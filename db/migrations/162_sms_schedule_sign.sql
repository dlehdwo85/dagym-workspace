-- #177 문자 예약 발송: 예약 시각이 되면 보관함 행이 'due'(보낼 시간 — 휴대폰 문자앱에서 사람이 보냄)로 바뀌고 보낸 사람에게 알림
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'outbox'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%';
  if c is not null then execute format('alter table outbox drop constraint %I', c); end if;
  alter table outbox add constraint outbox_status_check check (status in ('queued', 'sending', 'retry', 'sent', 'failed', 'canceled', 'due'));
end $$;
-- V32 7-2 명함형 문자 서명: 회사 대표번호를 서명에 넣을지(기본 끔)
alter table tenants add column if not exists sms_sign_phone boolean not null default false;
