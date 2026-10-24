-- #544(대표 10/24 '브랜드별 레퍼런스 업체와 비교해 개선한 뒤 승인 다시'): 브랜드 템플릿이 나올 때까지
-- 정기·밤사이 자동 제작 시안은 승인함에 올리지 않고 초안으로 보관 — 회사별 켜기/끄기(자동 제작 설정).
-- 지금 마케팅을 쓰는 회사는 켬(대표 결정), 새 회사는 끔(기본). 사람이 직접 누른 제작·[승인 요청]은 예외(src/lib/mktAuto.ts).
alter table mkt_settings add column if not exists auto_hold boolean not null default false;
update mkt_settings set auto_hold = true;
insert into mkt_settings (tenant, auto_hold)
  select distinct r.tenant, true from mkt_rules r where not exists (select 1 from mkt_settings s where s.tenant = r.tenant)
  on conflict (tenant) do nothing;
