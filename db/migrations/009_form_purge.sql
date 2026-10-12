-- 현장 신고자 개인정보 파기 시각 (처리 완료 1년 뒤 정기 실행이 이름·연락처를 지움)
alter table form_submissions add column if not exists purged_at timestamptz;
