-- 275차 #809(대표 10/29 '상용화 했을 때 기준으로 시험'): 마케팅 글 작성 AI 비용을 콘텐츠(→ 브랜드)별로 나누려고 어느 글의 비용인지 남김. 비어 있으면 예전 기록·키트 AI 등
alter table ai_usage add column if not exists mkt_content_id uuid;
