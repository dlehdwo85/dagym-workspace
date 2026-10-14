-- V13 8번: 대댓글(1단계) + 이모지 반응 (추가형)
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;
create index if not exists comments_parent_idx on comments(parent_id) where parent_id is not null;
create table if not exists comment_reactions (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id, emoji)
);
