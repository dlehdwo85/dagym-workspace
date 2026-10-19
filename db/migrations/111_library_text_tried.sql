-- V14 32: HWP·HWPX·PDF 본문 추출 — 기존 파일 일괄 재추출(정기 실행)이 같은 파일을 반복해서 읽지 않도록 시도 시각을 남긴다
alter table library_files add column if not exists text_tried_at timestamptz;
create index if not exists library_files_text_retry on library_files (tenant) where text_content is null and text_tried_at is null and deleted_at is null;
