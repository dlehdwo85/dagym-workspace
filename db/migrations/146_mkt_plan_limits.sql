-- 대표 10/20 15:40 (#103): 요금제별 마케팅 제작 범위·금액을 플랫폼 운영에서 숫자만 바꾸게(배포 없음). 기본값은 코드(MKT_PLANS) 와 같고, 가격·초과 크레딧 금액은 대표 결정 전 null. 추가형
create table if not exists mkt_plan_limits (
  code text primary key check (code in ('basic', 'standard', 'pro')),
  label text not null,
  price_krw int,                                   -- 월 요금(원), null = 결정 전
  monthly_credits numeric(10, 2) not null,
  weekly jsonb not null default '{}'::jsonb,       -- {feed, blog, reels, shorts, story} 주간 제작 수
  video_monthly int not null default 0,            -- 생성 영상 편수/월
  regen_monthly int not null default 0,            -- 재생성 횟수/월
  ai_monthly_usd numeric(8, 2),
  extra_credit_krw int,                            -- 초과 크레딧 1크레딧당 추가 구매 금액(원), null = 결정 전
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into mkt_plan_limits (code, label, price_krw, monthly_credits, weekly, video_monthly, regen_monthly, ai_monthly_usd) values
  ('basic', '베이직', null, 30, '{"feed": 2, "blog": 1}', 0, 2, 3),
  ('standard', '스탠다드', null, 80, '{"feed": 3, "blog": 1, "reels": 1}', 0, 6, 6),
  ('pro', '프로', null, 250, '{"feed": 5, "blog": 2, "reels": 2}', 2, 10, 15)
on conflict (code) do nothing;
-- 실측 원가(대표 10/20): 이미지 6.5·영상 80 크레딧, 1크레딧 ≈ 43~70원 — 플랫폼 운영에서 바꿀 수 있음
insert into app_settings (key, value) values ('mkt_credit_cost', '{"imageCredits": 6.5, "videoCredits": 80, "krwPerCreditMin": 43, "krwPerCreditMax": 70}'::jsonb) on conflict (key) do nothing;
