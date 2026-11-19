-- 화상회의 보강(대표 11/19 "줌 수준으로") — 회의 중 채팅. 새 표만 만든다(기존 표는 건드리지 않음).
-- 채팅은 워크인 서버에 남긴다(영상 서버와 무관 — 엔진이 바뀌어도 그대로, 늦게 들어온 직원도 앞 대화를 봄). 손님은 자기가 들어온 뒤의 글만 본다.
-- 보관: 회의 기록과 같이(회의가 지워질 때 함께, 그 밖에는 MEETING_KEEP_DAYS — 기본 90일 — 뒤 정리)
-- 되돌릴 때: drop table meeting_messages;
create table if not exists meeting_messages (
  id bigserial primary key,
  meeting_id uuid not null references meetings(id) on delete cascade,
  participant_id uuid references meeting_participants(id) on delete set null,
  name text not null,                 -- 보낼 때의 이름(참가 기록이 정리돼도 남게)
  guest boolean not null default false,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists meeting_messages_meeting_idx on meeting_messages (meeting_id, id);
