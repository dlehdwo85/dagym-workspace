-- 로컬 검수(10/18) 자동 제작 재료: 브랜드 키트 소개·주력 상품·이번 주 주제 + '주제 필요' 카드(재료가 없으면 원고 대신 질문)
alter table mkt_brands add column if not exists intro text;
alter table mkt_brands add column if not exists products text;
alter table mkt_brands add column if not exists weekly_topic text;
alter table mkt_production_requests drop constraint if exists mkt_production_requests_kind_check;
alter table mkt_production_requests add constraint mkt_production_requests_kind_check check (kind in ('image', 'video', 'regen_image', 'regen_video', 'topic'));
