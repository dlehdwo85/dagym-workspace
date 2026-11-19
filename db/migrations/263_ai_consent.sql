-- 263: AI 동의(대표 11/19 결정 — 애플 11/15 반려 5.1.2: 바깥 AI 로 보내기 전에 알리고 허락받기)
-- 사람별 동의는 consents(kind = 'ai_share', version = 안내 글 판)에 적는다 — 표를 새로 만들지 않는다.
-- 회사 스위치 '회사 자료 자동 AI 처리': 사람이 누르지 않아도 도는 작업(문의 한 줄 요약 등)이 바깥 AI 를 써도 되는지.
--   새 회사는 꺼짐에서 시작(관리자가 안내를 읽고 켬). 기본 회사(다짐)는 지금 쓰는 그대로 켜짐.
alter table tenants add column if not exists ai_auto boolean not null default false;
alter table tenants add column if not exists ai_auto_at timestamptz;
alter table tenants add column if not exists ai_auto_by uuid references users(id) on delete set null;
update tenants set ai_auto = true, ai_auto_at = now() where id = 'default' and ai_auto_at is null;
