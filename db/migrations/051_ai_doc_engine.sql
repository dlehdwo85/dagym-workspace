-- V22 AI 비서 문서 엔진(Agent Skills + 코드 실행). 추가형.
-- 회사 정보·디자인 기준(조직 설정) — 견적서·문서의 공급자 칸·로고·브랜드 색을 여기서 읽는다(하드코딩 금지, 회사마다)
create table if not exists company_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  key text not null check (key ~ '^[a-z0-9_-]{2,30}$'),   -- 예: dagym, hilink
  name text not null,                                     -- 상호
  ceo text, biz_no text, address text, phone text, fax text, email text, website text, bank text,
  logo_file_id uuid references library_files(id) on delete set null,
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  font text,
  note text,                                              -- 디자인 메모(예: 표는 얇은 회색 테두리)
  is_default boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant, key)
);
-- 문서 작업(파일 만들기·고치기·분석) — 결과는 사람이 [자료실에 저장]할 때까지 작업 결과로만 보관
create table if not exists ai_doc_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  user_id uuid not null references users(id) on delete cascade,
  thread_id uuid references ai_threads(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  mode text not null check (mode in ('create','edit','analyze')),
  kind text not null check (kind in ('xlsx','docx','pptx','pdf','chart','none')),
  title text not null,
  instructions text not null,
  company_key text,
  ref_file_ids uuid[] not null default '{}',
  base_job_id uuid references ai_doc_jobs(id) on delete set null,
  version int not null default 1,
  confidential boolean not null default false,
  result_key text, result_name text, result_mime text, result_size int, result_anthropic_file_id text,
  preview_key text, pages int, summary text, error text,
  input_tokens int not null default 0, output_tokens int not null default 0, cost_usd numeric(12,6) not null default 0,
  saved_file_id uuid references library_files(id) on delete set null,
  started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ai_doc_jobs_thread_idx on ai_doc_jobs (thread_id, created_at);
create index if not exists ai_doc_jobs_pending_idx on ai_doc_jobs (status, created_at) where status in ('queued','running');
-- 대화 단위 코드 실행 컨테이너 재사용 / 메시지에 붙은 문서 작업
alter table ai_threads add column if not exists container_id text;
alter table ai_messages add column if not exists doc_job_ids uuid[] not null default '{}';
-- 참고 파일은 Files API 에 한 번만 올린다
alter table library_files add column if not exists anthropic_file_id text;
-- 웹 검색·페이지 읽기(조직 설정으로 끄기) / 문서 작업 켜기
alter table ai_settings add column if not exists web_tools boolean not null default true;
alter table ai_settings add column if not exists doc_engine boolean not null default true;
