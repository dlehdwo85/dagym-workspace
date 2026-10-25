-- 요청 C(대표 10/25 22:20 #644~#646, MARKETING_REWORK §3-1): 피드 = 카드뉴스 3~5장(대표 결정 15-11) · 스토리 = 3~5프레임 · 블로그 = 표지 + 본문 사진 3장(실사 → 도표형 카드)
-- 사진 1장짜리는 '사진 게시물'(kind photo)로 따로 · 릴스·쇼츠·생성 영상 자동 생성은 영상 제작 방식 결정(#580) 전까지 중단(video_pause, 기본 켬 — 자동화 설정에서 끔)
alter table mkt_rules drop constraint if exists mkt_rules_kind_check;
alter table mkt_rules add constraint mkt_rules_kind_check check (kind in ('feed', 'blog', 'reels', 'video', 'shorts', 'story', 'photo'));
alter table mkt_settings add column if not exists video_pause boolean not null default true;
