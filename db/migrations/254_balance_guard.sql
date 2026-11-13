-- 402차 #1028(대표 11/13 "하이링크는 절대 네이버 광고 비용이 닳아서 광고가 진행 안 되는 상황이 연출되어선 안 됩니다. 이 부분은 메일로 따로 알려 주세요"):
-- 끊기면 안 되는 광고 계정 표시(guard) — 남은 날이 14·7·3일 아래로 내려가거나 잔액이 0이면 회사 대표에게 메일. 추가형만
alter table mkt_ad_balances add column if not exists guard boolean not null default false;
alter table mkt_ad_balances add column if not exists guard_stage integer;   -- 마지막으로 알린 단계(14·7·3·0)
alter table mkt_ad_balances add column if not exists guard_on date;         -- 그 단계를 알린 날(서울)
-- 대표가 짚은 계정: 다짐·하이링크 네이버 검색광고(다른 계정은 화면에서 켠다)
update mkt_ad_balances set guard = true where tenant = 'default' and provider = 'naver' and label like '%하이링크%' and not guard;
