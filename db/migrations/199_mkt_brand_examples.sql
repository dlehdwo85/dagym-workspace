-- #235 ⓔ 브랜드별·형식별 잘 된 예시 글(구성·첫 줄·문단 흐름 참고) — 브랜드 키트에서 넣거나 승인·게시 글 [좋은 예시로 저장]
-- 항목: { kind: feed|blog|video|story, text, note?, contentId?, at }
alter table mkt_brands add column if not exists examples jsonb not null default '[]'::jsonb;
