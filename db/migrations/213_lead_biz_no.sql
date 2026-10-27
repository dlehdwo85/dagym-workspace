-- 205차(#461 ⑦ 가져오기·중복, SALES_LEADS_REVAMP 4절 '사업자번호·전화·회사명이 비슷하면 합치기를 제안'):
-- 거래처 사업자번호 칸(선택). 숫자만 비교(하이픈 무시) — 같은 회사 여러 곳일 수 있어 유일 조건은 두지 않는다
alter table sales_leads add column if not exists biz_no text;
