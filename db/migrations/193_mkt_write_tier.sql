-- 대표 10/24 추가 ①: 마케팅 자동 제작 글(원고·약한 첫 줄 다시 쓰기·수정본·블로그)의 모델 단계
-- 정하는 순서: 회사(mkt_settings.write_tier, 플랫폼 운영 › 회사 관리) → 마케팅 요금제(mkt_plan_limits.write_tier, 플랫폼 운영 › 마케팅 요금제 표) → 빠른 모델
-- fast = 빠른 모델(지금까지 쓰던 것) · default = 표준 모델 · deep = 최상 모델. 품질 검사는 그대로 빠른 모델
alter table mkt_settings add column if not exists write_tier text check (write_tier in ('fast', 'default', 'deep'));
alter table mkt_plan_limits add column if not exists write_tier text check (write_tier in ('fast', 'default', 'deep'));
-- 우리 회사(본사 조직 default)는 최상 모델 — 대표 결정 10/24("마케팅 운영실은 대기업 수준의 홍보가 되어야 한다"). 고객사 요금제별 값은 대표 결정 뒤 표에서 바꾼다
insert into mkt_settings (tenant, write_tier) select 'default', 'deep' where exists (select 1 from tenants where id = 'default')
  on conflict (tenant) do update set write_tier = excluded.write_tier;
