-- 대표 10/21 12:00 영업 재편 5) 리드·거래처 진행 과정 한 화면: 일정 탭 — 일정이 리드를 가리킴(넘기기 자동 일정·리드에서 만든 일정)
alter table events add column if not exists lead_id uuid references sales_leads(id) on delete set null;
create index if not exists events_lead_idx on events (lead_id) where lead_id is not null;
