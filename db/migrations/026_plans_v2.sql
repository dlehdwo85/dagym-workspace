-- V12 1번: 요금제 2안 (추가형 — 운영 화면에서 이미 바꾼 값은 건드리지 않음)
alter table plans add column if not exists per_user_krw int;  -- 1인당 월 요금(베이직)
-- limits 에 perUserStorageGb·perUserAi 가 있으면 "활성 사용자 수 × 1인 한도"(회사 합산)

update plans set limits = '{"users": 20, "storageGb": 1, "aiRequests": 10}', description = '20명까지 · 회사 저장 1GB · AI 월 10회', updated_at = now()
  where code = 'free' and limits = '{"users": 5, "storageGb": 2, "aiRequests": 30}'::jsonb;
insert into plans (code, name, monthly_krw, per_user_krw, limits, description, public, sort) values
  ('basic', '베이직', null, 1500, '{"users": null, "storageGb": null, "aiRequests": null, "perUserStorageGb": 1, "perUserAi": 20}', '인원 무제한 · 1인 1GB(회사 합산) · 1인 AI 월 20회', true, 20)
on conflict (code) do nothing;
-- 1안 요금제(스탠다드·비즈니스)는 새 가입에 보이지 않게만 (이미 쓰는 회사는 그대로)
update plans set public = false where code in ('standard', 'business') and public;

-- 팩: 여러 개 구매 가능
update plan_addons set active = false where code in ('storage50', 'users10') and active;
update plan_addons set name = 'AI 500회 팩', monthly_krw = 9900, sort = 50 where code = 'ai500' and monthly_krw = 10000;
insert into plan_addons (code, name, monthly_krw, adds, sort) values
  ('storage20', '저장 +20GB 팩', 3000, '{"storageGb": 20}', 10),
  ('storage100', '저장 +100GB 팩', 9900, '{"storageGb": 100}', 20),
  ('ai100', 'AI 100회 팩', 3000, '{"aiRequests": 100}', 40),
  ('ai2000', 'AI 2,000회 팩', 33000, '{"aiRequests": 2000}', 60)
on conflict (code) do nothing;
