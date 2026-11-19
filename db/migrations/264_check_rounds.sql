-- 점검 2단계 — 점검하기 · 보완 흐름(코스 · 점검 1회 · 항목별 결과 · 보완 요청 · 외부 연락 · 개선 과제)
-- docs/check-feature-design.md 3-1·3-3·11절. 새 표만 만든다(기존 표는 건드리지 않음). 모든 표에 회사(tenant) 칸.
-- 되돌릴 때: drop table chk_improvements, chk_external, chk_followups, chk_results, chk_rounds, chk_courses;

-- 점검 코스: 공간 유형을 도는 순서. 항목은 그때의 가이드에서 고른다(그 공간 유형에 걸린 사용 중 항목) — 가이드를 고치면 코스도 따라감
create table if not exists chk_courses (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  name text not null,
  org_unit_id uuid references org_units(id) on delete cascade,   -- 비우면 모든 곳에서 쓰는 코스
  steps jsonb not null default '[]'::jsonb,                      -- [{ placeTypeId }] 순서대로
  include_general boolean not null default true,                 -- 공간 유형이 없는 항목(업무 기록 등)을 마지막에 함께 볼지
  active boolean not null default true,
  tpl_key text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists chk_courses_tenant on chk_courses(tenant, active);
create unique index if not exists chk_courses_tpl on chk_courses(tenant, tpl_key) where tpl_key is not null;

-- 점검 1회
create table if not exists chk_rounds (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  org_unit_id uuid not null references org_units(id) on delete cascade,
  checker_id uuid references users(id) on delete set null,
  course_id uuid references chk_courses(id) on delete set null,
  course_name text,                                              -- 그때의 코스 이름(코스를 지워도 기록에 남게)
  kind text not null default 'regular' check (kind in ('regular', 'sample', 'adhoc')),   -- 정기 · 표본 · 수시
  note text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists chk_rounds_unit on chk_rounds(tenant, org_unit_id, started_at desc);
create index if not exists chk_rounds_open on chk_rounds(tenant, checker_id) where ended_at is null;

-- 항목별 결과: 양호(ok) · 보완 필요(fix) · 해당 없음(na)
create table if not exists chk_results (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  round_id uuid not null references chk_rounds(id) on delete cascade,
  item_id uuid not null references chk_items(id) on delete cascade,
  item_version int not null default 1,
  item_title text not null,                                      -- 그때의 항목 이름·양호 기준(가이드를 고쳐도 기록은 그대로)
  pass_criteria text not null default '',
  place_type_id uuid references chk_place_types(id) on delete set null,
  place_id uuid references chk_places(id) on delete set null,
  verdict text not null check (verdict in ('ok', 'fix', 'na')),
  memo text,
  staff_check jsonb,                                             -- 3단계(외부 체크 앱 연동) 때 그날 직원 체크 기록
  by_user uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chk_results_one on chk_results(round_id, item_id, coalesce(place_type_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists chk_results_item on chk_results(tenant, item_id, created_at desc);

-- 보완 요청: 업무 1건과 이어짐. 상태 = 요청됨(requested) → (업무가 완료되면 화면에서 '확인 대기'로 보임) → 양호 확인(ok) / 다시 보완은 requested 로 되돌리고 회차(round_no)를 올림
create table if not exists chk_followups (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  result_id uuid not null references chk_results(id) on delete cascade,
  item_id uuid not null references chk_items(id) on delete cascade,
  org_unit_id uuid not null references org_units(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  assignee_id uuid references users(id) on delete set null,
  requested_by uuid references users(id) on delete set null,
  due_date date,
  note text,
  status text not null default 'requested' check (status in ('requested', 'ok', 'canceled')),
  round_no int not null default 1,                               -- 다시 보완을 요청할 때마다 +1
  waiting_notified_at timestamptz,                               -- '확인 대기' 알림을 보낸 때(회차마다 한 번)
  closed_at timestamptz,
  closed_by uuid references users(id) on delete set null,
  close_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists chk_followups_result on chk_followups(result_id);
create index if not exists chk_followups_open on chk_followups(tenant, org_unit_id, status);
create index if not exists chk_followups_task on chk_followups(task_id) where task_id is not null;

-- 외부 업체·건물 관리처 연락 기록과 회신 기한
create table if not exists chk_external (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  followup_id uuid not null references chk_followups(id) on delete cascade,
  target text not null,                                          -- 누구에게(업체·관리처 이름 — 회사가 적음)
  asked_at date not null default current_date,
  reply_due date,
  outcome text,                                                  -- 회신·결과(적으면 닫힘)
  overdue_notified_at timestamptz,
  closed_at timestamptz,
  by_user uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists chk_external_open on chk_external(tenant, reply_due) where closed_at is null;

-- 개선 과제: 같은 항목·같은 곳이 N회 연속 보완 필요(기본 3) → 업무 1건(기준 보완·교육·장비 교체 검토)
create table if not exists chk_improvements (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  item_id uuid not null references chk_items(id) on delete cascade,
  org_unit_id uuid not null references org_units(id) on delete cascade,
  streak int not null,
  task_id uuid references tasks(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists chk_improvements_open on chk_improvements(tenant, item_id, org_unit_id) where status = 'open';
