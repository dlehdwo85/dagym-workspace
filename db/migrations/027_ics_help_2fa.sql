-- V12 3번: ICS 구독 주소 · 도움말/문의 · 2단계 인증 (추가형)
create table if not exists calendar_feeds (
  user_id uuid primary key references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  user_id uuid references users(id) on delete set null,
  category text not null default 'question',
  subject text not null,
  body text not null,
  page text,
  status text not null default 'open' check (status in ('open','answered','closed')),
  answer text,
  answered_by uuid references users(id),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);
alter table users add column if not exists totp_secret text;          -- 암호화 저장
alter table users add column if not exists totp_enabled_at timestamptz;
alter table sessions add column if not exists ip text;
alter table sessions add column if not exists mfa_pending boolean not null default false;
create table if not exists app_settings_2fa (tenant text primary key, require_admin_2fa boolean not null default false);
