-- #533 업무 첨부 [고치기]: 브라우저에서 글(txt·csv…)·사진·PDF 를 고쳐 같은 첨부의 새 버전으로 — 버전 종류 3개 추가
alter table attachment_versions drop constraint if exists attachment_versions_kind_check;
alter table attachment_versions add constraint attachment_versions_kind_check check (kind in ('original', 'upload', 'doc', 'sheet', 'restore', 'text', 'image', 'pdf'));
