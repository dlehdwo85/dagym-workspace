-- D-01·D-05(대표 11/23 '추천대로'): 지운 것을 30일 보관하는 휴지통 기록 — 지점 보고·점검 회차를 지우거나 계약을 완전히 지울 때
-- 지우기 전 줄(딸린 줄 포함)을 JSON 그대로 남긴다(되살릴 근거·누가 언제 지웠는지). 30일 지나면 정기 실행이 비운다. 추가형.
create table if not exists trash_records (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  kind text not null,
  ref_id uuid not null,
  title text,
  data jsonb not null,
  deleted_by uuid references users(id) on delete set null,
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists trash_records_tenant on trash_records (tenant, deleted_at desc);
create index if not exists trash_records_expires on trash_records (expires_at);
