-- 254차 #788(대표 10/29 00:40 "소상공인 혹은 기업 정부지원금 등도 확인 할 수 있도록", 00:50 승인): 행정안전부 대한민국 공공서비스(혜택) 정보(정부24, 공공데이터포털 15113968) 원천.
-- 원천 이름 'gov24' 를 받게 넓힘(기존 값은 그대로) + 지원 조건 코드(supportConditions 의 JA 코드 중 'Y' — 소상공인 JA11xx·법인/단체 JA21xx·업종 JA22xx). 추가만.
alter table support_programs drop constraint if exists support_programs_source_check;
alter table support_programs add constraint support_programs_source_check check (source in ('bizinfo', 'kstartup', 'watch', 'manual', 'gov24'));
alter table support_programs add column if not exists conditions text[] not null default '{}';
