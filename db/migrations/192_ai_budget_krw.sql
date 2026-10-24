-- 대표 10/24 ②: 요금제별 회사 월 AI 예산(원) — 플랫폼 운영 › 요금제 표에서 바꾸는 설정값(배포 없음). 데이터만(칸 추가 없음)
-- plans.limits.aiBudgetKrw = 회사 월 예산 고정액(원), perUserAiBudgetKrw = 1인 월 예산(원, 회사 예산 = 1인 × 결제 인원(최소 인원 이상))
-- 14일 체험 5,000원은 대표 결정(10/24). 베이직 500 · 스탠다드 1,200 · 프로 3,000원(1인)은 원가 기준 초안 — 대표 결정 뒤 운영 화면에서 바꾼다
-- 원 예산을 넣은 요금제는 요청 횟수 한도(aiRequests·perUserAi)를 비워 '원' 하나로 멈춘다(운영 화면에서 횟수를 다시 넣으면 둘 다 적용)
-- 이미 원 예산이 들어간 요금제·팩은 건드리지 않는다
update plans set limits = (limits - 'aiRequests' - 'perUserAi') || '{"aiBudgetKrw": 5000}'::jsonb,
    description = replace(description, 'AI 300회', 'AI 5,000원분'), updated_at = now()
  where code = 'trial' and not (limits ? 'aiBudgetKrw') and not (limits ? 'perUserAiBudgetKrw');

update plans p set limits = (p.limits - 'aiRequests' - 'perUserAi') || jsonb_build_object('perUserAiBudgetKrw', v.krw),
    description = replace(p.description, v.old_text, v.new_text), updated_at = now()
  from (values ('w_basic', 500, '1인당 약 300원분', '1인당 월 500원분'),
               ('w_standard', 1200, '1인당 약 1,000원분', '1인당 월 1,200원분'),
               ('w_pro', 3000, '1인당 약 3,000원분', '1인당 월 3,000원분')) v(code, krw, old_text, new_text)
  where p.code = v.code and not (p.limits ? 'aiBudgetKrw') and not (p.limits ? 'perUserAiBudgetKrw');

-- AI 크레딧 팩: 이름의 'n원분'을 회사 AI 예산에 더한다(요청 횟수 adds 는 예전 요금제용으로 그대로 둠)
update plan_addons a set adds = a.adds || jsonb_build_object('aiBudgetKrw', v.krw), updated_at = now()
  from (values ('ai_credit_s', 4950), ('ai_credit_m', 14500), ('ai_credit_l', 29500)) v(code, krw)
  where a.code = v.code and not (a.adds ? 'aiBudgetKrw');
