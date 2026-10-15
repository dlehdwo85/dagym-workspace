-- V28-1 업무마다 AI 비서: 업무 × 사람 단위 대화 기록(업무를 다시 열면 이어서). 추가형.
create table if not exists task_ai_messages (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  action text not null default 'ask',          -- mail / sms / kakao / summary / next / ask
  content text not null,
  draft jsonb,                                  -- 메일·문자 초안(제목·본문·고른 첨부)
  cost_krw numeric(10, 2),
  created_at timestamptz not null default now()
);
create index if not exists task_ai_messages_idx on task_ai_messages (task_id, user_id, id);
