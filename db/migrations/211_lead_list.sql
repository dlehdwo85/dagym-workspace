-- 197차(#461 영업 진행 목록 개편 1단계 · #460 업무 완료 때 다음 행동): 추가형.
-- 리드 '다음 할 일'(다음 연락일과 한 쌍) · '다시 볼 날'(보류·실패로 닫을 때 고른 재접촉 날 — 그날 담당자 업무 1건)
alter table sales_leads add column if not exists next_action text;
alter table sales_leads add column if not exists revisit_date date;
-- 사용자별 목록 설정(기기 간 유지): { leads: { views: [{ id, name, q }], cols: [...] } }
alter table user_settings add column if not exists list_views jsonb;
-- 목록의 '단계 머문 날'·'마지막 접촉'을 리드마다 읽음
create index if not exists sales_status_log_lead_idx on sales_status_log (lead_id, changed_at desc);
create index if not exists sales_lead_records_lead_idx on sales_lead_records (lead_id, kind) where lead_id is not null;
