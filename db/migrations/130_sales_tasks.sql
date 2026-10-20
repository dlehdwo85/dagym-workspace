-- 대표 10/20 14:15 영업 진행 → 업무 자동 리스트업: 업무가 어느 영업 건(입찰·신규단지·시설·협력사·리드)에서 왔는지 연결
alter table tasks add column if not exists lead_id uuid references sales_leads(id) on delete set null;
alter table tasks add column if not exists sales_ref jsonb;   -- {kind: bid|building|facility|vendor|lead, id, name}
create index if not exists tasks_lead_idx on tasks (lead_id) where lead_id is not null;
create index if not exists tasks_sales_ref_idx on tasks ((sales_ref->>'kind'), (sales_ref->>'id')) where sales_ref is not null;
