-- 대표 10/21 12:00 영업 재편 6) (#408): 업종 중립 문구 — 회사별 영업 용어 템플릿.
-- null = 회사 업종(industries)으로 자동 추정. 첫 회사(시설 위탁 운영)만 시드 데이터로 'facility' 고정 — 코드에는 회사 이름·업종을 박지 않는다.
alter table tenants add column if not exists sales_template text;
update tenants set sales_template = 'facility' where id in ('default', 'demo') and sales_template is null;
