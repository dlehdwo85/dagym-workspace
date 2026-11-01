-- 304차 #871 (대표 11/01 결정: 카카오 알림톡은 결제할 때·이용약관 동의할 때만, 관리자에게만)
-- 알림톡 받을 관리자 휴대폰은 명함 전화(users.phone)와 따로 둔다(명함은 동료에게 보이므로). 동의 시각을 남긴다.
alter table users add column if not exists alimtalk_phone text;
alter table users add column if not exists alimtalk_ok boolean not null default false;
alter table users add column if not exists alimtalk_ok_at timestamptz;

-- 보낸 기록(전화번호는 남기지 않음) — 같은 안내를 두 번 보내지 않게(dedupe) · 실패 사유 · 운영 화면 건수
create table if not exists alimtalk_logs (
  id bigserial primary key,
  tenant text not null,
  user_id uuid references users(id) on delete set null,
  kind text not null,
  ok boolean not null,
  error text,
  provider text,
  message_id text,
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists alimtalk_logs_once on alimtalk_logs (dedupe_key, user_id) where dedupe_key is not null and ok;
create index if not exists alimtalk_logs_tenant on alimtalk_logs (tenant, created_at desc);
