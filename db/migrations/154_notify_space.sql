-- 대표 10/20 16:00 (#104) 마케팅·영업 알림은 담당자에게만: 알림에 공간 표시 · 사람별 공간 알림 방식(담당인 것만/모두/받지 않음) · 회사 기본값 · 1시간/하루 묶음 대기열.
alter table notifications add column if not exists space text;                       -- 'work' | 'sales' | 'marketing' | null(공통)
create index if not exists notifications_space_idx on notifications (user_id, space) where space is not null;
alter table user_settings add column if not exists space_notify jsonb;                -- {"marketing":"mine"|"all"|"off","sales":...} — 비우면 회사 기본값
alter table tenants add column if not exists notify_defaults jsonb not null default '{}'; -- 회사 기본값(관리자가 정함), 없으면 'mine'(담당인 것만)
-- 담당이 아닌 사람에게 가는 알림은 바로 보내지 않고 묶어서 1건으로: 'hour' = 1시간 묶음(모두 받기로 한 사람) · 'day' = 하루 1회 묶음(담당 미지정 → 관리자 1명)
create table if not exists notification_digest_items (
  id bigserial primary key,
  tenant text not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  space text not null,
  cadence text not null check (cadence in ('hour', 'day')),
  type text not null,
  title text not null,
  body text not null default '',
  link text not null,
  entity_type text,
  entity_id text,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  flushed_at timestamptz,
  unique (user_id, dedupe_key)
);
create index if not exists notification_digest_pending_idx on notification_digest_items (user_id, space, cadence) where flushed_at is null;
