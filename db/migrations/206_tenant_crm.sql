-- #656 플랫폼 관리 › 고객사 관리 확장(대표 10/26 00:40): 담당자 연락처·구분(설계 파트너 체험단)·소개 경로·단계(체험/유료/보류/해지)·할인·연락 기록
alter table tenants add column if not exists contact_name text;      -- 담당자 이름(비우면 대표)
alter table tenants add column if not exists contact_phone text;
alter table tenants add column if not exists contact_title text;
alter table tenants add column if not exists segment text check (segment in ('partner', 'customer'));  -- partner = 설계 파트너 체험단
alter table tenants add column if not exists source text;            -- 소개 경로(지인·하이링크 고객·홈페이지 문의·광고 …)
alter table tenants add column if not exists lifecycle text check (lifecycle in ('trial', 'paid', 'hold', 'churned'));  -- 운영자가 직접 정한 단계(null = 구독 상태에서 자동)
alter table tenants add column if not exists lifecycle_note text;
alter table tenants add column if not exists lifecycle_at timestamptz;
alter table tenant_subscriptions add column if not exists discount_pct int not null default 0 check (discount_pct between 0 and 100);
alter table tenant_subscriptions add column if not exists discount_until date;   -- null = 기한 없음
alter table tenant_subscriptions add column if not exists discount_note text;
create table if not exists tenant_contact_logs (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  kind text not null default 'memo' check (kind in ('call', 'mail', 'meeting', 'kakao', 'memo')),
  at timestamptz not null default now(),
  summary text not null,
  next_at date,                                      -- 다음 연락 예정일
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists tenant_contact_logs_tenant on tenant_contact_logs (tenant, at desc);
