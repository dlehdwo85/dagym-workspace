-- 상용화 ⑦: 마케팅 AI 호출 회사별 월 한도($). null = 요금제 기본값(요금제도 없으면 회사 AI 한도만 적용)
alter table mkt_settings add column if not exists ai_monthly_usd numeric(10, 2);
