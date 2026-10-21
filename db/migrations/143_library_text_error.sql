-- 로컬 10/21 11:05 ❌: PDF 본문 추출이 운영에서 전부 실패(원인 기록 없음) → 실패 사유 칸 (추가형)
alter table library_files add column if not exists text_error text;
