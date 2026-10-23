-- #499-4 상황 매트릭스 소재 생성기(테크트리 EP.12 '경우의 수 쪼개기' — docs/handoff/TECHTREE_VIDEOS_2026-10-23.md 3장 B-2).
-- 브랜드 + 제품·서비스 + 구매자 역할 × 상황(고통·제안) → AI 가 광고 컨셉 후보 8~12개 → 대표가 1~4개 채택 → 채택한 컨셉마다 광고형 제작 의뢰(mkt_briefs).
-- 채택·반려 기록은 같은 브랜드의 다음 매트릭스를 만들 때 AI 재료(브랜드 기억)로 씀. 반려 사유를 적으면 AI 가 고친 안을 다시 올림(최대 3판, 운영실 카드와 같은 규칙).
create table if not exists mkt_concept_sets (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete set null,
  product text not null,                                    -- 제품·서비스 한 줄
  input jsonb not null default '{}'::jsonb,                 -- {roles[], situations[{name, pain, offer}], note, count, variantOf?{setId, conceptId, hook}}
  concepts jsonb not null default '[]'::jsonb,              -- [{id, role, situation, pain, offer, hook, headline, primary, angle, format(video|image), score{score,pass,fails,notes}, decision(adopted|rejected|null)}]
  status text not null default 'pending' check (status in ('pending', 'decided', 'rejected', 'canceled')),
  source text not null default 'template' check (source in ('ai', 'template')),
  version int not null default 1,
  thread_id uuid,                                           -- 반려 → 고친 안 줄기(첫 판 id)
  revised_from uuid,
  revision_note text,                                       -- "반려 사유 → 반영한 점"
  decision_note text,
  executed jsonb,                                           -- {briefs:[{conceptId, briefId}]}
  created_by uuid references users(id) on delete set null,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_concept_sets_recent on mkt_concept_sets (tenant, status, created_at desc);
create index if not exists mkt_concept_sets_brand on mkt_concept_sets (tenant, brand_id, decided_at desc);
