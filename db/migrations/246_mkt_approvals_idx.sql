-- 360차(CI #535 승인함 목록이 90초 넘게 안 뜸 — 바쁜 DB에서): 승인함·캘린더 목록이 글마다 결정 기록·제작 의뢰를 찾는데
-- content_id 색인이 없어 글 수 × 표 전체를 훑었다. 색인만 추가(데이터 바뀜 없음).
create index if not exists mkt_decisions_content_idx on mkt_decisions (content_id, decided_at desc);
create index if not exists mkt_production_requests_content_idx on mkt_production_requests (content_id);
