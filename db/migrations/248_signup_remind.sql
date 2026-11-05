-- 362차 #980(대표 결정 11/05): 답하지 않은 승인 대기 신청은 첫 알림 24시간 뒤 슈퍼관리자에게 한 번 더(알림·메일) — 보낸 때 기록(한 번만)
alter table tenants add column if not exists signup_reminded_at timestamptz;
