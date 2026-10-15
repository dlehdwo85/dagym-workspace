-- V21 메일·문자 보내기: 조직 메일 계정(SMTP)·메일 명함·발송 보관함(outbox)·기간 다운로드 링크. 추가형.

-- 조직 메일 계정 (조직당 1개 — 상업화: 고객사마다 자기 계정). 앱 비밀번호는 암호화(APP_SECRET 파생 키, AES-256-GCM)
create table if not exists mail_accounts (
  tenant text primary key,
  provider text not null,                     -- naver / naverworks / daum / gmail / m365 / custom
  host text not null,
  port int not null check (port between 1 and 65535),
  secure boolean not null default true,       -- true = SSL(465), false = STARTTLS(587)
  username text not null,
  from_email text not null,
  from_name text,
  password_enc text not null,
  last_ok_at timestamptz,
  last_error text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 메일 명함(서명): 회사 정보(company_profiles)에 소개 한 줄·비밀유지 안내문(국/영)을 더한다. 이름·직급·연락처는 보내는 사람 프로필에서
alter table company_profiles add column if not exists sig_intro text;
alter table company_profiles add column if not exists sig_disclaimer text;
alter table company_profiles add column if not exists sig_disclaimer_en text;

-- 발송 보관함: [보내기] = 여기에 저장하고 바로 응답 → 백그라운드 발송(재시도·잠금·고정 Message-ID 로 중복 금지)
create table if not exists outbox (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  channel text not null check (channel in ('email:smtp', 'sms:handoff')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'retry', 'sent', 'failed', 'canceled')),
  task_id uuid references tasks(id) on delete set null,
  company_key text,
  created_by uuid not null references users(id) on delete cascade,
  from_email text,
  to_addrs text[] not null default '{}',
  cc_addrs text[] not null default '{}',
  subject text,
  body_text text not null default '',
  body_html text,
  files jsonb not null default '[]',          -- [{attachmentId, name, size, mime}]
  as_link boolean not null default false,     -- 첨부 합계가 커서 다운로드 링크로 바꿨는지
  share_id uuid,
  message_id text not null,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  error_kind text,                            -- transient / auth / address / config
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists outbox_due_idx on outbox (next_attempt_at) where status in ('queued', 'retry');
create index if not exists outbox_task_idx on outbox (task_id, created_at desc);
create index if not exists outbox_tenant_idx on outbox (tenant, created_at desc);

-- 기간 다운로드 링크(14일): 첨부가 크거나 문자에 넣을 때. 토큰은 해시만 저장, 열람 기록
create table if not exists share_links (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  token_hash text not null unique,
  task_id uuid references tasks(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  files jsonb not null default '[]',          -- [{attachmentId, name, size}]
  expires_at timestamptz not null,
  first_opened_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists share_link_views (
  id bigserial primary key,
  link_id uuid not null references share_links(id) on delete cascade,
  file_index int,                              -- null = 페이지 열람, 숫자 = 그 파일 내려받기
  ip text,
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists share_link_views_idx on share_link_views (link_id, at desc);
