-- V10: 회사(테넌트)별 사용량 계량 · 요금제 (추가형, 결제 연동 없음)
create table if not exists tenants (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);
insert into tenants (id, name) values ('default', '다짐 · 하이링크'), ('demo', '체험(격리) 조직') on conflict (id) do nothing;

-- 요금제: 숫자는 여기서 바꾼다(배포 없이 /platform 화면). limits 의 값이 null 이면 무제한
create table if not exists plans (
  code text primary key,
  name text not null,
  monthly_krw int,               -- null = 별도 협의
  limits jsonb not null,         -- {"users": 5, "storageGb": 2, "aiRequests": 30}
  description text,
  public boolean not null default true,  -- 내부 요금제는 고객에게 안 보임
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into plans (code, name, monthly_krw, limits, description, public, sort) values
  ('free', '무료', 0, '{"users": 5, "storageGb": 2, "aiRequests": 30}', '체험·소규모', true, 10),
  ('standard', '스탠다드', 29000, '{"users": 20, "storageGb": 50, "aiRequests": 500}', '일반 사무실', true, 20),
  ('business', '비즈니스', 79000, '{"users": 50, "storageGb": 200, "aiRequests": 1500}', '지점 여러 곳', true, 30),
  ('enterprise', '엔터프라이즈', null, '{"users": null, "storageGb": 1024, "aiRequests": null}', '별도 협의 · 전용 지원', true, 40),
  ('internal', '내부(무제한)', 0, '{"users": null, "storageGb": null, "aiRequests": null}', '워크인 운영사 자체 사용', false, 99)
on conflict (code) do nothing;

-- 추가 옵션 (단위당 월 요금, 늘어나는 한도)
create table if not exists plan_addons (
  code text primary key,
  name text not null,
  monthly_krw int not null,
  adds jsonb not null,           -- {"storageGb": 50}
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into plan_addons (code, name, monthly_krw, adds, sort) values
  ('storage50', '저장공간 +50GB', 5000, '{"storageGb": 50}', 10),
  ('ai500', 'AI 요청 +500회', 10000, '{"aiRequests": 500}', 20),
  ('users10', '사용자 +10명', 10000, '{"users": 10}', 30)
on conflict (code) do nothing;

create table if not exists tenant_subscriptions (
  tenant text primary key references tenants(id),
  plan_code text not null references plans(code),
  addons jsonb not null default '{}',   -- {"storage50": 2} = 2개
  period_start date not null default current_date,
  period_end date,
  status text not null default 'active' check (status in ('active','trial','suspended')),
  note text,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
insert into tenant_subscriptions (tenant, plan_code) values ('default', 'internal'), ('demo', 'free') on conflict (tenant) do nothing;

-- 요금제 변경 요청 (회사 관리자 → 플랫폼 운영자)
create table if not exists plan_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id),
  requested_by uuid not null references users(id),
  plan_code text references plans(code),
  addons jsonb,
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

-- 월별 사용량 기록 (매일 정기 실행이 실제 합계로 갱신 — 화면은 실시간 합계)
create table if not exists tenant_usage (
  tenant text not null references tenants(id),
  month date not null,
  storage_bytes bigint not null default 0,
  ai_requests int not null default 0,
  ai_tokens bigint not null default 0,
  active_users int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant, month)
);

-- AI 요청 1회(여러 번 API 왕복) 단위로 셈
alter table ai_usage add column if not exists request_id uuid;

-- 플랫폼 운영자(워크인 운영사): /platform 화면. 처음에는 기존 대표(데모 아님)
alter table users add column if not exists platform_admin boolean not null default false;
update users set platform_admin = true where role = 'owner' and not is_demo and not exists (select 1 from users where platform_admin);
