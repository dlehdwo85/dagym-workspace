-- V41 단계 2 영업관리 이전 2) 적용: 원본(Supabase) 행을 그대로 워크인에 옮김(원본 id 기준 멱등). V39 C: 공용(scope='global') / 회사별(scope=회사 id).
-- 공용 표 안의 회사별 진행 칸(분류 변경·연락 상태·메모 등)은 '<표>__progress' 로 떼어 회사 쪽에. 표 매핑·화면은 다음 단계.
create table if not exists sales_src_rows (
  scope text not null,
  tbl text not null,
  src_id text not null,
  row jsonb not null,
  gone boolean not null default false,      -- 원본에서 사라짐(지우지 않고 표시)
  synced_at timestamptz not null default now(),
  primary key (scope, tbl, src_id)
);
create table if not exists sales_src_sync (
  tenant text not null,
  tbl text not null,
  src_count int, dst_count int, error text,
  synced_at timestamptz not null default now(),
  primary key (tenant, tbl)
);
-- 원본 사용자(profiles) → 워크인 사용자(이메일 일치, 없으면 대표)
create table if not exists sales_user_map (
  tenant text not null,
  src_user_id text not null,
  user_id uuid references users(id) on delete set null,
  email text, name text, matched boolean not null default false,
  primary key (tenant, src_user_id)
);
