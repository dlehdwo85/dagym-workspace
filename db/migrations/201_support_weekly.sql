-- #568(대표 10/24 저녁 "지원사업 내용 분석해 우리에게 접목할 점") 지원사업 '우리 회사에 맞나':
-- AI 판단에 '접목할 점'(어느 사업·브랜드에 어떻게 쓸지)·'마감·일정 한 줄' 추가 + 주 1회(월요일 아침) 회사별 '이번 주 맞는 지원사업' 묶음
-- (1차 조건 통과(✅)인데 AI 판단이 없는 공고만 자동 판단, 회사 AI 한도 안). 추가형만.
alter table support_matches add column if not exists ai_use jsonb not null default '[]';   -- 접목할 점 2~4줄
alter table support_matches add column if not exists ai_schedule text;                      -- 마감·일정 한 줄(공고에 적힌 날짜만)
alter table support_matches add column if not exists ai_auto boolean not null default false; -- 주간 묶음이 자동으로 판단한 것

create table if not exists support_weekly (
  id bigserial primary key,
  tenant text not null references tenants(id) on delete cascade,
  week date not null,                      -- 그 주 월요일(KST)
  items jsonb not null default '[]',       -- [{ id, title, by: 'ai'|'rule', dday, applyEnd, agency, brands, use, auto }]
  ai_count int not null default 0,         -- 이번 묶음에서 자동 판단한 수
  ai_failed int not null default 0,
  sent_to int not null default 0,          -- 알림 받은 사람 수
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, week)
);
