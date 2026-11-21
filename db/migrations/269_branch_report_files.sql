-- #1106(대표 11/21): 월간 보고 C(시설별 이용 현황)는 하이링크 이용현황 파일(PDF·엑셀)을 올려 채움 — 원본 파일을 보고서에 붙여 둠(못 읽어도 첨부로).
-- 새 표만 만든다(추가형). 파일은 작음(1쪽 PDF·엑셀, 4MB 까지) → DB 에 보관, 보고서를 지우면 같이 지워짐.
-- 되돌릴 때: drop table branch_report_files;
create table if not exists branch_report_files (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  report_id uuid not null references branch_reports(id) on delete cascade,
  kind text not null default 'hilink_usage',
  name text not null,
  mime text not null,
  size int not null,
  data bytea not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (report_id, kind)
);
