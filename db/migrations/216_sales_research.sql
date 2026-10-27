-- 212차 #612(대표 결정 10/25 19:00 "매주 진행"): 영업 '준공·입주 시설'의 미확인 값(현 위탁사·계약만료일·관리사무소 번호) 후속조사.
-- 주 1회(월요일 아침) 회사마다 '[후속조사] 이번 주 시설 n곳' 업무 하나를 만들고, 그 업무에 묶인 시설을 여기에 한 줄씩 남긴다.
-- 카드에는 '미확인 · 조사 예정 날짜(담당)', 업무를 완료할 때 적은 값은 result 에(카드·계약만료·재입찰 탭이 읽음). 추가형만.
create table if not exists sales_research (
  id bigserial primary key,
  tenant text not null references tenants(id) on delete cascade,
  kind text not null default 'facility',   -- 지금은 준공·입주 시설만
  src_id text not null,                    -- sales_src_rows(operating_facility_prospects).src_id
  name text not null,
  week date not null,                      -- 묶음 주(월요일 KST)
  task_id uuid references tasks(id) on delete set null,
  missing text[] not null default '{}',    -- operator · contract · phone
  status text not null default 'open',     -- open(조사 예정) · done(값 적음) · none(확인 못함)
  result jsonb not null default '{}',      -- { operator, contractEnd, phone, note }
  done_by uuid references users(id) on delete set null,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, kind, src_id, week)
);
create index if not exists sales_research_task on sales_research (task_id);
create index if not exists sales_research_item on sales_research (tenant, kind, src_id, week desc);

-- 회사·주마다 묶음을 한 번만(고를 시설이 없던 주도 기록 — 같은 주에 다시 고르지 않음)
create table if not exists sales_research_weekly (
  tenant text not null references tenants(id) on delete cascade,
  week date not null,
  task_id uuid references tasks(id) on delete set null,
  items int not null default 0,
  created_at timestamptz not null default now(),
  primary key (tenant, week)
);
