-- 17차: 무료 요금제 폐지 → 유료 요금제 + 14일 무료 체험(카드 없음). 금액·한도는 DB 값(플랫폼 운영 화면에서 변경). 추가형.
alter table plans add column if not exists annual_monthly_krw int;   -- 연간 결제 시 월 환산(개인)
alter table plans add column if not exists annual_per_user_krw int;  -- 연간 결제 시 1인 월 환산
alter table plans add column if not exists min_users int;            -- 최소 인원(팀 3인)

alter table tenant_subscriptions drop constraint if exists tenant_subscriptions_status_check;
alter table tenant_subscriptions add constraint tenant_subscriptions_status_check check (status in ('active', 'trial', 'suspended', 'expired'));
alter table tenant_subscriptions add column if not exists trial_ends_at timestamptz;
alter table tenant_subscriptions add column if not exists trial_notified jsonb not null default '{}';  -- {"d3": true, "d1": true, "d0": true}
alter table tenant_subscriptions add column if not exists chosen_plan text;                          -- 체험 중 고른(신청한) 요금제

insert into plans (code, name, monthly_krw, per_user_krw, limits, description, public, sort) values
  ('trial', '14일 무료 체험', 0, null, '{"users": 10, "storageGb": 20, "aiRequests": 300}', '비즈니스 기능 전부 · 10명 · 20GB · AI 300회', false, 1)
on conflict (code) do nothing;
-- 개인 2,900원 / 팀 1인 3,900원(최소 3인) / 비즈니스 1인 6,900원 — 이미 운영 화면에서 바꾼 값은 건드리지 않도록 무료(0) 상태일 때만
update plans set monthly_krw = 2900, annual_monthly_krw = 2400, limits = '{"users": 1, "storageGb": 5, "aiRequests": 50}',
    description = '1명 · 업무·일정·알림·캘린더 전부 · 저장 5GB · AI 월 50회', public = true, sort = 5, updated_at = now()
  where code = 'personal' and coalesce(monthly_krw, 0) = 0;
update plans set per_user_krw = 3900, annual_per_user_krw = 3300, min_users = 3, monthly_krw = 0,
    limits = '{"users": null, "perUserStorageGb": 3, "perUserAi": 50}', description = '최소 3인 · 팀·메신저·권한 · 1인 3GB(회사 합산) · 1인 AI 월 50회', public = true, sort = 15, updated_at = now()
  where code = 'team' and min_users is null;
update plans set name = '비즈니스', monthly_krw = 0, per_user_krw = 6900, annual_per_user_krw = 5900, min_users = 3,
    limits = '{"users": null, "perUserStorageGb": 10, "perUserAi": 150}', description = '감사 로그·기밀 등급·고급 권한·우선 지원 · 1인 10GB · 1인 AI 월 150회', public = true, sort = 25, updated_at = now()
  where code = 'business' and coalesce(per_user_krw, 0) <> 6900 and annual_per_user_krw is null;
-- 무료 요금제는 새 가입·요금표에서 내림(이미 쓰는 공간은 그대로 두고, 아래에서 체험으로 옮김)
update plans set public = false where code in ('free', 'team_free', 'basic') and public;
-- 팩(유지): 저장 +20GB 3,000원 / +100GB 9,900원 · AI 100회 3,000원 / 500회 9,900원
update plan_addons set active = true where code in ('storage20', 'storage100', 'ai100', 'ai500');
update plan_addons set active = false where code = 'ai2000' and active;

-- 이미 무료 요금제로 가입한 공간(공개 가입 공간 t_*): 오늘부터 14일 체험
update tenant_subscriptions set plan_code = 'trial', status = 'trial', trial_ends_at = now() + interval '14 days', period_end = (now() + interval '14 days')::date,
    updated_at = now()
  where tenant like 't\_%' and plan_code in ('personal', 'team_free', 'free') and status = 'active';
