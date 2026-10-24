-- 메신저 2차(대표 10/20 "카톡 수준", docs/handoff/MESSENGER_KAKAO_LEVEL_2026-10-20.md B8~B10):
-- batch_id = 한 번에 고른 사진·영상 묶음(같은 값끼리 대화창에서 한 칸·좌우 넘기기 뷰어)
-- sticker  = 회사용 기본 스티커 코드(body 에는 스티커 글 — 목록 미리보기·검색·내보내기용)
-- event_id = '일정 잡기' 카드(참석자 = 방 참여자, 캘린더 일정과 같은 줄)
-- chat_polls·chat_poll_votes = 투표(보기 2~10개·여러 개 선택·익명·마감)
alter table chat_messages add column if not exists batch_id uuid;
create index if not exists chat_messages_batch_idx on chat_messages(batch_id) where batch_id is not null;  -- 묶음은 안 읽은 수에 1건
alter table chat_messages add column if not exists sticker text;
alter table chat_messages add column if not exists event_id uuid references events(id) on delete set null;
create index if not exists chat_messages_event_idx on chat_messages(event_id) where event_id is not null;
alter table chat_messages drop constraint if exists chat_messages_kind_check;
alter table chat_messages add constraint chat_messages_kind_check check (kind in ('text', 'system', 'forward', 'poll', 'event', 'sticker'));

create table if not exists chat_polls (
  message_id bigint primary key references chat_messages(id) on delete cascade,
  question text not null,
  options jsonb not null,                    -- ["보기1", "보기2", ...]
  multi boolean not null default false,      -- 여러 개 선택
  anonymous boolean not null default false,  -- 익명(누가 골랐는지 안 보임)
  closes_at timestamptz,                     -- 마감 시각(지나면 자동 마감)
  closed_at timestamptz,                     -- [투표 마감]을 누른 시각
  closed_by uuid references users(id) on delete set null
);
create table if not exists chat_poll_votes (
  message_id bigint not null references chat_polls(message_id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  option_idx int not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, option_idx)
);
