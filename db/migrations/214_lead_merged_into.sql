-- 206차(#461 ⑦ 기존 거래처끼리 합치기, SALES_LEADS_REVAMP 4절): 합쳐서 목록에서 빠진 거래처가 어디로 갔는지.
-- 예전 링크(알림·업무 설명·공유 주소 ?id=)로 열면 남긴 거래처로 옮겨 준다 · 합친 거래처의 옛 영업관리 원본 업무도 남긴 쪽 상세에 보인다
alter table sales_leads add column if not exists merged_into uuid references sales_leads(id) on delete set null;
create index if not exists sales_leads_merged_into on sales_leads (merged_into) where merged_into is not null;
