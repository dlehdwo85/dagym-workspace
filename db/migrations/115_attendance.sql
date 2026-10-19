-- V30 ③ 간이 근태(출퇴근·현장 위치 확인): 홈 [출근][퇴근] + 위치(동의한 사람만, 출퇴근 순간만) + 회사가 등록한 현장(주소·반경) 안인지. 급여·52시간 계산은 하지 않는다.
create table if not exists work_sites (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  radius_m int not null default 200 check (radius_m between 30 and 5000),
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists work_sites_tenant on work_sites (tenant) where active;
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  user_id uuid not null references users(id) on delete cascade,
  day date not null,                                  -- Asia/Seoul 기준 날짜
  in_at timestamptz,
  in_lat double precision, in_lng double precision, in_site_id uuid references work_sites(id) on delete set null, in_inside boolean, in_reason text,
  out_at timestamptz,
  out_lat double precision, out_lng double precision, out_site_id uuid references work_sites(id) on delete set null, out_inside boolean, out_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, user_id, day)
);
create index if not exists attendance_tenant_day on attendance (tenant, day desc);
alter table user_settings add column if not exists location_consent_at timestamptz;   -- 위치 동의(처음 출근 때 1번)
alter table tenants add column if not exists attendance_on boolean not null default true;  -- 홈 출퇴근 버튼 켬/끔
alter table tenants add column if not exists work_start text not null default '09:00';    -- 지각 기준(HH:MM)
