-- V28-2A 카카오톡 공유: 휴대폰 카카오톡으로 넘겨 보낸 것([보냈어요])도 보관함·업무 기록에 남긴다
alter table outbox drop constraint if exists outbox_channel_check;
alter table outbox add constraint outbox_channel_check check (channel in ('email:smtp', 'email:workin', 'sms:handoff', 'kakao:handoff'));
