-- 대표 10/20 17:40 (#110) 알림 건별 읽음·보관: 휴대폰 오른쪽 스와이프 = 보관(목록에서 빠지고 '보관함' 탭에서만 보임, 읽음 처리와 같이)
alter table notifications add column if not exists archived_at timestamptz;
create index if not exists notifications_archived_idx on notifications (user_id, archived_at) where archived_at is not null;
-- 로컬 10/21 20:00: 154 이전 알림은 space 가 비어 칩·공간 필터에 안 잡힘 → 종류·링크 기준으로 채움(마케팅 mkt_* / 영업 링크·배정)
update notifications set space = 'marketing' where space is null and (entity_type like 'mkt_%' or link like '/s/marketing/%' or link like '/notifications?space=marketing');
update notifications set space = 'sales' where space is null and (link like '/s/sales/%' or entity_type in ('sales_lead', 'lead', 'sales_bid') or type = 'assigned');
