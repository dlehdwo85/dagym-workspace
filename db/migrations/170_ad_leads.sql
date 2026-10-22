-- 광고 최적화 1차 ③ 통화 기반 최적화(2026-10-23). 추가형.
-- 브랜드 사이트 비콘의 전화·버튼 클릭 중 광고로 들어온 것(랜딩 주소의 네이버 자동 추적 n_*·utm·gclid)을 키워드별 하루 합계로 센다
create table if not exists mkt_ad_leads (
  tenant text not null references tenants(id) on delete cascade,
  day date not null,
  provider text not null check (provider in ('naver', 'google', 'meta', 'other')),
  keyword_key text not null default '',      -- 띄어쓰기 없앤 소문자(키워드 비교 키)
  keyword_id text not null default '',       -- 네이버 nccKeywordId(자동 추적 n_keyword_id) — 있으면 이것으로 맞춤
  kind text not null check (kind in ('tel', 'cta')),
  keyword text not null default '',          -- 화면 표시용(마지막으로 받은 모양)
  n int not null default 0,
  primary key (tenant, day, provider, keyword_key, keyword_id, kind)
);
create index if not exists mkt_ad_leads_day on mkt_ad_leads (tenant, day desc);
-- 전화 기록: "어떻게 알고 전화하셨어요?" → 광고 키워드(알면)
alter table mkt_calls add column if not exists ad_keyword text;
alter table mkt_calls add column if not exists ad_provider text check (ad_provider is null or ad_provider in ('naver', 'google', 'meta', 'other'));
-- 목표 전환당 비용(원) — 비우면 기간 평균
alter table mkt_settings add column if not exists target_cpa int check (target_cpa is null or (target_cpa >= 1000 and target_cpa <= 10000000));
