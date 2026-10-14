-- V14 25·26번: 메신저 답장 인용·반응·대화방 고정, AI 대화의 화면 맥락(패널에서 "이 화면 관련" 먼저). 추가형.
alter table chat_messages add column if not exists reply_to bigint references chat_messages(id) on delete set null;
alter table chat_messages add column if not exists reacted_at timestamptz;
create table if not exists chat_reactions (
  message_id bigint not null references chat_messages(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table chat_members add column if not exists pinned_at timestamptz;
alter table ai_threads add column if not exists context_page text;
alter table ai_threads add column if not exists context_id text;
