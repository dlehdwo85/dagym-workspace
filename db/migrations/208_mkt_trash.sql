-- 183차 #177(로컬 10/23 요청 · 대표 "비슷한 글은 하나만 남기고 나머지 삭제"): 마케팅 콘텐츠 휴지통. 추가형.
-- 관리자가 지운 글 = status 'canceled' + deleted_at(누가 deleted_by · 원래 상태 deleted_from) → 승인함·캘린더·게시·칸 검사가 모두 status 로 거르므로 그 자리에서 빠짐.
-- 30일 안에 [되살리기]하면 deleted_from 상태로 돌아가고, 30일 지나면 정기 실행(src/lib/mktTrash.ts purgeTrash)이 행을 지움(버전·결정·게시 작업·제작 요청은 외래키로 함께).
alter table mkt_contents add column if not exists deleted_at timestamptz;
alter table mkt_contents add column if not exists deleted_by uuid references users(id) on delete set null;
alter table mkt_contents add column if not exists deleted_from text;
create index if not exists mkt_contents_trash_idx on mkt_contents (tenant, deleted_at) where deleted_at is not null;
