-- 378차(대표 11/06 "업무 연장할 때 담당자 승인을 기다리다 딜레이 … 담당자가 마감연장을 할 수 있도록 · 사유를 남기면 지시자와 담당자가 업무에서 확인 · 마감연장 때 시간 선택"):
-- 마감 연장 기록에 시각(앞·뒤) 칸. 날짜만 바꾸던 예전 기록은 빈 칸(종일). 추가형.
alter table task_due_extensions add column if not exists from_time time;
alter table task_due_extensions add column if not exists to_time time;
