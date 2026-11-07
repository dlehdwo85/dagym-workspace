-- 381차 #1002(대표 11/07 "AI 비서가 '업무와 관련된 요청만 도와드려요'·'할 수 없다'고 하는 것을 최소화"):
-- 업무 밖 거름의 허용 낱말 — 질문에 이 낱말이 있으면 분류기 없이 통과. 관리 › AI 사용 내역에서 거름에 걸린 질문을 보고 낱말을 더해 기준을 고친다.
alter table ai_settings add column if not exists topic_allow text[] not null default '{}';
