-- #650(로컬 10/25 23:20): 온비드 임대 공고 줄의 원문 주소를 첫 화면(https://www.onbid.co.kr) → 차세대 온비드 공고 검색 화면으로.
-- 상세는 폼 전송이라 바로 가는 주소가 없고, 화면은 '온비드 공고 검색에서 공고번호 검색' 안내 + 번호 복사. 수집기도 같은 주소를 저장(publicAgency.ONBID_SEARCH_URL)
update sales_src_rows set row = row || '{"source_url": "https://www.onbid.co.kr/op/cltrpbancinf/pbanc/pbancsrch/PbancClgInqController/mvmnSrchPbancClg.do"}'::jsonb
 where tbl = 'procurement_notices' and row->>'source_type' = 'onbid_lease' and row->>'source_url' = 'https://www.onbid.co.kr';
