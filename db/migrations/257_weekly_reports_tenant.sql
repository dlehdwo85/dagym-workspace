-- 408차 범용화 G-17(대표 11/13 승인): 주간 보고를 회사별로 — 예전엔 기본 회사(다짐)만 만들어져 다른 회사의 [주간 보고] 메뉴는 영원히 비어 있었다.
-- 지금까지의 보고는 모두 기본 회사 것(tenant 기본값 'default'). 주당 1건 제약을 '회사별 주당 1건'으로 바꾼다.
alter table weekly_reports add column if not exists tenant text not null default 'default';
alter table weekly_reports drop constraint if exists weekly_reports_week_start_key;
create unique index if not exists weekly_reports_tenant_week on weekly_reports (tenant, week_start);
