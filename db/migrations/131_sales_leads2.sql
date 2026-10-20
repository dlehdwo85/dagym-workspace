-- 영업 S2 2차(감사 1-13·1-14·1-16): 리드 폼 칸 보강(규모·이메일·홈페이지)·삭제(사유·감사, 소프트)
alter table sales_leads add column if not exists scale text;
alter table sales_leads add column if not exists email text;
alter table sales_leads add column if not exists homepage text;
alter table sales_leads add column if not exists deleted_at timestamptz;
alter table sales_leads add column if not exists deleted_reason text;
create index if not exists sales_leads_alive on sales_leads (tenant) where deleted_at is null;
