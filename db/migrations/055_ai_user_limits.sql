-- V23 4장·4.5: 사람별 월 AI 한도(원)·추가 요청·80/100% 알림 기록, 건별 정가 원가(원 환산·웹 검색·코드 실행) — 추가형
create table if not exists ai_user_limits (
  user_id uuid primary key references users(id) on delete cascade,
  monthly_krw int not null check (monthly_krw >= 0),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists ai_limit_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  user_id uuid not null references users(id) on delete cascade,
  month text not null,                         -- YYYY-MM (서울)
  amount_krw int not null check (amount_krw > 0 and amount_krw <= 1000000),
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ai_limit_requests_user_idx on ai_limit_requests(user_id, month);
create table if not exists ai_user_alerts (
  user_id uuid not null references users(id) on delete cascade,
  month text not null,
  level int not null,                          -- 80 · 100
  created_at timestamptz not null default now(),
  primary key (user_id, month, level)
);
alter table ai_usage add column if not exists cost_krw numeric(12,2);   -- 기록 시점 환율로 환산한 정가 원가
alter table ai_usage add column if not exists web_searches int not null default 0;
alter table ai_usage add column if not exists code_exec_seconds int not null default 0;
-- 모든 기록 경로(대화·문서 엔진·음성·분류…)에 원 환산을 빠짐없이: 환율은 app_settings 'usd_krw'(없으면 1,400)
create or replace function ai_usage_krw() returns trigger language plpgsql as $$
begin
  if new.cost_krw is null then
    new.cost_krw := round(new.cost_usd * coalesce((select (value #>> '{}')::numeric from app_settings where key = 'usd_krw'), 1400), 2);
  end if;
  return new;
end $$;
drop trigger if exists ai_usage_krw_trg on ai_usage;
create trigger ai_usage_krw_trg before insert on ai_usage for each row execute function ai_usage_krw();
update ai_usage set cost_krw = round(cost_usd * 1400, 2) where cost_krw is null;
