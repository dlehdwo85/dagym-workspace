-- 상용화 B1(대표 위임 11/24, docs/handoff/COMMERCIAL_AUDIT_2026-11-24.md): 예전 요금제 정리 — 새로 고르거나 붙일 수 없게 active = false.
-- 남기는 것: 지금 요금표(업무 w_work · 업무 + 영업 w_sales)와 시스템 요금제(가입 체험 trial · 운영사 internal).
-- 무료(free)는 구독 없는 회사·앱 심사용 demo 의 기본값으로 계속 쓰이지만(plans.ts subscription — active 와 무관), 새로 붙이지는 않는다.
-- 이미 그 요금제를 쓰는 회사는 그대로 쓰고 갱신 결제도 된다(견적이 '그 회사의 지금 요금제'는 active 와 무관하게 허용 — billing/index.ts quote).
-- 데이터만 바꾼다(칸 추가 없음). 플랫폼 운영 › 요금제 표에서 다시 켤 수 있다.
update plans set active = false, updated_at = now()
where active and code not in ('w_work', 'w_sales', 'trial', 'internal');
