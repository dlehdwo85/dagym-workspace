-- 광고 최적화 1차 (V44 ★3 '문구 3안 소액 테스트 → 이긴 안에 예산' · #12 '대행사 대비 절감액', 2026-10-23). 추가형.
-- 3안 테스트 설정은 세팅안(mkt_ad_plans.plan.test jsonb) 안에, 소재별 켜짐/꺼짐은 external.adLocks 안에 — 표 변경 없음.
-- 절감액 = 광고비 × 기준 수수료율(대행 수수료 통상 15~20%, 회사가 바꿈). 비우면 15%.
alter table mkt_settings add column if not exists agency_fee_pct numeric(4,1) check (agency_fee_pct is null or (agency_fee_pct >= 0 and agency_fee_pct <= 50));
