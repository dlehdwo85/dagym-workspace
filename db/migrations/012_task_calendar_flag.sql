-- HQ_SIMPLIFY 3-4: 업무별 "캘린더에 표시" 스위치 (기본 켜짐, 마감일이 있어야 표시)
alter table tasks add column if not exists show_on_calendar boolean not null default true;
