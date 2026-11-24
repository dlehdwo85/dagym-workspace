-- #1161(대표 11/24 '위임·추천대로'): 요금은 부가세 포함 금액으로 정하고 천 원 단위로 올린다 — 화면에 보이는 금액 = 실제 결제 금액.
-- 공급가·부가세는 결제 금액에서 거꾸로 셈(공급가 = 합계 ÷ 1.1 반올림, 부가세 = 합계 − 공급가 — billing/index.ts quote).
-- 새 금액 = 지금 금액(부가세 별도) × 1.1 을 천 원 단위로 올림. 예: 업무 1~5인 19,900 → 22,000 · 업무+영업 1~5인 34,900 → 39,000 · 51인~ 1인 3,900 → 5,000 · 영업 1인 추가 7,900 → 9,000
-- 바꾸는 것: 지금 요금표(업무 w_work · 업무 + 영업 w_sales) · 쓰는 추가 팩(AI 크레딧 S·M·L · 저장 +50GB) · 마케팅 요금제(베이직·스탠다드·프로)
-- 그대로 두는 것: 예전 요금제(정리한 것 — 부가세 별도 × 1.1 로 계속 갱신) · 쓰지 않는 추가 팩
-- 연간 결제(월 환산) = 월 금액 × 0.8 을 천 원 단위로 올림(구간마다·1인 금액마다 따로) — bands.ts annualOf
-- 칸 추가는 plan_addons.vat_included 하나(추가형). 요금제는 limits.vatIncluded = true 로 표시(플랫폼 운영 › 요금제 표에서 숫자를 바꿔도 유지).

alter table plan_addons add column if not exists vat_included boolean not null default false;

update plans p set
  monthly_krw = case when p.monthly_krw is null then null else (ceil(p.monthly_krw * 1.1 / 1000) * 1000)::int end,
  limits = p.limits
    || jsonb_build_object('vatIncluded', true,
         'bands', (select jsonb_agg(b || jsonb_build_object('krw', (ceil((b->>'krw')::numeric * 1.1 / 1000) * 1000)::int) order by (b->>'upTo')::int) from jsonb_array_elements(p.limits->'bands') b))
    || case when p.limits ? 'overPerUserKrw' then jsonb_build_object('overPerUserKrw', (ceil((p.limits->>'overPerUserKrw')::numeric * 1.1 / 1000) * 1000)::int) else '{}'::jsonb end
    || case when coalesce(p.limits->>'salesPerUserKrw', '') <> '' then jsonb_build_object('salesPerUserKrw', (ceil((p.limits->>'salesPerUserKrw')::numeric * 1.1 / 1000) * 1000)::int) else '{}'::jsonb end,
  updated_at = now()
where p.code in ('w_work', 'w_sales') and jsonb_typeof(p.limits->'bands') = 'array'
  and not coalesce((p.limits->>'vatIncluded')::boolean, false);

update plan_addons set monthly_krw = (ceil(monthly_krw * 1.1 / 1000) * 1000)::int, vat_included = true, updated_at = now()
where active and not vat_included;

-- 마케팅 요금제 금액(플랫폼 운영 › 마케팅 요금제 표에 저장된 값). 값이 없으면 코드 기본값(mktAuto.ts — 11,000 · 32,000 · 65,000)
update mkt_plan_limits set price_krw = (ceil(price_krw * 1.1 / 1000) * 1000)::int, updated_at = now()
where price_krw is not null and price_krw > 0;
