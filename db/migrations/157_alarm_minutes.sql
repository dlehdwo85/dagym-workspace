-- 대표 10/21 22:00 ⑦(#420) 알람 전체화면: 일정 시작·업무 마감 기준 "N분 전"에 알람처럼(전체 화면·소리) 울리는 사람별 설정.
-- 배정·검토 요청 같은 낮은 중요도 알림은 알람 대상이 아니다(마감·일정 알림에만 meta.alarm).
alter table user_settings add column if not exists alarm_minutes int not null default 10;
