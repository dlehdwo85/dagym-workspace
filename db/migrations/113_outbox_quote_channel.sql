-- V19 견적서 보낸 기록: 공유창·메일·문자·내려받기·카카오톡으로 보낸 것([보냈어요])도 보관함(outbox)에 남긴다
alter table outbox drop constraint if exists outbox_channel_check;
alter table outbox add constraint outbox_channel_check check (channel in ('email:smtp', 'email:workin', 'sms:handoff', 'kakao:handoff', 'quote:share', 'quote:mail', 'quote:sms', 'quote:download', 'quote:kakao'));
