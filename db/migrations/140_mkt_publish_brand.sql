-- 로컬 10/21 08:10 긴급: 연결 게시 계정에 브랜드 지정이 없어 [지금 게시]가 인스타 전 계정으로 나감.
-- 계정마다 브랜드(또는 명시적 '공용') → 게시 대상 = 콘텐츠 브랜드 계정 + 공용 계정만(미지정 계정은 제외). 라벨로 1회 자동 추정.
alter table mkt_publish_accounts add column if not exists shared boolean not null default false;
update mkt_publish_accounts a set brand_id = b.id
  from mkt_brands b
  where a.brand_id is null and b.tenant = a.tenant and (
    (b.name = '하이링크' and (lower(a.label) like '%hi_link%' or lower(a.label) like '%hilink%' or a.label like '%하이링크%')) or
    (b.name = '다짐' and (lower(a.label) like '%dagym%' or a.label like '%다짐%')) or
    (b.name = '워크인' and (lower(a.label) like '%work_in%' or lower(a.label) like '%workin%' or a.label like '%워크인%')) or
    (b.name = '바디랩' and (lower(a.label) like '%body_lab%' or lower(a.label) like '%bodylab%' or a.label like '%바디랩%')));
