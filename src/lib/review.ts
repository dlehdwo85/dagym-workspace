import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden } from './errors';
import { audit } from './log';
import { addDays, todaySeoul } from './time';
import { ensurePersonalCalendar } from './access';
import { inviteUser, syncDemoFlag } from './admin';
import { notify } from './notifications';
import { putObject } from './storage';
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

/**
 * 예시 데이터 새로 만들기(스토어 스크린샷용 — 로컬 10/19): 기존 예시는 지움 → 업무 12(마감 지남·오늘·이번 주, 진행·검토·완료, 체크리스트·댓글) ·
 * 이번 주 일정 7(색 여러 가지, 미팅 포함) · 메시지방 2 · AI 비서 대화 1 · 자료실 파일 4 · 영업 리드 5 · 마케팅 시안 2. 이름·전화는 모두 가상.
 */
const SAMPLE = 'review-sample';
async function seedSamples(tx: Sql, unitId: string, people: string[], reviewer: string | null, reviewerActive: boolean) {
  const T = 'demo';
  await tx`update tasks set deleted_at = now() where org_unit_id = ${unitId} and deleted_at is null`;
  await tx`update events set deleted_at = now() where deleted_at is null and calendar_id in (select id from calendars where org_unit_id = ${unitId})`;
  await tx`update projects set archived = true where org_unit_id = ${unitId} and not archived`;
  await tx`delete from chat_rooms where tenant = ${T} and dm_key like ${SAMPLE + '%'}`;
  await tx`update ai_threads set deleted_at = now() where tenant = ${T} and title like '[예시]%' and deleted_at is null`;
  await tx`update library_files set deleted_at = now() where tenant = ${T} and ${SAMPLE} = any(tags) and deleted_at is null`;
  await tx`delete from sales_leads where tenant = ${T} and src_id like ${SAMPLE + '%'}`;
  await tx`delete from mkt_contents where tenant = ${T} and src_ref like ${SAMPLE + '%'}`;
  const today = todaySeoul();
  const [lead, mgr] = people;
  const me = reviewer ?? lead;
  const [p] = await tx<{ id: string }[]>`insert into projects (name, description, org_unit_id, owner_id, color, created_by)
    values ('신규 지점 오픈 준비', '체험용 예시 프로젝트입니다. 자유롭게 바꿔 보세요.', ${unitId}, ${lead}, '#0d9488', ${lead}) returning id`;
  // 제목, 담당, 지시, 마감, 우선순위, 상태, 체크리스트, 댓글
  const rows: [string, string, string, string | null, string, string, string[], [string, string][]][] = [
    ['오픈 이벤트 안내문 작성', me, lead, today, 'high', 'in_progress', ['문구 초안', '사진 고르기', '팀장 확인'], [[lead, '이번 주 금요일까지 게시하면 좋겠어요.']]],
    ['전단지 인쇄 견적 받기', mgr, lead, addDays(today, -2), 'urgent', 'todo', [], [[mgr, '두 곳 견적 기다리는 중입니다.']]],
    ['회원 상담 스크립트 검토', me, mgr, addDays(today, -1), 'normal', 'review', ['첫 인사', '가격 안내', '마무리'], []],
    ['오픈 당일 근무표 확정', lead, me, addDays(today, 1), 'high', 'todo', [], []],
    ['운동기구 점검 일정 확인', me, lead, addDays(today, 2), 'normal', 'todo', ['러닝머신', '사이클', '웨이트 머신'], []],
    ['지역 카페 홍보 글 올리기', mgr, lead, addDays(today, 3), 'normal', 'in_progress', [], [[lead, '사진 3장 이상 넣어 주세요.'], [mgr, '네, 오늘 올리겠습니다.']]],
    ['샤워실 비품 발주', me, mgr, addDays(today, 4), 'low', 'todo', [], []],
    ['신규 회원 환영 문자 문구', mgr, me, addDays(today, 5), 'normal', 'todo', [], []],
    ['간판 시안 최종 확인', lead, me, addDays(today, 6), 'high', 'on_hold', [], [[lead, '건물 관리사무소 답변 기다립니다.']]],
    ['강사 계약서 정리', me, lead, addDays(today, -3), 'normal', 'done', ['계약서 2부', '서명 확인'], []],
    ['오픈 리허설 체크리스트', mgr, lead, addDays(today, -1), 'normal', 'done', [], []],
    ['고객 설문지 만들기', me, lead, null, 'low', 'todo', [], []],
  ];
  let n = 0;
  for (const [title, who, req, due, pr, st, checks, comments] of rows) {
    const [t] = await tx<{ id: string }[]>`insert into tasks (project_id, org_unit_id, title, description, status, priority, assignee_id, requested_by, due_date, created_by, sort_order, approval_required, assignee_ack_at, completed_at)
      values (${p.id}, ${unitId}, ${title}, '체험용 예시 업무입니다.', ${st}, ${pr}, ${who}, ${req}, ${due}, ${req}, ${n++}, false, now(), ${st === 'done' ? new Date() : null}) returning id`;
    let k = 0;
    for (const c of checks) await tx`insert into task_checklist_items (task_id, text, done, sort) values (${t.id}, ${c}, ${st === 'done' || k === 0}, ${k++})`;
    for (const [by, body] of comments) await tx`insert into comments (task_id, author_id, body) values (${t.id}, ${by}, ${body})`;
  }
  const [cal] = await tx<{ id: string }[]>`select id from calendars where type = 'org_unit' and org_unit_id = ${unitId} limit 1`;
  // 이번 주(오늘부터 6일) 일정 — 색 여러 가지, 미팅(방문) 포함
  const evs: [string, string, string, string, string | null, string][] = [
    ['주간 운영 회의', today, '10:00', '11:00', null, '체험 지점 회의실'],
    ['미팅 · 체험 상사 제휴 상담', today, '15:00', '16:00', '#E67C73', '체험 상사 본사(가상)'],
    ['강사 면접', addDays(today, 1), '13:00', '14:00', '#33B679', '체험 지점 상담실'],
    ['오픈 리허설', addDays(today, 2), '14:00', '15:30', '#F6BF26', '체험 지점'],
    ['미팅 · 인테리어 업체 현장 방문', addDays(today, 3), '11:00', '12:00', '#8E24AA', '체험 지점 2층'],
    ['마케팅 시안 검토', addDays(today, 4), '16:00', '17:00', '#039BE5', '온라인'],
    ['월간 정산', addDays(today, 5), '09:30', '10:30', '#616161', '체험 지점 사무실'],
  ];
  for (const [title, d, s, e, color, loc] of evs) {
    const [x] = await tx<{ id: string }[]>`insert into events (calendar_id, title, location, start_at, end_at, created_by, color)
      values (${cal.id}, ${title}, ${loc}, ${`${d}T${s}:00+09:00`}, ${`${d}T${e}:00+09:00`}, ${lead}, ${color}) returning id`;
    for (const u of new Set([lead, mgr, me])) await tx`insert into event_attendees (event_id, user_id) values (${x.id}, ${u}) on conflict do nothing`;
  }
  // 메시지방: 팀 단체방 + 김팀장 1:1
  const rooms: [string, string | null, string[], [string, string][]][] = [
    ['group', '체험 지점 운영', [lead, mgr, me], [[lead, '오늘 오후 3시 제휴 상담 있습니다.'], [mgr, '자료 준비해 두겠습니다.'], [me, '안내문 초안 올렸어요. 확인 부탁드려요.'], [lead, '좋아요 👍 사진만 하나 바꿔 주세요.']]],
    ['dm', null, [lead, me], [[lead, '근무표 내일까지 확정 가능할까요?'], [me, '네, 오전 중에 정리해서 보내드릴게요.']]],
  ];
  let r = 0;
  for (const [kind, name, members, msgs] of rooms) {
    const [room] = await tx<{ id: string }[]>`insert into chat_rooms (tenant, kind, name, dm_key, created_by, last_message_at) values (${T}, ${kind}, ${name}, ${`${SAMPLE}:${r++}`}, ${lead}, now()) returning id`;
    for (const m of new Set(members)) await tx`insert into chat_members (room_id, user_id) values (${room.id}, ${m}) on conflict do nothing`;
    let i = msgs.length;
    for (const [by, body] of msgs) await tx`insert into chat_messages (room_id, author_id, body, created_at) values (${room.id}, ${by}, ${body}, now() - ${`${i--} minutes`}::interval)`;
  }
  // AI 비서 대화 예시(심사 계정)
  if (reviewer) {
    const [th] = await tx<{ id: string }[]>`insert into ai_threads (tenant, user_id, title) values (${T}, ${reviewer}, '[예시] 이번 주 할 일 정리') returning id`;
    await tx`insert into ai_messages (thread_id, role, text) values (${th.id}, 'user', '이번 주 내 업무 정리해 줘'),
      (${th.id}, 'assistant', ${'이번 주 업무 4건입니다.\n1. 오픈 이벤트 안내문 작성 — 오늘 마감(진행 중)\n2. 운동기구 점검 일정 확인 — 모레\n3. 샤워실 비품 발주 — 4일 뒤\n4. 회원 상담 스크립트 검토 — 검토 대기\n먼저 오늘 마감인 안내문부터 마무리하시면 좋겠습니다.'})`;
  }
  // 자료실 파일 4개(가상 내용)
  const files: [string, string, string, string][] = [
    ['오픈 이벤트 안내문.txt', 'text/plain', '마케팅', '체험 지점 오픈 이벤트\n기간: 이번 달 말까지\n혜택: 첫 달 이용료 할인(예시)\n문의: 체험 지점 안내데스크'],
    ['근무표(예시).csv', 'text/csv', '운영', '이름,월,화,수,목,금\n체험 김팀장,오전,오전,휴무,오후,오후\n체험 박매니저,오후,오후,오전,휴무,오전'],
    ['회원 상담 스크립트.md', 'text/markdown', '운영', '# 상담 순서\n1. 인사와 방문 목적 확인\n2. 시설 안내\n3. 이용권 설명\n4. 다음 방문 약속'],
    ['체험 지점 로고.svg', 'image/svg+xml', '디자인', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="40" fill="#0d9488"/><text x="100" y="118" font-size="44" text-anchor="middle" fill="#fff" font-family="sans-serif">체험</text></svg>'],
  ];
  for (const [fileName, mime, folder, body] of files) {
    const data = Buffer.from(body, 'utf8');
    const [f] = await tx<{ id: string }[]>`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, tags, source, created_by, upload_status, text_content)
      values (${T}, ${folder}, ${fileName.replace(/\.[^.]+$/, '')}, ${fileName}, ${mime}, ${data.length}, ${[SAMPLE]}, 'sample', ${lead}, 'ready', ${mime.startsWith('text/') ? body : null}) returning id`;
    const key = `lib/${T}/${f.id}/${fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`;
    await putObject(key, data, mime);
    await tx`update library_files set storage_key = ${key} where id = ${f.id}`;
  }
  // 영업·마케팅 공간 켜기 + 심사 계정 배정
  await tx`update tenants set spaces = (select array_agg(distinct x) from unnest(coalesce(spaces, '{work}') || ${['work', 'sales', 'marketing']}::text[]) x) where id = ${T}`;
  for (const u of new Set([me, lead, mgr])) await tx`insert into space_members (user_id, tenant, spaces) values (${u}, ${T}, ${['work', 'sales', 'marketing']}) on conflict (user_id, tenant) do update set spaces = excluded.spaces, updated_at = now()`;
  await tx`insert into sales_cutover (tenant, ok, writes_open) values (${T}, true, true) on conflict (tenant) do update set writes_open = true`;
  const leads: [string, string, string, string, string | null, string][] = [
    ['체험 상사(가상)', '미팅예정', 'high', '서울', addDays(today, 1), '체험 이대리'],
    ['가나 피트니스(가상)', '1차연락완료', 'medium', '경기', addDays(today, 3), '체험 최실장'],
    ['다라 오피스(가상)', '제안서발송완료', 'high', '서울', addDays(today, 2), '체험 정과장'],
    ['마바 아파트 관리사무소(가상)', '신규리드', 'low', '인천', null, '체험 한소장'],
    ['사아 학원(가상)', '견적협의', 'medium', '경기', addDays(today, 5), '체험 윤원장'],
  ];
  let li = 0;
  for (const [name, status, pr, region, next, contact] of leads) await tx`insert into sales_leads (tenant, src_id, name, status, priority, region, owner_id, next_contact_date, contact_name, phone, expected_revenue, memo)
    values (${T}, ${`${SAMPLE}-${li++}`}, ${name}, ${status}, ${pr}, ${region}, ${me}, ${next}, ${contact}, '010-0000-0000', ${(li * 1200000)}, '체험용 예시 리드입니다(가상).')`;
  const mk: [string, string, string, string][] = [
    ['오픈 이벤트 인스타 피드', 'instagram', 'pending', '체험 지점이 문을 엽니다! 첫 달 할인(예시) — 지금 방문하세요.\n#체험지점 #오픈이벤트'],
    ['블로그 · 시설 둘러보기', 'blog', 'approved', '체험 지점의 운동 공간을 소개합니다. (예시 글)'],
  ];
  let mi = 0;
  for (const [title, channel, status, body] of mk) {
    const [c] = await tx<{ id: string }[]>`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, approved_version, created_by, src_ref)
      values (${T}, ${title}, ${channel}, ${`${addDays(today, 2 + mi)}T10:00:00+09:00`}, ${status}, 1, ${status === 'approved' ? 1 : null}, ${mgr}, ${`${SAMPLE}-${mi++}`}) returning id`;
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${body}, ${[]}, '체험용 예시 시안', ${mgr})`;
  }
  if (reviewer && reviewerActive) {
    await tx`delete from notifications where user_id = ${reviewer}`;
    const [t] = await tx<{ id: string; title: string }[]>`select id, title from tasks where org_unit_id = ${unitId} and assignee_id = ${reviewer} and deleted_at is null order by sort_order limit 1`;
    if (t) await notify(tx, { userIds: [reviewer], type: 'task_assigned', title: `업무 배정: ${t.title}`, body: '체험 김팀장님이 업무를 배정했습니다',
      link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: lead, dedupeKey: `review-sample:${t.id}` });
  }
  return { project: 1, tasks: rows.length, events: evs.length, rooms: rooms.length, aiThreads: reviewer ? 1 : 0, files: files.length, leads: leads.length, marketing: mk.length };
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
