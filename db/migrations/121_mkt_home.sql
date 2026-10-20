-- ⑥ 마케팅 홈 디벨롭(대표 승인 10/20 오후): 홈 카드 켜기/끄기·순서(사람별 덮어쓰기 — 회사 기본은 app_settings 'mkt_home_cards:<tenant>'), 밤사이 비서 범위(회사 AI 설정, 기본 모두 끔)
alter table user_settings add column if not exists mkt_home_cards jsonb;
alter table ai_settings add column if not exists night_scope jsonb not null default '{}'::jsonb;
-- 밤사이 비서가 만든 결과를 아침에 묶어 보여 주기 위한 표시(자동 제작 시안·문서 작업)
alter table mkt_contents add column if not exists night_run boolean not null default false;
alter table ai_doc_jobs add column if not exists run_after timestamptz;
