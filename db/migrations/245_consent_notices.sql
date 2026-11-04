-- 360차(대표 #976 정보통신망법 제50조): 광고성 정보 수신 동의(가입의 '새 기능·혜택 소식 받기' = consents.kind 'marketing') 안내 기록
-- · 동의·철회 처리 결과 알림(14일 안에 — 워크인은 바로 보냄) · 2년마다 동의 여부 다시 확인 알림. 보낸 때·결과만 남긴다(메일 본문 없음).
create table if not exists consent_notices (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,                 -- marketing
  reason text not null check (reason in ('result_agree', 'result_withdraw', 'reconfirm')),
  ok boolean not null,                -- 메일이 나갔는지(실패면 다음 날 다시)
  sent_at timestamptz not null default now()
);
create index if not exists consent_notices_user_idx on consent_notices (user_id, kind, reason, sent_at desc);
