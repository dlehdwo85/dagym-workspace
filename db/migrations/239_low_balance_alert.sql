-- 322차 #897(대표 11/02 00:0x '잔여 비즈머니로 우선 진행하고 10,000원 미만으로 떨어졌을 때 대표자한테 워크인에서 알림'):
-- 회사별 잔액 알림 기준 금액(null = 기본 10,000원) + 매체 잔액 줄마다 마지막 알림 날짜(서울, 하루 1번 · 기준 위로 오르면 비움). 추가형만
alter table mkt_settings add column if not exists low_balance_krw integer;
alter table mkt_ad_balances add column if not exists low_alerted_on date;
