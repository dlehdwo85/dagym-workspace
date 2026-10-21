-- 대표 10/20 14:10 ①: 사이트별 운영 집계 — 브랜드 사이트의 방문·CTA 클릭을 받는 표(공개 비콘 POST /api/public/site-event, 문의 연동 토큰으로 인증). 추가형
create table if not exists mkt_site_events (
  tenant text not null references tenants(id) on delete cascade,
  site text not null,                  -- 문의 연동 토큰의 site(dagym·hilink…) 또는 비콘이 보낸 site
  day date not null,
  event text not null check (event in ('visit', 'cta')),
  label text not null default '',      -- cta 종류(전화·문의 폼·앱 다운로드…) 또는 경로
  n int not null default 0,
  primary key (tenant, site, day, event, label)
);
create index if not exists mkt_site_events_day on mkt_site_events (tenant, day desc);
