-- 앱 소셜 로그인: 시스템 브라우저에서 끝난 로그인을 앱(WebView)으로 넘기는 1회용 표(2분, 앱이 가진 검증값이 맞아야 교환)
create table if not exists oauth_handoff (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  mfa boolean not null default false,
  client text not null,
  challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
