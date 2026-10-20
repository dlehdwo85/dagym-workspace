-- 대표 10/20 22:30 ②(M1): 서버 게시 실행기 — 승인된 콘텐츠를 워크인 서버가 연결 계정(Meta 인스타·페이스북·스레드·유튜브)으로 게시
alter table mkt_publish_jobs add column if not exists run_after timestamptz not null default now();   -- 예정 시각 뒤에 실행
alter table mkt_publish_jobs add column if not exists payload jsonb not null default '{}';            -- 실행 중간 상태(컨테이너 id·업로드 주소·올린 미디어) — 비밀값 없음
alter table mkt_publish_jobs add column if not exists verify_until timestamptz;                       -- 결과가 모호할 때 확인 기한
create index if not exists mkt_publish_jobs_due on mkt_publish_jobs (status, run_after);
alter table mkt_publish_accounts add column if not exists refresh_enc text;                           -- 유튜브 refresh token(암호화)
alter table mkt_settings add column if not exists auto_publish boolean not null default false;        -- 승인된 글을 예정 시각에 서버가 자동 게시(연결된 채널만)
