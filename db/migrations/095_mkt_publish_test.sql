-- 로컬 검수(10/18): 시험 콘텐츠도 게시 도우미·[게시 확인]으로 검수 — 게시 기록에 시험 표시(서버 게시는 계속 막음)
alter table mkt_publish_jobs add column if not exists is_test boolean not null default false;
