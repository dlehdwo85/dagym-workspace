-- 상용화 B4 회사 전체 내보내기(docs/research/TENANT_DELETE_EXPORT_2026-11-24.md 4절). 추가형.
-- 대표·관리자가 요청 → 정기 실행이 압축 파일(영역별 CSV + 자료실·첨부 파일 원본 + 목록)을 저장소에 만들어 둠 → 7일 동안 내려받기 → 지난 것은 저장소에서 지움.
-- 파일이 많으면 압축 파일을 여러 개로 나눔(parts). 저장소 열쇠는 '<회사 id>/export/…' 아래라 회사 영구 삭제 때 함께 파기된다.
create table if not exists company_exports (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  requested_by uuid references users(id) on delete set null,
  status text not null default 'queued',      -- queued · running · done · failed · expired
  cursor int not null default 0,               -- 다음에 담을 파일 순번(files 기준)
  files jsonb,                                 -- 담을 파일 목록 [{k: 저장소 열쇠, p: 압축 안 경로, s: 크기}] — 첫 실행 때 정함
  parts jsonb not null default '[]'::jsonb,    -- 만든 압축 파일 [{n, key, size, files}]
  counts jsonb,                                -- 영역별 줄 수·큰 파일·못 읽은 파일
  opts jsonb,                                  -- 요청한 사람의 자료실 등급 열람(내부·기밀) — 그 사람이 볼 수 있는 파일만 담음
  attempts int not null default 0,
  error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  expires_at timestamptz
);
create index if not exists company_exports_tenant_idx on company_exports (tenant, created_at desc);
create index if not exists company_exports_open_idx on company_exports (status) where status in ('queued', 'running', 'done');
