-- 점검 1단계 — 점검 가이드(분야 · 공간 유형 · 공간 · 점검 항목 · 개정 이력 · 사진)
-- 대표 11/19 "점검 개발 시작" (docs/check-feature-design.md · docs/reference/prompt-b-check-feature.md)
-- 새 표만 만든다 — 기존 표는 건드리지 않음(기본 회사 화면·자료 영향 없음). 모든 표에 회사(tenant) 칸.
-- 되돌릴 때: drop table chk_photos, chk_item_versions, chk_items, chk_places, chk_place_types, chk_categories;

create table if not exists chk_categories (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  parent_id uuid references chk_categories(id) on delete cascade,
  name text not null,
  icon text,
  sort int not null default 0,
  active boolean not null default true,
  tpl_key text,                                  -- 템플릿에서 온 줄의 열쇠(다시 설치해도 겹치지 않게)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chk_categories_tenant on chk_categories(tenant, parent_id, sort);
create unique index if not exists chk_categories_tpl on chk_categories(tenant, tpl_key) where tpl_key is not null;

create table if not exists chk_place_types (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  tpl_key text,
  created_at timestamptz not null default now()
);
create index if not exists chk_place_types_tenant on chk_place_types(tenant, sort);
create unique index if not exists chk_place_types_tpl on chk_place_types(tenant, tpl_key) where tpl_key is not null;

create table if not exists chk_places (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  org_unit_id uuid not null references org_units(id) on delete cascade,
  place_type_id uuid references chk_place_types(id) on delete set null,
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists chk_places_unit on chk_places(tenant, org_unit_id, sort);

create table if not exists chk_items (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  title text not null,
  category_id uuid references chk_categories(id) on delete set null,
  place_type_ids uuid[] not null default '{}',
  unit_scope text not null default 'all' check (unit_scope in ('all', 'some')),
  org_unit_ids uuid[] not null default '{}',
  method text not null default 'look' check (method in ('look', 'operate', 'record', 'photo', 'observe')),
  method_note text,
  pass_criteria text not null default '',
  blind_spots text[] not null default '{}',
  fix_action jsonb not null default '{}'::jsonb,   -- { note, role, dueDays, external }
  cycle text,                                      -- daily · weekly · monthly · quarterly · yearly · as_needed
  checker_role text,
  external_ref text,
  basis_note text,
  share_staff boolean not null default false,
  version int not null default 1,
  active boolean not null default true,
  tpl_key text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chk_items_tenant on chk_items(tenant, active, category_id);
create unique index if not exists chk_items_tpl on chk_items(tenant, tpl_key) where tpl_key is not null;

create table if not exists chk_item_versions (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  item_id uuid not null references chk_items(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  reason text,
  by_user uuid references users(id) on delete set null,
  at timestamptz not null default now(),
  unique (item_id, version)
);

create table if not exists chk_photos (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  owner_kind text not null check (owner_kind in ('item', 'result', 'followup')),
  owner_id uuid not null,
  storage_key text not null,
  file_name text,
  mime_type text,
  size_bytes bigint not null default 0,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'ready')),
  taken_at timestamptz,
  by_user uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chk_photos_owner on chk_photos(tenant, owner_kind, owner_id);
