-- V41 단계 4-1 마케팅 운영실 SSO(F-6): 워크인이 발급하는 1회용 서명 토큰(60초) — jti 를 남겨 재사용을 막는다. 추가형.
create table if not exists sso_tokens (
  jti text primary key,
  user_id uuid not null references users(id) on delete cascade,
  tenant text not null,
  audience text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sso_tokens_expires_idx on sso_tokens(expires_at);
