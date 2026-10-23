-- #499-1(테크트리 EP.12·S1) 콘텐츠형(참여: 시청 지속·저장·공유·댓글) / 광고형(전환: 리드·문의 단가) — 틀과 훅 채점을 따로.
-- 자동 제작 규칙·제작의뢰·콘텐츠마다 용도. 기존 행은 모두 콘텐츠형(지금까지와 같은 채점)
alter table mkt_rules add column if not exists mode text not null default 'content' check (mode in ('content', 'ad'));
alter table mkt_briefs add column if not exists mode text not null default 'content' check (mode in ('content', 'ad'));
alter table mkt_contents add column if not exists mode text not null default 'content' check (mode in ('content', 'ad'));
