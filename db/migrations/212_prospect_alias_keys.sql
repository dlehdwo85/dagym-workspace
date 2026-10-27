-- 200차(#699 준공·입주 단지 원천 합치기): 추가형.
-- 같은 단지를 다른 원천(K-apt 자료실·K-apt 단지 목록·한국부동산원)이 다른 번호로 보내면 먼저 있던 줄에 합치고 그 원천의 키를 row.alias_keys 에 남긴다.
-- 수집기가 매번 dedupe_key 와 별칭을 함께 찾으므로 별칭도 색인(시설 줄만)
create index if not exists sales_src_rows_alias_keys on sales_src_rows using gin ((row->'alias_keys')) where tbl = 'operating_facility_prospects';
