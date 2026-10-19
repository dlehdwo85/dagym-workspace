-- 대표 요청(10/19): 메일 예약 보내기 — 보관함 행에 예약 시각(null = 바로). 정기 실행이 next_attempt_at(= 예약 시각)에 보냄
alter table outbox add column if not exists scheduled_at timestamptz;
