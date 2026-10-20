-- 로컬 10/20(대표): "휴대폰 알람처럼 울리고 [해제]" — 일정·업무별 '알람처럼 울리기'(null = 기본값) + 사람별 기본값(일정 끔·업무 마감 끔·중요(높음·긴급) 켬). 추가만.
alter table events add column if not exists alarm boolean;
alter table tasks add column if not exists alarm boolean;
alter table user_settings add column if not exists alarm_events boolean not null default false;
alter table user_settings add column if not exists alarm_tasks boolean not null default false;
alter table user_settings add column if not exists alarm_important boolean not null default true;
-- 알람 해제·미루기 기록(activities 표 재사용: entity_type task/event, action alarm_dismissed/alarm_snoozed)
create index if not exists activities_action_recent on activities (action, created_at desc);
