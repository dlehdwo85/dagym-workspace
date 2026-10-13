-- 매출 2·3단계 (대표 승인 2026-10-13): GPT Custom Action 용 쓰기 전용 토큰, AI 분석 기록. 추가형.
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token_hash text not null unique,          -- 원문은 저장하지 않는다 (만들 때 한 번만 보여 줌)
  prefix text not null,                     -- 목록에서 구분용 앞 8자
  scope text not null check (scope in ('revenue:write')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists revenue_ai_reports (
  id uuid primary key default gen_random_uuid(),
  period text not null,                     -- 분석 기준 월 YYYY-MM
  model text not null,
  input jsonb not null,                     -- 외부로 보낸 집계값 그대로 (검증·근거용)
  output jsonb not null,                    -- AI 제안 (요약·이상치·현장 비교)
  usage jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists revenue_ai_reports_period on revenue_ai_reports(period, created_at desc);
