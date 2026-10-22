-- 광고 2차 ① Meta 리드 광고 → 영업 리드 자동 등록(2026-10-23). 추가형.
-- 리드 광고를 받는 페이스북 페이지(게시 연결 계정 1개 = 1행) — 페이지에 앱 설치(subscribed_apps leadgen)·웹후크 마지막 수신·놓친 리드 불러오기 기록
create table if not exists mkt_lead_pages (
  account_id uuid primary key references mkt_publish_accounts(id) on delete cascade,
  tenant text not null references tenants(id) on delete cascade,
  page_id text not null,
  enabled boolean not null default true,
  enabled_by uuid references users(id) on delete set null,
  subscribed_at timestamptz,
  webhook_at timestamptz,
  polled_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
create index if not exists mkt_lead_pages_page on mkt_lead_pages (page_id);
-- 리드 광고로 들어온 신청 1건 = 1행(같은 리드는 한 번만 — leadgen_id). 개인정보(이름·전화·답)는 영업 리드에만 두고 여기는 처리 기록만
create table if not exists mkt_meta_leads (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  account_id uuid references mkt_publish_accounts(id) on delete set null,
  page_id text not null,
  leadgen_id text not null,
  form_id text,
  form_name text,
  ad_id text,
  ad_name text,
  campaign_name text,
  platform text,
  is_test boolean not null default false,
  created_by uuid references users(id) on delete set null, -- [시험 리드 보내기]를 누른 사람(시험 알림은 이 사람에게만)
  created_time timestamptz,           -- Meta 에서 신청한 때
  via text not null check (via in ('webhook', 'poll', 'test')),
  status text not null default 'pending' check (status in ('pending', 'working', 'created', 'merged', 'failed', 'skipped')),
  attempts int not null default 0,
  error text,
  lead_id uuid references sales_leads(id) on delete set null,
  owner_id uuid references users(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  contacted_at timestamptz,           -- 첫 연락: 상담 기록·단계 변경·[전화]/[문자] 누름·첫 연락 업무 완료 중 가장 이른 것
  contact_via text,
  late_notified_at timestamptz,       -- 5분 넘게 연락 기록이 없어 다시 알린 때
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, leadgen_id)
);
create index if not exists mkt_meta_leads_recent on mkt_meta_leads (tenant, received_at desc);
create index if not exists mkt_meta_leads_state on mkt_meta_leads (status, received_at);
create index if not exists mkt_meta_leads_lead on mkt_meta_leads (lead_id);
