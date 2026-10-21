-- 로컬 10/20 19:10 (#114) 결재 화면 보강: 양식 종류 추가(출장·구매·경조사), 문서번호, 임시 저장(업무 없이 status draft), 참조자, 반려 사유 복사
-- 추가형만: 제약은 넓히고(종류·상태), task_id 는 임시 저장 때문에 null 허용.
alter table approval_forms drop constraint if exists approval_forms_kind_check;
alter table approval_forms add constraint approval_forms_kind_check check (kind in ('leave', 'expense', 'general', 'trip', 'purchase', 'family'));
alter table approval_requests drop constraint if exists approval_requests_status_check;
alter table approval_requests add constraint approval_requests_status_check check (status in ('draft', 'pending', 'approved', 'rejected', 'cancelled'));
alter table approval_requests alter column task_id drop not null;
alter table approval_requests add column if not exists doc_no text;                       -- 결재-2026-0001 (회사·연도별 순번, 올릴 때 매김)
alter table approval_requests add column if not exists cc_user_ids uuid[] not null default '{}'; -- 참조자(목록 '참조' 탭·알림만, 결재 권한 없음)
alter table approval_requests add column if not exists line_id uuid references approval_lines(id) on delete set null; -- 작성 때 고른 결재선(임시 저장 포함)
alter table approval_requests add column if not exists reject_reason text;                -- 반려 사유(최근 회차)
alter table approval_requests add column if not exists updated_at timestamptz not null default now();
create index if not exists approval_requests_doc_no on approval_requests (tenant, doc_no);
create index if not exists approval_requests_cc on approval_requests using gin (cc_user_ids);
