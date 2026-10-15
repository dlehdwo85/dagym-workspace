-- V27 8장 무료 요금제(B안): 숨김 'free' 를 새 값으로 갱신(기간 무제한·3명·회사 1GB·파일 20MB·메신저 90일·AI 월 10회/원가 1,000원·문서 Haiku 만·잠금 기능). 추가형.
-- 체험하기 데모 조직(demo)은 지금까지 'free' 를 썼으므로 같은 한도의 숨김 요금제로 옮겨 동작을 그대로 둔다
insert into plans (code, name, monthly_krw, per_user_krw, limits, description, public, active, sort)
  select 'demo_sandbox', '체험하기(데모)', 0, null, limits, '앱 심사·체험하기 데모 조직 전용', false, true, 99 from plans where code = 'free'
on conflict (code) do nothing;
update tenant_subscriptions set plan_code = 'demo_sandbox', updated_at = now() where tenant = 'demo' and plan_code = 'free';

update plans set name = '무료', monthly_krw = 0, per_user_krw = null, public = false, active = true, sort = 0, updated_at = now(),
    description = '3명까지 · 업무·일정·캘린더·메신저·앱 알림·음성 등록 · 회사 1GB · AI 월 10회',
    limits = '{"users": 3, "storageGb": 1, "aiRequests": 10, "fileMb": 20, "chatDays": 90, "aiCostKrw": 1000, "docHaikuOnly": true,
      "locked": ["perms", "approval_lines", "doc_templates", "send_external", "revenue", "audit", "dept_spaces"]}'::jsonb
  where code = 'free';

-- 무료 → 4번째 사람 초대 때 고르는 14일 체험(전 기능)은 공간당 1번. 그 체험이 끝나면 읽기 전용 대신 무료로 돌아간다
alter table tenant_subscriptions add column if not exists from_free boolean not null default false;
alter table tenant_subscriptions add column if not exists free_trial_used_at timestamptz;
