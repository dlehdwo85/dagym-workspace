-- 메신저 카카오톡 수준 1차(대표 10/20 11:05, docs/handoff/MESSENGER_KAKAO_LEVEL_2026-10-20.md A1~3 + B5·6·7)
-- 시스템 메시지(초대·나감·내보냄)·전달, 방장, 초대된 사람은 초대 시점 이후 메시지만(방장이 '이전 대화 공개' 선택 가능)
alter table chat_messages add column if not exists kind text not null default 'text';
alter table chat_messages drop constraint if exists chat_messages_kind_check;
alter table chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'system', 'forward'));
alter table chat_messages add column if not exists forward_of bigint references chat_messages(id) on delete set null;
alter table chat_rooms add column if not exists owner_id uuid references users(id) on delete set null;
alter table chat_rooms add column if not exists history_visible boolean not null default false;
update chat_rooms set owner_id = created_by where owner_id is null and created_by is not null and kind = 'group';
alter table chat_members add column if not exists joined_after_id bigint not null default 0;   -- 이 id 뒤 메시지만 보임(0 = 처음부터)
