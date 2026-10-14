-- V14 3번: 자료실 자동 정리 상태·실패 사유 (추가형)
alter table library_files add column if not exists organize_status text; -- null(대상 아님) | pending | done | failed
alter table library_files add column if not exists organize_error text;
