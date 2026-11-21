-- 대표 11/20 결정(#1083): 직원 초대 메일 자동 발송 — 보낸 결과·시각을 초대 줄에 남긴다(사용자 목록의 '메일 보냄·못 보냄' 표시와 [초대 메일 다시 보내기]).
-- 추가형만: 새 칸 세 개(기존 줄은 비어 있음 = 예전처럼 링크만 만든 초대). 코드는 이 칸이 아직 없어도 동작한다(읽기는 to_jsonb, 쓰기는 실패를 무시).
-- 되돌릴 때: alter table invitations drop column mail_status, drop column mail_at, drop column mail_error;
alter table invitations add column if not exists mail_status text;      -- sent(보냄) · dev(시험 환경이라 안 보냄) · failed(못 보냄) · null(보내지 않음 — 심사용 계정 등)
alter table invitations add column if not exists mail_at timestamptz;   -- 보낸(또는 시도한) 시각
alter table invitations add column if not exists mail_error text;       -- 못 보낸 까닭(앞 200자)
