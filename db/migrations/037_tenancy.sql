-- V15 공개 출시: 회사(tenant) 분리 — 가입한 회사·개인 공간마다 데이터가 섞이지 않게 (추가형)
-- 기존: 'default'(다짐·하이링크) + 'demo'(체험 격리). 새 가입은 't_xxxx'.
alter table tenants add column if not exists kind text not null default 'company';  -- company | personal
alter table tenants add column if not exists status text not null default 'active'; -- active | blocked | deleted
alter table tenants add column if not exists owner_user_id uuid references users(id) on delete set null;
alter table tenants add column if not exists created_ip text;
alter table tenants add column if not exists onboarded_at timestamptz;

alter table users add column if not exists tenant text not null default 'default' references tenants(id);
update users set tenant = 'demo' where is_demo and tenant = 'default';
create index if not exists users_tenant_idx on users(tenant);
alter table users add column if not exists email_verified_at timestamptz;
update users set email_verified_at = coalesce(email_verified_at, created_at) where status = 'active'; -- 기존 사용자는 확인된 것으로

alter table org_units add column if not exists tenant text not null default 'default' references tenants(id);
update org_units set tenant = 'demo' where is_demo and tenant = 'default';
create index if not exists org_units_tenant_idx on org_units(tenant);

-- 회사 공용 캘린더·전사 템플릿·전사 결재선·전사 자동화(조직 없음)는 회사별로
alter table calendars add column if not exists tenant text not null default 'default';
alter table templates add column if not exists tenant text not null default 'default';
alter table approval_lines add column if not exists tenant text not null default 'default';
alter table automation_rules add column if not exists tenant text not null default 'default';
alter table holidays add column if not exists tenant text;
-- 회사 공용 캘린더는 "회사마다 1개" (예전: 전체에서 1개)
drop index if exists calendars_company_uq;
create unique index if not exists calendars_company_tenant_uq on calendars(tenant) where type = 'company'; -- null = 모든 회사 공통(법정 공휴일)

-- 메뉴 권한 등급 설정도 회사별 (예전 표는 'default' 회사 값으로 옮긴다)
create table if not exists menu_role_perms_t (
  tenant text not null,
  menu text not null,
  role text not null,
  level text not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, menu, role)
);
insert into menu_role_perms_t (tenant, menu, role, level, updated_by, updated_at)
  select 'default', menu, role, level, updated_by, updated_at from menu_role_perms on conflict do nothing;

-- 공개 가입: 이메일 확인·가입 시도 기록(남용 방지)
create table if not exists email_verifications (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists signup_attempts (
  id bigserial primary key,
  ip text,
  email text,
  ok boolean not null default false,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists signup_attempts_ip_idx on signup_attempts(ip, created_at);
-- 약관 동의 기록
create table if not exists consents (
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,          -- terms | privacy | ai | marketing
  version text not null,
  agreed boolean not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, version)
);
-- 팀 요금제 사전 신청은 plan_requests 를 그대로 쓴다

-- 공개 가입한 사람은 이메일 확인 전까지 로그인 불가 (초대·기존 사용자는 해당 없음)
alter table users add column if not exists signup_pending boolean not null default false;
-- 출시 요금제: 개인 무료 · 팀 무료(5명/2GB/AI 30) · 팀(1인 3,900원, 사전 신청)
insert into plans (code, name, monthly_krw, per_user_krw, limits, description, public, sort) values
  ('personal', '개인', 0, null, '{"users": 1, "storageGb": 1, "aiRequests": 20}', '혼자 쓰는 업무·일정', true, 5),
  ('team_free', '팀 무료', 0, null, '{"users": 5, "storageGb": 2, "aiRequests": 30}', '5명까지 · 팀 기능·메신저', true, 10),
  ('team', '팀', 0, 3900, '{"users": null, "perUserStorageGb": 3, "perUserAi": 50}', '인원 무제한 · 1인 월 3,900원(베타 기간 결제 전)', true, 15)
on conflict (code) do nothing;
-- 예전 공개 요금제는 새 가입 화면에 안 보이게만 (이미 쓰는 회사는 그대로)
update plans set public = false where code in ('free', 'basic') and public;
-- 계정 탈퇴·회사 삭제 기록
alter table tenants add column if not exists deleted_at timestamptz;
alter table users add column if not exists deleted_at timestamptz;
