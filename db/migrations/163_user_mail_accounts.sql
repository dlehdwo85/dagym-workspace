-- V33 4 (#184) 직원이 자기 회사 메일 계정으로 보내기: 사람별 SMTP 계정(연결 시험 뒤 저장, 비밀번호 암호화) + 회사 정책(허용·허용 도메인) + 보관함 행에 '어느 개인 계정으로'
create table if not exists user_mail_accounts (
  user_id uuid primary key references users(id) on delete cascade,
  tenant text not null,
  provider text not null,
  host text not null,
  port integer not null,
  secure boolean not null default true,
  username text not null,
  from_email text not null,
  from_name text,
  password_enc text not null,
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create index if not exists user_mail_accounts_tenant_idx on user_mail_accounts (tenant);
alter table tenants add column if not exists staff_mail_accounts boolean not null default false;   -- 직원 개인 메일 계정 연결 허용(기본 끔)
alter table tenants add column if not exists staff_mail_domains text[] not null default '{}';      -- 허용 도메인(비어 있으면 제한 없음)
alter table outbox add column if not exists account_user_id uuid references users(id) on delete set null; -- 개인 계정으로 보내는 행
