-- #545(+#534) 수정 요청 → AI 수정본(로컬 10/24 09:30 대표 요청 묶음 ⑧·④): 수정 요청 사유대로 AI 가 글과 시안을 한 버전으로 함께 고쳐 승인함에 다시 올린다.
-- 그 버전이 무엇을 반영했는지 남기는 칸 — 승인함 카드 '수정본 v3 — 반영한 요청: …' 배지·이전 버전 나란히 비교·AI 수정 횟수(콘텐츠당 3번까지).
-- {ai: true, n: 1, max: 3, from: 2, request: '첫 줄을 더 짧게', by: '대표', at, parts: ['text','visual'], photo: '바탕 사진 이름' | null}
-- 사람이 올린 수정본·예전 버전은 비어 있음(배지는 결정 기록의 수정 요청 메모로). 칸 추가만.
alter table mkt_versions add column if not exists revision jsonb;
