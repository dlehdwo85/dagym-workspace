-- V28 마케팅 퍼널: 가입 유입 경로(UTM) + 사람별 접속한 날(실사용 판정: 7일 안에 3일 이상 접속)
alter table tenants add column if not exists signup_utm jsonb;
create table if not exists user_active_days (
  user_id uuid not null references users(id) on delete cascade,
  tenant text not null,
  day date not null,
  primary key (user_id, day)
);
create index if not exists user_active_days_tenant_idx on user_active_days(tenant, day);
