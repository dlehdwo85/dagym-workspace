-- 355차 #939 ①②(대표 11/04 01:34 승인 — 업무 금액 그대로 · AI 포함량 1인 월 40회 기준): 운영 요금표 1인 요금 → 구간 정액.
-- 기준 문서: docs/handoff/PRICING_FINAL_2026-10-26.md §1-1. 금액은 모두 VAT 별도·월, 연간 결제 20% 할인.
-- 데이터만 바꾼다(칸 추가 없음). 플랫폼 운영 › 요금제 표에서 숫자를 다시 바꿀 수 있다(배포 없이).
--  limits.bands[]        = 구간(활성 인원 upTo 명까지): 월 금액 krw · 저장 storageGb · 회사 월 AI 예산 aiBudgetKrw(원, 내부 기준 — 화면에는 %만)
--  limits.over*          = 마지막 구간을 넘으면(51인~) 1인 금액·1인 저장·1인 AI 예산
--  limits.salesPerUserKrw = 업무+영업 51인~ 의 영업 사용자 1인 추가 금액
--  회사 AI 예산 = 1인 월 40회 × 30원 = 1인 1,200원 × 구간 최대 인원(1~5인 6,000 · 6~10인 12,000 · 11~20인 24,000 · 21~50인 60,000 · 51인~ 1인 1,200)
--  80%·100% 관리자 알림, 100%면 AI 만 멈춤(다음 달 1일 다시 채움)은 그대로(ai/companyBudget). 추가 팩도 그대로.
insert into plans (code, name, monthly_krw, per_user_krw, min_users, limits, description, public, active, sort)
values
  ('w_work', '업무', 19900, null, null,
   '{"users": null, "storageGb": null, "aiRequests": null,
     "bands": [{"upTo": 5, "krw": 19900, "storageGb": 10, "aiBudgetKrw": 6000},
               {"upTo": 10, "krw": 39900, "storageGb": 25, "aiBudgetKrw": 12000},
               {"upTo": 20, "krw": 69000, "storageGb": 60, "aiBudgetKrw": 24000},
               {"upTo": 50, "krw": 169000, "storageGb": 150, "aiBudgetKrw": 60000}],
     "overPerUserKrw": 3900, "overPerUserStorageGb": 5, "overPerUserAiBudgetKrw": 1200, "annualOffPct": 20}'::jsonb,
   '업무·프로젝트·일정·캘린더·메신저·앱 알림·전자결재·자료실·전자계약·근태 기본·AI 비서 · 구간 정액(구간 안에서는 인원이 늘어도 같은 금액)', true, true, 21),
  ('w_sales', '업무 + 영업', 34900, null, null,
   '{"users": null, "storageGb": null, "aiRequests": null,
     "bands": [{"upTo": 5, "krw": 34900, "storageGb": 10, "aiBudgetKrw": 6000},
               {"upTo": 10, "krw": 64900, "storageGb": 25, "aiBudgetKrw": 12000},
               {"upTo": 20, "krw": 109000, "storageGb": 60, "aiBudgetKrw": 24000},
               {"upTo": 50, "krw": 249000, "storageGb": 150, "aiBudgetKrw": 60000}],
     "overPerUserKrw": 3900, "overPerUserStorageGb": 5, "overPerUserAiBudgetKrw": 1200, "salesPerUserKrw": 7900, "annualOffPct": 20}'::jsonb,
   '업무 전부 + 영업 공간(입찰 공고·리드·영업기회·AI 세일즈) · 구간 정액(구간 안에서는 인원이 늘어도 같은 금액)', true, true, 22)
on conflict (code) do nothing;

-- 예전 1인 요금제(베이직·스탠다드·프로)는 고객 화면에서 내린다(외부 고객사 0곳). 지금 쓰는 회사가 있으면 그 회사는 계속 쓰고 갱신 결제도 된다(billing.quote).
update plans set public = false, updated_at = now() where code in ('w_basic', 'w_standard', 'w_pro') and public;

-- 351차 #939 ③ 후속: 고객에게 보이는 요금제 설명에서 AI '원' 금액을 뺀다(AI 는 '포함 · 남은 양 %'로만)
update plans set description = '모든 기능 · 10명 · 저장 20GB · AI 포함(회사 공유)', updated_at = now()
  where code = 'trial' and description like '%원분%';
update plans set description = regexp_replace(description, 'AI (체험\()?회사 공유 1인당 월 [0-9,]+원분\)?', 'AI 포함(회사 공유)'), updated_at = now()
  where code in ('w_basic', 'w_standard', 'w_pro') and description like '%원분%';

-- 마케팅 공간 월 금액(회사당, 구간 무관) — 금액이 비어 있을 때만(플랫폼 운영에서 이미 정했으면 그대로)
update mkt_plan_limits m set price_krw = v.krw, updated_at = now()
  from (values ('basic', 9900), ('standard', 29000), ('pro', 59000)) v(code, krw)
  where m.code = v.code and m.price_krw is null;

-- 추가 팩은 금액·내용 그대로, 고객에게 보이는 이름에서 AI '원분'만 뺀다(예: 'AI 크레딧 S (약 4,950원분)' → 'AI 크레딧 S')
update plan_addons set name = regexp_replace(name, '\s*\(약 [0-9,]+원분\)', ''), updated_at = now() where name ~ '\(약 [0-9,]+원분\)';
