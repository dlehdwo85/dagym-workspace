-- 344차(대표 11/02 #925 "취소된 공고의 업무는 경고를 띄워 담당자가 확인하고 완료 처리"): [공고 취소로 완료] 때 남은 체크리스트 항목을 '건너뜀'으로 표시
alter table task_checklist_items add column if not exists skipped_at timestamptz;
