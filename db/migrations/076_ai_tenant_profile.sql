-- 상용화: AI 비서를 회사마다 따로 — 회사 소개·주요 고객·말투(사람이 적음)를 AI 문맥에 넣는다. 업종은 tenants.industry(063). 추가형.
alter table tenants add column if not exists ai_business text;   -- 사업 소개·방향(무엇을 하는 회사인지, 강조점)
alter table tenants add column if not exists ai_customers text;  -- 주요 고객
alter table tenants add column if not exists ai_tone text;       -- 고객에게 쓰는 말투·금지 표현
-- 기존 회사(다짐·하이링크)는 업종을 채워 둔다(비어 있을 때만)
update tenants set industry = '운동·피트니스' where id = 'default' and industry is null;
-- 템플릿 회사 칸 바로잡기: 예전 [템플릿 만들기]가 회사 칸을 비워 'default' 로 저장됐다 → 만든 사람(조직 템플릿은 그 조직)의 회사로
update templates t set tenant = o.tenant from org_units o where o.id = t.org_unit_id and t.tenant <> o.tenant;
update templates t set tenant = u.tenant from users u where u.id = t.created_by and t.org_unit_id is null and t.tenant <> u.tenant;
