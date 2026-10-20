-- 대표 10/20 23:55: 업무 첨부 [자료실에서 가져오기] — 출처 'library'(같은 저장 파일을 가리킴, 복사 아님)
alter table attachments drop constraint if exists attachments_source_check;
alter table attachments add constraint attachments_source_check check (source in ('upload', 'google_drive', 'chatgpt', 'notion', 'web', 'other', 'library'));
