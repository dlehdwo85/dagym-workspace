-- 250차 #785(대표 10/28 23:00 "항상 지원사업 올릴 때 AI 비서 돌리세요"): 새 공고가 올라오면 회사 프로필로 AI 판단을 자동으로(회사 AI 예산 안)
-- auto_ai: 회사별 켜기·끄기(기본 켬, 관리자가 프로필에서 끔) · basis_at: 판단 기준 칸(지역·설립일·규모·근로자·매출·업종·인증)이 바뀐 때 — 그 전 AI 판단은 '예전 프로필 기준' → 다시 판단
-- auto_state: 마지막 자동 판단 결과(판단 수·실패·예산 멈춤) · support_matches.auto_fail: 자동 판단 실패 횟수(3번 실패한 공고는 자동으로 다시 안 함)
alter table support_profiles add column if not exists auto_ai boolean not null default true;
alter table support_profiles add column if not exists basis_at timestamptz;
alter table support_profiles add column if not exists auto_state jsonb;
alter table support_matches add column if not exists auto_fail int not null default 0;
