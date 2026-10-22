-- V34-B (#282) 정기결제 별도 동의 기록: 자동 결제를 시작할 때 누가·언제·어떤 금액·주기·문구에 동의했는지(전자상거래법·표시광고 요건). 가입 동의(consents)와 별개
create table if not exists billing_consents (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  user_id uuid references users(id) on delete set null,
  plan_code text not null,
  amount_krw integer not null,
  cycle text not null,                 -- monthly | annual
  text text not null,                  -- 동의 당시 화면 문구 그대로
  terms_version text not null,         -- 동의 당시 약관 버전
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists billing_consents_tenant_idx on billing_consents (tenant, created_at desc);
