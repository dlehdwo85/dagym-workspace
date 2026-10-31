-- 277차 #815(대표 10/31 '지원사업 넘겼을 때 실수로 누른건 다시 업무에서 회수해올 수 있도록'): 회수한 진행 기록 — 행·기록(support_work_log)은 남기고 '처음 상태'로 봄
alter table support_work add column if not exists withdrawn_at timestamptz;
alter table support_work add column if not exists withdrawn_by uuid references users(id) on delete set null;
