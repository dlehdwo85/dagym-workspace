-- 로컬 10/20 묶음 규칙 보완: n일마다 규칙에 '주말 건너뛰기'(주말이면 다음 평일) — 묶음은 요일 지정도 가능(weekdays)
alter table mkt_rules add column if not exists skip_weekend boolean not null default false;
