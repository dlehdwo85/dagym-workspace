-- 251차 #783·#784(대표 10/28 "어떤 효과를 볼 수 있는지 분석 · 리스트업 정리"): AI 판단에 기대 효과(받는 것·예상 금액·자부담·준비 시간·사업별 한 줄·확인할 회사 정보)
-- · '이번 주 신청 목록'에 담기(회사별 공고 하나에 한 번, 담은 사람·때) — 추가만
alter table support_matches add column if not exists ai_effect jsonb;
alter table support_matches add column if not exists listed_at timestamptz;
alter table support_matches add column if not exists listed_by uuid references users(id) on delete set null;
-- 로컬 10/28 23:50: 판단 때 1차 규칙 결과(fit·maybe·no) — 규칙 '해당 없음'이 AI '확인 필요'보다 앞서고, 규칙이 바뀌면 다시 판단 · '보유 인증 없음'(빈칸과 구분)
alter table support_matches add column if not exists ai_rule_verdict text;
alter table support_profiles add column if not exists certs_none boolean not null default false;
