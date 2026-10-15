-- V29 1장 소셜 가입·로그인(Google·카카오·네이버) + 가입 2단계(인원 규모·업종)
create table if not exists user_identities (
  provider text not null check (provider in ('google', 'kakao', 'naver')),
  subject text not null,                 -- 제공자 안 사용자 고유 번호
  user_id uuid not null references users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  primary key (provider, subject)
);
create index if not exists user_identities_user_idx on user_identities(user_id);
-- 소셜 확인은 끝났지만 회사 만들기 전(30분): 토큰 해시만 보관
create table if not exists oauth_pending (
  token_hash text primary key,
  provider text not null,
  subject text not null,
  email text not null,
  name text,
  utm jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table tenants add column if not exists size_band text;
alter table tenants add column if not exists industry text;
