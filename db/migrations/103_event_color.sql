-- 대표 지적(10/19 캘린더 ②): 일정별 색 덮어쓰기(Google 캘린더 '일정 색'). 비어 있으면 캘린더·사람 색
alter table events add column if not exists color text;
