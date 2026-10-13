-- V7 4번: 캘린더 색은 개인/회사 두 가지 — 사용자별 선택 + 대표가 정하는 모두의 기본값 (추가형)
alter table user_settings add column if not exists cal_colors jsonb;
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
