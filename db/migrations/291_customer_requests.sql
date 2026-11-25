-- #1175 고객 요청함(설계 docs/research/COMMERCIAL_DESIGN_2026-11-26.md C): 앱 문의(support_tickets)·상담 신청(space_consults)을 자동으로 모으고,
-- 운영자 메모·메일 요청은 직접 넣는다. 분류 ①설정 ②공통 개선 ③맞춤 개발(견적 후 진행) ④불가 · 상태 접수→검토→진행→완료/반려 · 담당·답변 기록 · 같은 요청 묶기. 추가형.
create table if not exists customer_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text references tenants(id) on delete set null,
  source text not null check (source in ('ticket', 'consult', 'memo', 'mail')),
  source_id text,
  title text not null,
  body text,
  category text check (category in ('setting', 'common', 'custom', 'impossible')),
  status text not null default 'received' check (status in ('received', 'review', 'progress', 'done', 'rejected')),
  owner_id uuid references users(id) on delete set null,
  group_id uuid references customer_requests(id) on delete set null, -- 같은 요청이면 대표 줄 id(대표 줄은 null)
  reply text,
  replied_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists customer_requests_status_idx on customer_requests (status, created_at desc);
create table if not exists customer_request_logs (
  id bigserial primary key,
  request_id uuid not null references customer_requests(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  action text not null,
  note text,
  at timestamptz not null default now()
);
