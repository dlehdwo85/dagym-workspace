-- #1176(대표 11/26 "요금제를 구매한 회사가 직원을 초대할지, 직원이 가입하게 할지"): 이메일 초대(그대로) + 회사 초대 링크(가입 신청 → 관리자 승인)
-- + 회사 메일 도메인 합류 신청(자체 도메인만, 관리자 승인 유지). 승인 없는 자유 가입은 하지 않음. 추가형.
create table if not exists join_links (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  token_hash text not null unique,
  token_enc text,                         -- 관리자가 나중에 다시 복사할 수 있게 암호화해 둠(앱 암호 키)
  created_by uuid references users(id) on delete set null,
  expires_at timestamptz,                 -- 비우면 만료 없음
  max_uses int,                           -- 비우면 상한 없음(가입 신청 수 기준)
  uses int not null default 0,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists join_links_tenant_idx on join_links (tenant, created_at desc);

create table if not exists join_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  link_id uuid references join_links(id) on delete set null,
  via text not null default 'link',       -- link(초대 링크 · 이메일) · domain(회사 메일 도메인) · google·kakao·naver·apple(초대 링크 · 소셜)
  email text not null,
  name text not null,
  password_hash text,                     -- 이메일로 신청한 경우(승인되면 그대로 로그인 비밀번호)
  provider text, subject text, secret text, -- 소셜로 신청한 경우(승인되면 그 소셜 계정을 연결)
  verify_hash text,
  email_verified_at timestamptz,          -- 이메일 신청은 메일의 확인 링크를 눌러야 관리자에게 보임(소셜은 제공자가 확인한 메일)
  agree jsonb,
  status text not null default 'pending', -- pending · approved · rejected · cancelled
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  reject_reason text,
  user_id uuid references users(id) on delete set null,
  ip text,
  created_at timestamptz not null default now()
);
create unique index if not exists join_requests_open_idx on join_requests (tenant, lower(email)) where status = 'pending';
create index if not exists join_requests_tenant_idx on join_requests (tenant, status, created_at desc);

-- 회사 메일 도메인 합류(선택): 관리자 본인 메일의 도메인만 등록 가능 · 네이버·지메일 같은 공용 도메인은 막음
alter table tenants add column if not exists join_domain text;
create unique index if not exists tenants_join_domain_idx on tenants (lower(join_domain)) where join_domain is not null;
