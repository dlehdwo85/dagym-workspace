-- V32 3 가입 단계별 이탈률: 계정 화면 → 회사 화면 → 가입 → 이메일 확인 → 연락 채널 → 동료 초대
create table if not exists signup_steps (
  id bigserial primary key,
  anon text,
  tenant text,
  step text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists signup_steps_anon_uq on signup_steps (anon, step) where anon is not null;
create unique index if not exists signup_steps_tenant_uq on signup_steps (tenant, step) where tenant is not null;
create index if not exists signup_steps_at on signup_steps (created_at);
