-- D-18 ①(대표 11/24 승인 — 위치기반서비스사업 신고 전 준비): 위치정보 이용·제공 사실 확인자료(위치정보법 제16조 — 자동 기록·6개월 이상 보관).
-- kind: collect(출퇴근 때 좌표를 받음) · provide(회사 관리자에게 근무지 안/밖 결과가 보임) · consent(동의) · withdraw(동의 철회 — 그 사람 좌표 파기) · purge(보관 기간 지나 좌표 파기)
-- 좌표 값은 기록하지 않는다. 1년 지난 기록은 정기 실행이 지움. 추가형.
create table if not exists location_logs (
  id bigserial primary key,
  tenant text not null,
  subject_user_id uuid references users(id) on delete set null,
  viewer_user_id uuid references users(id) on delete set null,
  kind text not null check (kind in ('collect', 'provide', 'consent', 'withdraw', 'purge')),
  purpose text,
  detail jsonb not null default '{}'::jsonb,
  day date not null default ((now() at time zone 'Asia/Seoul')::date),
  created_at timestamptz not null default now()
);
create index if not exists location_logs_subject on location_logs (subject_user_id, created_at desc);
create index if not exists location_logs_tenant on location_logs (tenant, created_at desc);
-- 관리자 화면에 같은 사람 결과가 하루에 여러 번 보여도 '제공' 기록은 하루 한 줄
create unique index if not exists location_logs_provide_once on location_logs (viewer_user_id, subject_user_id, day) where kind = 'provide';
