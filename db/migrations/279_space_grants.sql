-- #1139 상용화 A4(로컬 검수 11/24 · 대표 위임): 공간이 왜 열렸는지 — 'operator'(상담 후 운영자가 엶·결제와 무관) · 'plan'(업무+영업 결제로 열림 → 해지·미납이면 다시 잠금, 자료는 그대로)
-- 마케팅은 운영자가 회사 상세에서 정한 요금제를 결제 금액에 합칠 때 'plan' (추가형)
alter table tenants add column if not exists space_grants jsonb not null default '{}'::jsonb;
-- 이미 켜진 공간은 모두 운영자가 연 것으로 — 결제 상태가 바뀌어도 지금 켜진 회사는 그대로(잠기지 않음, 금액도 그대로)
update tenants set space_grants = space_grants
  || case when 'sales' = any(coalesce(spaces, '{}')) and not (space_grants ? 'sales') then '{"sales":"operator"}'::jsonb else '{}'::jsonb end
  || case when 'marketing' = any(coalesce(spaces, '{}')) and not (space_grants ? 'marketing') then '{"marketing":"operator"}'::jsonb else '{}'::jsonb end;
