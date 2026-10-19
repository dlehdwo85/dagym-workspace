-- 운영실 이관 원본(ops_import_items) → 워크인 마케팅 표 변환(docs/research/OPS_DATA_MAPPING.md). 추가형·멱등: 같은 원본은 한 번만.
alter table mkt_contents add column if not exists src_key text;   -- 운영실 키(mkt:posts:v1 · mkt:daily:decisions:v1)
alter table mkt_contents add column if not exists src_ref text;   -- 원본 id(게시물 id · 'dYYYYMMDD-…' 항목 id)
create unique index if not exists mkt_contents_src_uq on mkt_contents (tenant, src_key, src_ref) where src_ref is not null;
-- 운영실 대표 요청 기록(요청 문장·처리 상태·결과) — 승인 대기 화면 아래 '이전 요청 기록'
create table if not exists mkt_ops_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  src_id text not null,
  text text not null default '',
  route text,
  status text not null default '',
  status_note text,
  result_summary text,
  created_at timestamptz,
  delivered_at timestamptz,
  unique (tenant, src_id)
);
