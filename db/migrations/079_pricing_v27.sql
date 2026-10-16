-- V27 요금표 확정(2026-10-17 대표): 베이직 2,200 / 스탠다드 4,500 / 프로 8,500원(1인 월·VAT 별도·최소 3인, 연간 1,800/3,600/6,800).
-- 새 코드로 추가하고 예전 공개 요금제(개인·팀·비즈니스·베이직·스탠다드)는 고객 화면에서만 내림 — 이미 그 요금제를 쓰는 회사·우리 회사(internal)는 그대로. 추가형.
-- AI 는 회사 공유 횟수(대화 1회 ≈ 50원 기준 환산): 베이직 1인 300원분 ≈ 6회, 스탠다드 1,000원분 ≈ 20회, 프로 3,000원분 ≈ 60회.
insert into plans (code, name, monthly_krw, per_user_krw, annual_per_user_krw, min_users, limits, description, public, sort) values
  ('w_basic', '베이직', 0, 2200, 1800, 3, '{"users": null, "storageGb": null, "aiRequests": null, "perUserStorageGb": 2, "perUserAi": 6}',
    '업무·일정·캘린더·메신저·앱 알림·음성 등록 · 1인 2GB · AI 체험(회사 공유 1인당 약 300원분)', true, 31),
  ('w_standard', '스탠다드', 0, 4500, 3600, 3, '{"users": null, "storageGb": null, "aiRequests": null, "perUserStorageGb": 10, "perUserAi": 20}',
    '베이직 + 권한·결재선·자료실·업무 템플릿·문서 양식·문자/메일 발송·월 마감 보고 · 1인 10GB · AI 회사 공유 1인당 약 1,000원분', true, 32),
  ('w_pro', '프로', 0, 8500, 6800, 3, '{"users": null, "storageGb": null, "aiRequests": null, "perUserStorageGb": 30, "perUserAi": 60}',
    '스탠다드 + 부서별 공간·감사 로그·고급 권한·매출/CRM·AI 자동 분석·우선 지원 · 1인 30GB · AI 회사 공유 1인당 약 3,000원분', true, 33)
on conflict (code) do nothing;
update plans set public = false, updated_at = now() where code in ('personal', 'team', 'business', 'basic', 'standard', 'enterprise', 'team_free') and public;
-- 무료(V27-9): 5명 · AI 회사 월 20회 · 저장 1GB · 업무 총 1,000개 — 새 코드(w_free). 예전 'free' 는 구독 없는 회사의 기본값이라 건드리지 않음
-- (파일 1개 20MB·메일 하루 30통은 요금표 안내 문구, 적용은 다음 단계)
insert into plans (code, name, monthly_krw, per_user_krw, limits, description, public, sort) values
  ('w_free', '무료', 0, null, '{"users": 5, "storageGb": 1, "aiRequests": 20, "tasksTotal": 1000}',
    '5명까지 · 저장 1GB(파일 1개 20MB) · AI 회사 월 20회 · 업무 총 1,000개 · 메일 하루 30통', true, 30)
on conflict (code) do nothing;
-- 팩: AI 크레딧(회사 단위) 9,900 / 29,000 / 59,000원 · 저장 +50GB 4,000원 — 예전 팩은 새 구매에서 내림(이미 산 회사는 그대로)
insert into plan_addons (code, name, monthly_krw, adds, sort) values
  ('ai_credit_s', 'AI 크레딧 S (약 4,950원분)', 9900, '{"aiRequests": 100}', 41),
  ('ai_credit_m', 'AI 크레딧 M (약 14,500원분)', 29000, '{"aiRequests": 290}', 42),
  ('ai_credit_l', 'AI 크레딧 L (약 29,500원분)', 59000, '{"aiRequests": 590}', 43),
  ('storage50_v27', '저장 +50GB', 4000, '{"storageGb": 50}', 11)
on conflict (code) do nothing;
update plan_addons set active = false where code in ('storage20', 'storage100', 'ai100', 'ai500', 'ai2000', 'storage50', 'users10') and active;
