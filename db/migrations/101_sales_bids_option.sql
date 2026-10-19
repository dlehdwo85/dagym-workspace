-- 대표(10/19): 입찰·공고는 회사별 선택 기능 — 끄면 입찰·공고 메뉴·카드·하단 탭·화면을 숨김. null = 자동(지금은 켜짐; 업종 자동 세팅이 정하면 그 값)
alter table tenants add column if not exists sales_bids boolean;
