-- 로컬 마케팅 시안 60건 검수(10/24, docs/handoff/MKT_QA_2026-10-24.md) 생성 규칙 ③·⑤:
-- facts = 브랜드 '사실 카드' — 글 안에 직접 쓰는 연락처(전화·문의 링크·홈페이지·주소)·운영 시간·요금·써도 되는 숫자(근거와 함께)·섞으면 안 되는 이름.
--   AI 원고는 카드에 있는 숫자·가격·시간만 쓰고, 연락처는 '이미지 참조' 대신 글에 그대로 쓴다(없으면 자동 제작이 마지막 줄에 붙임).
--   {phone, link, website, address, hours, prices, numbers, avoidNames: []}
-- topic_pool = 브랜드 '주제 풀'(한 줄에 하나) — 회사 공통 주간 주제가 모든 브랜드에 같은 주제로 내려가던 것(18건) 대신 브랜드마다 돌려 씀.
-- 칸 추가만(값은 브랜드 키트 화면에서 — 회사 이름·연락처를 코드에 넣지 않음).
alter table mkt_brands add column if not exists facts jsonb not null default '{}'::jsonb;
alter table mkt_brands add column if not exists topic_pool text[] not null default '{}';
