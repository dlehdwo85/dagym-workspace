-- V44 ①: [승인하고 시작] 중복 요청 방지 — 만드는 중(creating) 상태를 더해 같은 세팅안을 동시에 두 번 만들지 않음(두 번째는 409)
alter table mkt_ad_plans drop constraint if exists mkt_ad_plans_status_check;
alter table mkt_ad_plans add constraint mkt_ad_plans_status_check check (status in ('draft', 'creating', 'created', 'active', 'paused', 'failed', 'archived'));
