-- V28-3 슈퍼 계정(플랫폼 운영자): 회사 삭제 예약(30일 유예)·지원 모드 동의·한도 개별 조정·지원 모드 세션. 추가형.
alter table tenants add column if not exists delete_scheduled_at timestamptz;   -- 이 시각 이후 [영구 삭제 실행] 가능(2단계 확인)
alter table tenants add column if not exists support_consent_at timestamptz;    -- 고객사 대표가 "지원 모드 허용"을 켠 시각(끄면 null)
alter table tenants add column if not exists support_consent_by uuid references users(id) on delete set null;
alter table tenant_subscriptions add column if not exists limit_overrides jsonb not null default '{}';  -- {users, storageGb, aiRequests} 회사별 개별 한도

-- 지원 모드: 플랫폼 운영자가 동의한 회사의 대표 화면을 읽기 전용으로 30분. 쿠키 토큰은 해시만 저장
create table if not exists support_sessions (
  id text primary key,
  admin_id uuid not null references users(id) on delete cascade,
  tenant text not null references tenants(id) on delete cascade,
  target_user_id uuid not null references users(id) on delete cascade,
  reason text,
  expires_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists support_sessions_tenant_idx on support_sessions (tenant, created_at desc);
