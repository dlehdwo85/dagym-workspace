-- V29 2장 쉬운 메일 + B1 직원별 메일: "워크인 발송"(설정 없이, Resend) · 보내는 이름 · 회신 주소(Reply-To) · 숨은 참조
-- 채널 값 목록을 넓힘(기존 값은 그대로 허용)
alter table outbox drop constraint if exists outbox_channel_check;
alter table outbox add constraint outbox_channel_check check (channel in ('email:smtp', 'email:workin', 'sms:handoff'));
alter table outbox add column if not exists bcc_addrs text[] not null default '{}';
alter table outbox add column if not exists from_name text;
alter table outbox add column if not exists reply_to text;
-- 회사 기본 발송 방식: auto(회사 메일 계정이 있으면 그것, 없으면 워크인 발송) · workin · smtp
alter table tenants add column if not exists mail_mode text not null default 'auto' check (mail_mode in ('auto', 'workin', 'smtp'));
