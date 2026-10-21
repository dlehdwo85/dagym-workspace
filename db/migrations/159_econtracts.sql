-- 대표 10/20 20:00 ④ (#116) 전자계약서 1차: 서식(근로계약서·비밀유지서약서 기본 + 회사 서식), 계약 건, 서명자(순서·접속 코드·서명 이미지), 감사 추적.
-- 로그인 없이 서명: 서명자마다 1회용 링크(token_hash) + 6자리 접속 코드(code_hash). 완료 PDF 는 자료실(인사/전자계약서, 기밀)에 보관하고 file_id 로 연결.
create table if not exists contract_templates (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  kind text not null check (kind in ('employment', 'nda', 'custom')),
  name text not null,
  body text not null,                       -- {{employee_name}} 같은 자리표시자가 든 본문(줄 단위, '# ' 줄은 제목)
  fields jsonb not null default '[]',       -- [{key,label,type(text|date|number|textarea),required,hint}]
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contract_templates_tenant on contract_templates (tenant, kind);

create table if not exists contracts (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  template_id uuid references contract_templates(id) on delete set null,
  kind text not null,
  title text not null,
  doc_no text,                              -- 계약-YYYY-NNNN
  body text not null,                       -- 자리표시자를 채운 본문(보낸 시점 고정)
  data jsonb not null default '{}',
  user_id uuid references users(id) on delete set null,   -- 대상 직원(초대 중 계정 포함)
  status text not null default 'sent' check (status in ('draft', 'sent', 'partially_signed', 'completed', 'declined', 'cancelled', 'expired')),
  code_by text not null default 'sms' check (code_by in ('sms', 'mail')), -- 접속 코드 전달: 문자(관리자가 넘김)·메일
  file_id uuid,                             -- 완료 PDF(library_files)
  expires_at timestamptz,
  completed_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contracts_tenant on contracts (tenant, created_at desc);
create index if not exists contracts_user on contracts (user_id);

create table if not exists contract_signers (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  ord int not null default 1,               -- 서명 순서(같은 숫자는 동시에)
  role text not null check (role in ('employee', 'company', 'witness')),
  name text not null,
  email text,
  phone text,
  user_id uuid references users(id) on delete set null,
  token_hash text not null unique,
  code_hash text not null,
  code_attempts int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'signed', 'declined', 'locked')),
  opened_at timestamptz,
  signed_at timestamptz,
  sign_method text,                         -- draw | stamp
  signature_png bytea,
  decline_reason text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists contract_signers_contract on contract_signers (contract_id, ord);

create table if not exists contract_events (
  id bigserial primary key,
  contract_id uuid not null references contracts(id) on delete cascade,
  signer_id uuid references contract_signers(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  type text not null,                       -- created | sent | resent | opened | code_ok | code_fail | locked | signed | declined | completed | cancelled | pdf_viewed
  detail jsonb,
  ip text,
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists contract_events_contract on contract_events (contract_id, at);
