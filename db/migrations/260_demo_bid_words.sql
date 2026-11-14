-- 414차 후속(로컬 11/14 — 앱 심사 진행 중): 414차부터 다른 회사의 입찰 목록은 회사 검색어 기준이라
-- 체험 조직(앱 심사 계정)은 검색어를 넣기 전까지 '입찰 모아 보기'가 비었다. 체험용 관심 검색어를 기본으로 넣는다.
-- 추가형: 체험 조직에 맞춤 설정 행이 없으면 만들고, 있는데 검색어가 비어 있으면 채운다(이미 넣은 검색어는 그대로).
-- 아침 메일은 새로 만드는 행에서만 끔(받는 사람이 없는 조직). 기본 회사·다른 회사는 건드리지 않는다.
insert into sales_bid_prefs (tenant, keywords, digest_enabled)
  select 'demo', array['위탁운영', '커뮤니티', '시설관리', '출입통제'], false
  where exists (select 1 from tenants where id = 'demo')
on conflict (tenant) do update set keywords = excluded.keywords where sales_bid_prefs.keywords = '{}';
