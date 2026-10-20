-- 대표 10/20 10:50: 업종을 여러 개(다짐처럼 소프트웨어 + 시설 위탁운영) — industries[] 가 정본, industry 는 첫 값(주 업종, 기존 호환)
alter table tenants add column if not exists industries text[] not null default '{}';
update tenants set industries = array[industry] where industry is not null and industry <> '' and industries = '{}';
