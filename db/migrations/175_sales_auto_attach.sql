-- #507(대표 10/23 15:50): 영업 DB(입찰 공고·지원사업) → 업무로 넘어올 때 공고 첨부를 자동으로 붙인 표시 — 업무 첨부 출처 '공고 첨부(자동)'(sales_auto). 추가형.
alter table attachments drop constraint if exists attachments_source_check;
alter table attachments add constraint attachments_source_check check (source in ('upload', 'google_drive', 'chatgpt', 'notion', 'web', 'other', 'library', 'sales_auto'));
