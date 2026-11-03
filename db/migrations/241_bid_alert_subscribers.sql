-- #949(대표 승인 11/04 03:4x '광고로만 유입'): 입찰 공고 아침 메일 무료 구독 — 회사 가입·카드 없이 이메일·관심 지역·관심 분야만 받는다.
-- 개인정보는 이메일 하나(발송에만 씀). 수신 거부는 메일 맨 아래 한 번 누름(token). 수신 거부 30일 뒤 줄을 지운다(정기 실행).
-- 측정: 보낸 날·건수·열람(1×1 그림) — 구독·열람·체험 전환(tenants.signup_utm->>'source' = 'bid_alert')은 플랫폼 운영 가입 흐름 칸에.
create table if not exists bid_alert_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  regions text[] not null default '{}',          -- 시·도 짧은 이름(서울·경기 …), 비면 전국
  fields text[] not null default '{}',           -- 관심 분야 키(src/lib/bidAlerts.ts BID_ALERT_FIELDS)
  token text not null unique,                    -- 수신 거부·열람 측정용(추측 불가 임의값)
  status text not null default 'active' check (status in ('active', 'unsubscribed')),
  utm jsonb,                                     -- 신청 때 브라우저가 기억한 utm(출처·매체·캠페인·소개 페이지)
  created_ip text,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  last_sent_day date,
  sent_count integer not null default 0,
  open_count integer not null default 0,
  last_opened_at timestamptz
);
create index if not exists bid_alert_subscribers_status_idx on bid_alert_subscribers (status, last_sent_day);

create table if not exists bid_alert_sends (
  day date not null,
  subscriber_id uuid not null references bid_alert_subscribers(id) on delete cascade,
  n integer not null default 0,
  opened_at timestamptz,
  primary key (day, subscriber_id)
);
