-- 207차(#461, SALES_LEADS_REVAMP 2-3 '단계 = 칩(회사 설정 단계명·색)'): 리드 단계 표시 이름·색·숨김(회사별).
-- 저장 값(sales_leads.status 등)은 그대로 두고 화면에 보이는 이름만 회사가 정한다. { "단계키": { "label": "…", "color": "#RRGGBB", "hidden": true } } — null = 기본 이름
alter table tenants add column if not exists sales_stages jsonb;
