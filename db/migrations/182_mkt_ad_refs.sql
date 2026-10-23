-- #499-6 경쟁 광고 보관함(테크트리 L4·EP.3 — docs/handoff/TECHTREE_VIDEOS_2026-10-23.md 3장 6번). 수집은 사람이, 분석은 AI 가.
-- Meta 광고 라이브러리 API 는 한국 일반 광고를 주지 않고, 화면을 긁는 방식은 워크인 정책(크롤링 금지)과 맞지 않음 → 링크는 사람이 붙이고(서버는 열어 보지 않음)
-- 영상은 자료실에 올림 → 화면이 음성만 뽑아 받아쓰기(STT) → 첫 문장 훅 유형(질문·가격·상황극·비교…) → 여러 개를 묶어 공통 구조 → 우리 대본 3안.
-- 오래 돌린 광고(시작일)·같은 업체가 비슷한 소재를 반복한 수도 함께 기록. 주 1회(월요일) 새로 모인 광고를 묶어 자동 분석.
create table if not exists mkt_ad_refs (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete set null,      -- 어느 우리 브랜드를 위한 참고인지(선택)
  advertiser text not null,                                         -- 광고한 업체·페이지 이름
  url text,                                                         -- 광고 라이브러리·게시물 링크(사람이 붙임)
  platform text not null default 'other' check (platform in ('meta', 'instagram', 'youtube', 'tiktok', 'naver', 'other')),
  format text not null default 'video' check (format in ('video', 'image', 'carousel', 'text')),
  media_id uuid references library_files(id) on delete set null,   -- 자료실에 올린 영상·이미지(선택)
  started_on date,                                                  -- 광고 시작일(라이브러리 화면의 '게재 시작')
  variants int check (variants is null or variants between 1 and 999), -- 같은 업체가 비슷한 소재를 돌린 수
  transcript text,                                                  -- 대본(음성 받아쓰기 또는 직접 붙임)
  hook text,                                                        -- 첫 문장
  hook_type text check (hook_type is null or hook_type in ('question', 'price', 'skit', 'compare', 'number', 'empathy', 'other')),
  analysis jsonb,                                                   -- AI 분석 {beats[{part, text}], offer, cta, angle, why}
  note text,
  starred boolean not null default false,                           -- '참고할 것'
  stt_note text,                                                    -- 받아쓰기 못 한 이유
  analyzed_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_ad_refs_recent on mkt_ad_refs (tenant, created_at desc);
create table if not exists mkt_ad_ref_reports (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete set null,
  kind text not null default 'manual' check (kind in ('manual', 'weekly')),
  ref_ids uuid[] not null default '{}',
  product text,
  result jsonb not null default '{}'::jsonb,                        -- {hookTypes{type:n}, facts[], common[], structure[], scripts[{title, hook, lines[], cta, score}]}
  source text not null default 'template' check (source in ('ai', 'template')),
  week text,                                                        -- 주간 분석 '2026-W43'(회사마다 한 주 한 번)
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_ad_ref_reports_week on mkt_ad_ref_reports (tenant, week) where week is not null;
create index if not exists mkt_ad_ref_reports_recent on mkt_ad_ref_reports (tenant, created_at desc);
