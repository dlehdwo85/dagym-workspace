-- #499-5 카드뉴스(캐러셀) 장별 생성기(테크트리 EP.11 '캐러셀' — docs/handoff/TECHTREE_VIDEOS_2026-10-23.md 3장 E·부록 C).
-- 제품·서비스 → AI 주제 후보(A vs B · N가지 방법 · 유형별 추천 · 체크리스트) → 장별 문구·이미지 계획 → 직원이 고침
-- → 우리 서버가 정해진 틀(1080×1350, 제목 밑 검정 20% 상자, 굵기 대비, 가운데 로고, 마지막 장 검정 바탕 CTA '댓글에 ○○')로 그림
-- → 자료실(마케팅/카드뉴스) 저장 → 인스타 콘텐츠 승인 요청(사진 여러 장 = 캐러셀 게시). 외부 유료 생성 없음.
create table if not exists mkt_carousels (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete set null,
  product text not null,                                    -- 제품·서비스 한 줄
  topic text not null,                                      -- 표지 질문(주제)
  pattern text not null default 'vs' check (pattern in ('vs', 'howto', 'types', 'checklist')),
  input jsonb not null default '{}'::jsonb,                 -- {audience, a, b, note}
  slides jsonb not null default '[]'::jsonb,                -- [{kind(cover|body|table|cta), title, body, rows[][], imagePlan, imageId}]
  caption text not null default '',
  keyword text,                                             -- 마지막 장 '댓글에 ○○' 키워드
  template text not null default 'box' check (template in ('box', 'clean', 'bold')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'canceled')),
  source text not null default 'template' check (source in ('ai', 'template')),
  media_ids uuid[] not null default '{}',                   -- 마지막으로 그린 장(자료실)
  content_id uuid references mkt_contents(id) on delete set null,
  rendered_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_carousels_recent on mkt_carousels (tenant, created_at desc);
