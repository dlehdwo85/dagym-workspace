-- V29 3장 무료 업무 총량(진행+완료+휴지통 30일): "보관 파일로 내보내고 정리"한 완료 업무는 기록만 남기고 셈·화면·휴지통에서 빠진다(삭제 아님)
alter table tasks add column if not exists purged_at timestamptz;
