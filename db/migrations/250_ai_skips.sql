-- 371차 #994(대표 11/06 "AI 한도 혹은 클로드 크레딧을 모두 소진하여 … 정상으로 돌아왔을 때 비정상적이었던 날을 추적해서 다시"):
-- AI 를 쓰는 수집·판단 단계가 한도·크레딧·속도 제한으로 못 한 항목을 '못 함(사유·날짜)'으로 남기고, 다시 처리되면 done_at 을 채운다.
-- 관리 › 운영 상태의 '빠졌던 날 / 다시 채움 완료 n·남은 n' 이 이 표에서 나온다. tenant = 회사(공용 공고는 'global')
create table if not exists ai_skips (
  id bigserial primary key,
  tenant text not null,
  stage text not null,
  item_key text not null,
  title text,
  reason text not null,
  message text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  skips int not null default 1,
  done_at timestamptz,
  unique (tenant, stage, item_key)
);
create index if not exists ai_skips_open on ai_skips (tenant, stage, first_at) where done_at is null;
create index if not exists ai_skips_day on ai_skips (first_at);

-- 11/05 크레딧·한도 막힘(503 ai_credit)이 공고 실패로 셈해져 자동 판단 차례에서 빠진(auto_fail) 지원사업 공고를 한 번 되돌림
-- (AI 판단이 아직 없는 것만 — 진짜 실패였다면 다시 3번까지, 회사 AI 예산 안에서)
update support_matches set auto_fail = 0, updated_at = now() where auto_fail > 0 and ai_verdict is null;
