-- 2026-10-15 대표 지시 "알림이 너무 많다 — 중요한 것만": 기본값 정리(각자 설정 > 알림에서 다시 켤 수 있음)
-- ① 지시한 업무의 마감 알림 사본(하루 전·오늘 마감·1시간 전) 기본 끔 — 지시자는 완료·보류·검토 요청·기한 초과만
alter table user_settings alter column requester_due_alerts set default false;
update user_settings set requester_due_alerts = false where requester_due_alerts;
-- ② 마감 하루 전(마감 임박 24시간) 기본 끔(0 = 받지 않음) — 당일 9시 "오늘 마감" + 1시간 전만
alter table user_settings alter column due_soon_hours set default 0;
update user_settings set due_soon_hours = 0 where due_soon_hours = 24;
