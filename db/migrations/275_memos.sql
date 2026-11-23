-- #1135(대표 11/23 · docs/research/SECURE_MEMO_DESIGN_2026-11-23.md): 메모 · 주요 메모(사이트·아이디·비밀번호). 추가형.
-- 메모마다 볼 사람(사람·부서, 보기/고치기)을 정한다. 기본은 만든 사람만 — 대표·관리자도 자동으로 보지 못한다.
-- 주요 메모의 아이디·비밀번호·참고는 secret_ct 에 암호문으로만(키는 서버 설정 MEMO_VAULT_KEY, 저장소·DB 에 없음). 제목·사이트 주소만 평문(목록·검색용).
create table if not exists memos (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  kind text not null check (kind in ('note', 'secret')),
  title text not null,
  body text,              -- 일반 메모 본문(주요 메모는 비움)
  site_url text,          -- 주요 메모: 사이트 주소(평문)
  secret_ct text,         -- 주요 메모: {username, password, note} 암호문(AES-256-GCM, 회사별 키, 메모 번호를 함께 묶음)
  key_ver int,            -- 암호화 키 번호(키 교체 대비)
  created_by uuid not null references users(id) on delete cascade,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz, -- 휴지통(30일 뒤 정기 실행이 완전히 지움)
  deleted_by uuid references users(id) on delete set null
);
create index if not exists memos_tenant on memos (tenant, updated_at desc) where deleted_at is null;
create index if not exists memos_creator on memos (created_by);

-- 볼 사람: 사람(user_id) 또는 부서(org_unit_id — 그 부서와 아래 부서 사람 모두). level = view(보기) / edit(고치기·볼 사람 바꾸기)
create table if not exists memo_access (
  memo_id uuid not null references memos(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  org_unit_id uuid references org_units(id) on delete cascade,
  level text not null check (level in ('view', 'edit')),
  check ((user_id is null) <> (org_unit_id is null))
);
create unique index if not exists memo_access_user on memo_access (memo_id, user_id) where user_id is not null;
create unique index if not exists memo_access_unit on memo_access (memo_id, org_unit_id) where org_unit_id is not null;
create index if not exists memo_access_by_user on memo_access (user_id) where user_id is not null;

-- 본인 확인(비밀번호·2단계 코드·방금 로그인)을 마친 세션은 이 시각까지 주요 메모를 열 수 있다(10분)
alter table sessions add column if not exists memo_unlocked_until timestamptz;
