-- #1112(대표 11/22): 하이링크 '회원목록' 엑셀 → 월간 회원(이용권) 현황. 원본 파일·이름·연락처·동호수는 저장하지 않고 달마다 집계 숫자만(전달 대비 비교용).
-- 새 표만(추가형). 되돌릴 때: drop table branch_member_stats;
create table if not exists branch_member_stats (
  site_id uuid not null references branch_sites(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  tenant text not null,
  stats jsonb not null,        -- 시험·직원 줄 제외한 집계
  stats_all jsonb not null,    -- 제외하지 않은 집계
  excluded int not null default 0,
  file_name text,
  uploaded_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (site_id, month)
);
