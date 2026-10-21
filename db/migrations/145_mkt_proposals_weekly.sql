-- 대표 10/20 14:10 ④ 주간 운영 제안 카드 종류 'weekly' (추가형)
alter table mkt_proposals drop constraint if exists mkt_proposals_kind_check;
alter table mkt_proposals add constraint mkt_proposals_kind_check check (kind in ('direction', 'collab', 'influencer', 'analysis', 'plan', 'alert', 'weekly'));
