-- #499-3 리드 단계 → Meta 전환 API(CAPI for CRM — 메타 공식 'Conversions API for CRM integration').
-- 리드 광고로 들어온 영업 리드의 단계를 메타 리드 ID(leadgen_id, 15~17자리 — 문자열로 저장)와 함께 회사의 메타 CRM 데이터 세트로 돌려보낸다.
-- 회사마다 켜기·데이터 세트 ID·토큰(암호화)·단계 이름표. 기본 꺼짐(개인정보 처리방침 문구는 대표 결정 뒤 켬).
alter table mkt_settings add column if not exists capi jsonb not null default '{}'::jsonb; -- {on, datasetId, source, map{워크인 단계: 메타 이벤트 이름}, since}
alter table mkt_settings add column if not exists capi_token_enc text;                      -- 이벤트 관리자 › 데이터 세트 설정 › 전환 API 에서 만든 토큰(암호화)

-- 보낼 이벤트 1건 = 메타 리드 1건의 한 단계(같은 이름은 메타 리드마다 한 번). pending → sent / failed(3번 실패) / skipped(7일 지남 등)
create table if not exists mkt_capi_events (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  meta_lead_id uuid not null references mkt_meta_leads(id) on delete cascade,
  leadgen_id text not null,
  lead_id uuid references sales_leads(id) on delete set null,
  event_name text not null,
  stage text not null,                 -- 이 이벤트를 만든 워크인 단계(건너뛴 앞 단계를 채운 것이면 그 앞 단계 이름)
  event_time timestamptz not null,     -- 단계가 바뀐 시각(메타: 보내는 때로부터 7일 안, 리드 생성 뒤)
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  error text,
  fbtrace_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (meta_lead_id, event_name)
);
create index if not exists mkt_capi_events_due on mkt_capi_events (tenant, status, event_time);
