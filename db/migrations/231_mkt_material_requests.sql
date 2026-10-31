-- 296차 #836(대표 10/31 '사진이나 자료를 업로드하는 걸 요청하는 요청 페이지 — AI 마케터가 요청할 자료가 있으면 더 높은 퀄리티가 나올 수 있도록'):
-- 마케팅 › 자료 요청. AI 마케터(자동) 또는 사람이 브랜드별로 '필요한 사진·영상·앱 화면'을 요청 → 담당이 그 자리에서 올림 → 자료실 '마케팅/브랜드 자료/{브랜드}' →
-- 받은 자료로 그 브랜드의 단색 표지 글을 다시 그림 → 시안에 쓰이면 '사용함'. 추가형(새 표만)
create table if not exists mkt_material_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  brand_id uuid references mkt_brands(id) on delete set null,
  content_id uuid references mkt_contents(id) on delete set null,   -- 요청을 낳은 글(없을 수 있음)
  kind text not null default 'photo' check (kind in ('photo', 'video', 'screen', 'other')),
  title text not null,
  detail text not null default '',
  wanted int not null default 5 check (wanted between 1 and 50),
  assignee_id uuid references users(id) on delete set null,
  due_on date not null,
  status text not null default 'requested' check (status in ('requested', 'received', 'used', 'canceled')),
  file_ids uuid[] not null default '{}',
  source text not null default 'ai' check (source in ('ai', 'manual')),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  received_at timestamptz,
  used_at timestamptz
);
create index if not exists mkt_material_requests_tenant_idx on mkt_material_requests (tenant, status, due_on);
-- AI 요청은 브랜드·종류마다 열린 것 하나만(같은 요청이 쌓이지 않게)
create unique index if not exists mkt_material_requests_ai_open on mkt_material_requests (tenant, brand_id, kind) where status = 'requested' and source = 'ai';
