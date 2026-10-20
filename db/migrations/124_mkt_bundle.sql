-- 대표 10/20 오후 6): 자동 제작 게시 주기 기본값 하루 1개 → 2~3일에 1묶음(유튜브 쇼츠 1 · 인스타 릴스 1 · 블로그 1 · 인스타·페이스북 게시물 1(같은 글) · 인스타·페이스북 스토리 1), 브랜드마다
-- 종류에 쇼츠(세로 영상)·스토리(세로 1080×1920, 24시간) 추가, 규칙에 'n일마다'(요일 대신)·같은 글을 함께 올릴 채널·묶음 키
alter table mkt_rules drop constraint if exists mkt_rules_kind_check;
alter table mkt_rules add constraint mkt_rules_kind_check check (kind in ('feed', 'blog', 'reels', 'video', 'shorts', 'story'));
alter table mkt_rules add column if not exists interval_days int check (interval_days between 1 and 30);   -- null = weekdays 규칙
alter table mkt_rules add column if not exists anchor_date date;                                               -- n일마다 시작일(서울)
alter table mkt_rules add column if not exists cross_channels text[] not null default '{}';                    -- 같은 글을 함께 올릴 채널(예: instagram 규칙에 {facebook})
alter table mkt_rules add column if not exists bundle_key uuid;                                                -- 한 묶음으로 만든 규칙들
alter table mkt_contents add column if not exists cross_channels text[] not null default '{}';                 -- 승인 1건으로 여러 채널(M1 게시 실행기가 씀)
