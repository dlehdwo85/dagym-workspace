-- V19 2장: 견적서 — 회사(공급자 = company_profiles)별 양식(JSON 배치)과 발행한 견적서(PDF 는 자료실 "견적서" 폴더 파일). AI 는 초안(ai_proposals draft_quote)만, 만들기·보내기는 사람이.
create table if not exists quote_templates (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  company_key text not null,                          -- company_profiles.key
  name text not null,
  layout jsonb not null default '{}',                 -- { columns:[{key,label,width}], terms:[string], footer:string, showStamp:boolean, accent:'#rrggbb' }
  source_file_id uuid references library_files(id) on delete set null, -- 참고한 기존 양식(자료실)
  is_default boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quote_templates_tenant on quote_templates (tenant, company_key);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  company_key text not null,
  template_id uuid references quote_templates(id) on delete set null,
  quote_no text not null,                             -- Q-YYYYMMDD-001 (회사별·날짜별)
  to_name text not null,
  to_contact text,                                    -- 담당자
  to_phone text,
  to_email text,
  items jsonb not null default '[]',                  -- [{name, spec, qty, unitPrice, amount}]
  supply bigint not null default 0,                   -- 공급가액(원)
  vat bigint not null default 0,                      -- 부가세 10%(서버 계산)
  total bigint not null default 0,
  valid_until date,
  note text,
  task_id uuid references tasks(id) on delete set null,
  lead_id uuid,
  file_id uuid references library_files(id) on delete set null,       -- PDF
  status text not null default 'draft' check (status in ('draft', 'sent')),
  sent_via text,                                      -- share | mail | sms | download
  sent_to text,
  sent_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant, quote_no)
);
create index if not exists quotes_tenant on quotes (tenant, created_at desc);
create index if not exists quotes_task on quotes (task_id) where task_id is not null;
