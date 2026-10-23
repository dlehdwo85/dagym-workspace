-- #509(대표 10/23 17:30) 당일 공고 메일: 받는 주소 직접 추가(직원 선택 외, 최대 5개) · 보낸 사람 이름 · 답장 주소
-- 비어 있으면 보낸 사람 = '<회사 이름> 영업실', 답장 = 회사 메일 계정 주소
alter table sales_bid_prefs add column if not exists digest_emails text[] not null default '{}';
alter table sales_bid_prefs add column if not exists digest_from_name text;
alter table sales_bid_prefs add column if not exists digest_reply_to text;
