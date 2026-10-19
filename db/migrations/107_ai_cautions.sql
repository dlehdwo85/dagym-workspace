-- 로컬 10/19(대표): 회사 정보 'AI 로 정리' — 주의할 점(금지어·과장 금지·업종 광고 규정)을 말투와 따로 저장. AI 비서·메일 시안·마케팅·영업 제안서가 같이 씀
alter table tenants add column if not exists ai_cautions text;
