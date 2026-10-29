-- 269차 #806(대표 10/29 '문서 고치기 빈 화면' — 사진만 든 Word): [PDF 로 만들어 글자 넣기]로 만든 PDF 첨부가 어느 Word 첨부에서 왔는지. 추가만.
alter table attachments add column if not exists pdf_of uuid references attachments(id) on delete set null;
create index if not exists attachments_pdf_of_idx on attachments (pdf_of) where pdf_of is not null;
