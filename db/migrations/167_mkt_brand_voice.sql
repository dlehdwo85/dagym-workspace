-- #426 P1 글 품질 엔진 ⑤ 브랜드 말투 프로필(주제·타겟·자주 쓰는 말·절대 안 쓰는 표현·존댓말/반말·이모지·파는 것·잘 된 글 예시 5개)
-- 규칙 숫자(훅·사람다움 통과 점수, 채널별 글자 수 등)는 app_settings 'mkt_quality_rules'(플랫폼 운영 › 글 품질 규칙) — 표 추가 없음
alter table mkt_brands add column if not exists voice jsonb not null default '{}'::jsonb;
