-- 대표 확정(10/19): 영업·마케팅에서 만든 업무도 같은 업무 표(복사 없음) — 어느 공간에서 만들었는지만 표시·필터(null = 업무 공간)
alter table tasks add column if not exists space text check (space in ('sales', 'marketing'));
create index if not exists tasks_space_idx on tasks (space) where space is not null;
