-- 범용화 1단계(대표 11/13 승인, docs/generalization-audit.md S-03·S-05). 추가형만 — 기본 회사(default)의 표·행은 건드리지 않는다.

-- S-05 회사별 공휴일: 기본 회사는 예전처럼 holidays 표 그대로.
-- 다른 회사는 법정 공휴일(코드의 목록)을 바탕으로, 이 표에 자기 회사의 추가·이름 바꾸기(removed=false)·빼기(removed=true)만 적는다.
create table if not exists company_holidays (
  tenant text not null references tenants(id) on delete cascade,
  date date not null,
  name text not null default '',
  removed boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, date)
);

-- S-03 옛 영업관리 자료가 없는 회사(기본 회사 제외)는 영업 쓰기를 바로 연다.
-- (sales_cutover 행은 다짐의 옛 영업관리 이전 장치 — 행이 없으면 읽기 전용이라 새 회사는 영업을 쓸 수 없었다)
insert into sales_cutover (tenant, ok, writes_open)
select t.id, true, true from tenants t
where t.id <> 'default'
  and not exists (select 1 from sales_cutover c where c.tenant = t.id)
  and not exists (select 1 from sales_src_rows r where r.scope = t.id)
on conflict (tenant) do nothing;
