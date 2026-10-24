-- 전자계약 2차(대표 10/23 "글로싸인 레퍼런스", docs/handoff/ECONTRACT_GLOSIGN_REFERENCE_2026-10-23.md §5·§6 1~2단계):
-- 회사가 쓰는 아무 계약서(PDF·사진)를 올려 그 위에 서명자별 칸(서명·도장·텍스트·날짜)을 놓아 보내고, 완료본은 같은 좌표에 값을 찍어 만든다
alter table contracts add column if not exists source_key text;        -- 원본 PDF 저장 키(contract/<회사>/…) — 비어 있으면 1차 텍스트 서식 계약
alter table contracts add column if not exists source_name text;       -- 올린 파일 이름
alter table contracts add column if not exists page_count int;
alter table contracts add column if not exists original_sha256 text;   -- 원본 PDF 해시(감사 추적 쪽에 기록)
alter table contracts add column if not exists final_sha256 text;      -- 완료본 해시
alter table contracts add column if not exists message text;           -- 서명 요청 메일에 넣는 전하는 말
create table if not exists contract_fields (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id) on delete cascade,
  signer_id uuid not null references contract_signers(id) on delete cascade,
  type text not null check (type in ('sign', 'stamp', 'text', 'date')),
  page int not null,                                 -- 1부터
  x real not null, y real not null, w real not null, h real not null,   -- 쪽 크기 기준 비율 0~1(왼쪽 위가 0,0)
  required boolean not null default true,
  label text,                                        -- 텍스트 칸 안내(예: 주소)
  value text,                                        -- 텍스트 값·날짜(서명일) — 서명·도장은 서명자 이미지
  filled_at timestamptz
);
create index if not exists contract_fields_contract on contract_fields (contract_id, page);
-- 거래처 등 회사 밖 상대방도 서명자로
alter table contract_signers drop constraint if exists contract_signers_role_check;
alter table contract_signers add constraint contract_signers_role_check check (role in ('employee', 'company', 'witness', 'party'));
