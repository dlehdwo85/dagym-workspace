import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden } from './errors';
import { audit } from './log';
import { addDays, todaySeoul } from './time';
import { ensurePersonalCalendar } from './access';
import { inviteUser, syncDemoFlag } from './admin';
import { notify } from './notifications';
import type { SessionUser } from './types';

/**
 * App Store·Play 심사용 체험 계정 (대표 결정 A, 2026-10-13): 비밀번호 없는 로그인은 만들지 않는다.
 * 대표가 버튼 한 번 → 격리 조직(최상위, is_demo) + 예시 데이터 + 심사용 계정 초대 링크. 비밀번호는 대표가 그 링크에서 직접 정한다(서버는 해시만).
 * 다시 누르면 예시 데이터만 새로 만든다. 격리 규칙(015)은 그대로: 데모 계정은 회사 데이터·사람을 못 보고, 대표 화면에도 안 섞인다.
 */
export const reviewInput = z.object({
  email: z.string().trim().toLowerCase().email('이메일 형식이 아닙니다'),
  name: z.string().trim().min(1).max(40).default('앱 심사 담당자'),
});
const UNIT_NAME = '체험 조직(심사용)';
const MATES: [string, string, string][] = [['demo-mate1@workin.invalid', '체험 김팀장', '팀장'], ['demo-mate2@workin.invalid', '체험 박매니저', '매니저']];

async function ensureUnit(tx: Sql) {
  let [u] = await tx<{ id: string }[]>`select id from org_units where is_demo and name = ${UNIT_NAME} limit 1`;
  if (!u) {
    [u] = await tx<{ id: string }[]>`insert into org_units (parent_id, brand_id, type, name, sort, is_demo, tenant) values (null, null, 'branch', ${UNIT_NAME}, 999, true, 'demo') returning id`;
    await tx`insert into calendars (type, org_unit_id, name, color) values ('org_unit', ${u.id}, ${UNIT_NAME + ' 일정'}, '#0d9488')`;
  }
  // 예시 담당자(로그인 불가: 비밀번호 없음·이름만)
  const mates: string[] = [];
  for (const [email, name, title] of MATES) {
    const [m] = await tx<{ id: string }[]>`insert into users (email, name, role, status, title, tenant) values (${email}, ${name}, 'staff', 'active', ${title}, 'demo')
      on conflict (lower(email)) do update set name = excluded.name returning id`;
    await tx`insert into memberships (user_id, org_unit_id) values (${m.id}, ${u.id}) on conflict do nothing`;
    await ensurePersonalCalendar(m.id, name, tx);
    mates.push(m.id);
  }
  await syncDemoFlag(tx, mates);
  return { unitId: u.id, mates };
}

/** 예시 데이터 새로 만들기: 기존 예시는 지움(표시 삭제)·프로젝트 보관 → 프로젝트 1, 업무 7, 일정 3 */
async function seedSamples(tx: Sql, unitId: string, people: string[], reviewer: string | null, reviewerActive: boolean) {
  await tx`update tasks set deleted_at = now() where org_unit_id = ${unitId} and deleted_at is null`;
  await tx`update events set deleted_at = now() where deleted_at is null and calendar_id in (select id from calendars where org_unit_id = ${unitId})`;
  await tx`update projects set archived = true where org_unit_id = ${unitId} and not archived`;
  const today = todaySeoul();
  const [lead, mgr] = people;
  const me = reviewer ?? lead;
  const [p] = await tx<{ id: string }[]>`insert into projects (name, description, org_unit_id, owner_id, color, created_by)
    values ('신규 지점 오픈 준비', '체험용 예시 프로젝트입니다. 자유롭게 바꿔 보세요.', ${unitId}, ${lead}, '#0d9488', ${lead}) returning id`;
  const rows: [string, string, string, string | null, string, string][] = [
    // 제목, 담당, 지시, 마감, 우선순위, 상태
    ['오픈 이벤트 안내문 작성', me, lead, today, 'high', 'in_progress'],
    ['운동기구 점검 일정 확인', me, lead, addDays(today, 2), 'normal', 'todo'],
    ['회원 상담 스크립트 검토', mgr, me, addDays(today, 4), 'normal', 'todo'],
    ['전단지 인쇄 견적 받기', mgr, lead, addDays(today, -2), 'urgent', 'todo'],
    ['오픈 당일 근무표 확정', lead, me, addDays(today, 1), 'high', 'todo'],
    ['샤워실 비품 발주', me, mgr, addDays(today, 6), 'low', 'todo'],
    ['지역 카페 홍보 글 올리기', mgr, lead, null, 'normal', 'todo'],
  ];
  let n = 0;
  for (const [title, who, req, due, pr, st] of rows) {
    await tx`insert into tasks (project_id, org_unit_id, title, description, status, priority, assignee_id, requested_by, due_date, created_by, sort_order, approval_required, assignee_ack_at)
      values (${p.id}, ${unitId}, ${title}, '체험용 예시 업무입니다.', ${st}, ${pr}, ${who}, ${req}, ${due}, ${req}, ${n++}, false, now())`;
  }
  const [cal] = await tx<{ id: string }[]>`select id from calendars where type = 'org_unit' and org_unit_id = ${unitId} limit 1`;
  const evs: [string, string, string, string][] = [['주간 운영 회의', addDays(today, 1), '10:00', '11:00'], ['오픈 리허설', addDays(today, 3), '14:00', '15:30'], ['강사 면접', addDays(today, 5), '16:00', '17:00']];
  for (const [title, d, s, e] of evs) {
    const [x] = await tx<{ id: string }[]>`insert into events (calendar_id, title, location, start_at, end_at, created_by)
      values (${cal.id}, ${title}, '체험 지점 회의실', ${`${d}T${s}:00+09:00`}, ${`${d}T${e}:00+09:00`}, ${lead}) returning id`;
    for (const u of new Set([lead, mgr, me])) await tx`insert into event_attendees (event_id, user_id) values (${x.id}, ${u}) on conflict do nothing`;
  }
  if (reviewer && reviewerActive) {
    await tx`delete from notifications where user_id = ${reviewer}`;
    const [t] = await tx<{ id: string; title: string }[]>`select id, title from tasks where org_unit_id = ${unitId} and assignee_id = ${reviewer} and deleted_at is null order by sort_order limit 1`;
    if (t) await notify(tx, { userIds: [reviewer], type: 'task_assigned', title: `업무 배정: ${t.title}`, body: '체험 김팀장님이 업무를 배정했습니다',
      link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: lead, dedupeKey: `review-sample:${t.id}` });
  }
  return { project: 1, tasks: rows.length, events: evs.length };
}

export async function setupReviewAccount(actor: SessionUser, i: z.infer<typeof reviewInput>, ip: string | null) {
  if (actor.role !== 'owner') throw forbidden('대표만 만들 수 있습니다');
  if (actor.isDemo || (actor.tenant ?? 'default') !== 'default') throw forbidden();
  const sql = db();
  const { unitId, mates } = await sql.begin(async (tx) => ensureUnit(tx as unknown as Sql));
  const [existing] = await sql<{ id: string; status: string; is_demo: boolean }[]>`select id, status, is_demo from users where lower(email) = ${i.email}`;
  if (existing && !existing.is_demo && existing.status !== 'invited') throw badRequest('이미 회사 계정으로 쓰는 이메일입니다. 심사용 이메일을 따로 쓰세요');
  let invitePath: string | null = null;
  let reviewerId = existing?.id ?? null;
  if (!existing || existing.status === 'invited') {
    // 데모 조직 관리자(현장 관리자) 권한, 소속은 격리 조직만 → 자동으로 격리 계정
    const r = await inviteUser(actor, { email: i.email, name: i.name, role: 'site_manager', orgUnitIds: [unitId], title: '앱 심사용' } as never, ip);
    invitePath = r.path; reviewerId = r.userId;
  }
  const sample = await sql.begin(async (tx) => seedSamples(tx as unknown as Sql, unitId, mates, reviewerId, existing?.status === 'active'));
  await audit(sql, actor.id, 'review_account.setup', 'user', reviewerId, { email: i.email, unitId, reseeded: true }, ip);
  return { unitId, reviewerId, invitePath, alreadyActive: existing?.status === 'active', sample };
}
