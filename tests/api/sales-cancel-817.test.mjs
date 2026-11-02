// 278차 #817·#830(대표 10/31 "입찰 생성된 게 취소되면 목록에서도 지우고 생성된 업무에서도 지울 수 있도록" · "취소된 공고가 아직 DB 에 남아 있음") → 344차 #925(대표 11/02 "취소된 공고의 업무는 경고를 띄워 담당자가 확인하고 완료 처리"):
// 운영 광명 kg2b_142624 — 업무가 가리키는 줄이 같은 공고 다른 줄로 합쳐진 뒤 남은 줄만 '취소'가 되어 업무가 그대로 남음 →
// 합쳐진 줄을 따라가 열린 입찰 업무(하위 포함)를 휴지통으로 + 담당·공동 담당·요청자 알림(사유) · 취소 공고는 입찰 목록 모든 탭에서 빼고 '취소된 공고' 탭에만
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date()); const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const BID = 'kg2b_817001'; const TITLE = '[경기] 시험팔일칠아파트 주민공동시설 위탁운영 업체 선정 입찰공고'; const WHY = '계약기간 표시 오류로 취소 후 재공고';
const KEEP = randomUUID(), OLD = randomUUID();
const base = { source_type: 'kapt_bid', source_external_id: BID, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${BID}`, title: TITLE, issuer: '시험팔일칠아파트', facility_name: '시험팔일칠아파트',
  related: true, fit_business: '다짐', matched_keywords: ['주민공동', '위탁운영'], classification: '즉시 검토', current_status: '진행중', notice_state: '신규공고', posted_date: today, deadline_at: `${plus(8)}T17:00:00+09:00` };
const COLL = ['kapt_sa_sun', 'operating_from_kapt', 'kicox_industrial_complexes', 'public_sports_facilities', 'tourist_hotels_localdata', 'kapt_weekly_complexes', 'reb_recent_complexes', 'kapt_new_complexes', 'kapt_bid_notices',
  'g2b_bid_notices', 'g2b_prespec_awards', 'kapt_bid_results', 'public_agency_bids', 'vendor_recruit_watch', 'bizinfo_support', 'kstartup_support', 'support_watch', 'gov24_support'];
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); };
const card = async (tab) => (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=${tab}`));

before(async () => {
  await resetDb(); srv = await startServer({}); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  for (const k of ['staffA', 'staffB']) await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx[k].id, spaces: ['sales'] });
  for (const slug of COLL) await sql`insert into sales_collector_state (slug, enabled) values (${slug}, false) on conflict (slug) do update set enabled = false`; // 시험 중 바깥 원천을 부르지 않게
  const t0 = new Date(Date.now() - 6 * 36e5).toISOString();
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${KEEP}, ${sql.json({ ...base, id: KEEP, first_seen_at: t0, updated_at: t0 })}, 'workin')`;
  // 업무가 가리키는 줄 = 합쳐져 숨은 줄(운영 464b2e0e → 30a805e7)
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin, gone) values ('global', 'procurement_notices', ${OLD}, ${sql.json({ ...base, id: OLD, first_seen_at: t0, updated_at: t0, merged_into: KEEP })}, 'src', true)`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('344차 #925: 취소된 공고의 열린 입찰 업무는 휴지통 대신 경고 표시(sales_ref.cancel)+담당·공동 담당·요청자 알림 → [공고 취소로 완료]로 완료·체크리스트 건너뜀·하위 업무 완료 · 완료한 업무는 그대로', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: `[입찰] ${TITLE}`, assigneeId: ctx.staffA.id, coAssigneeIds: [ctx.staffB.id], space: 'sales' });
  const sub = await ctx.owner.ok('POST', '/api/tasks', { title: '서류 준비', parentId: t.id, assigneeId: ctx.staffA.id });
  const done = await ctx.owner.ok('POST', '/api/tasks', { title: '[입찰] 끝난 업무', assigneeId: ctx.staffA.id });
  const other = await ctx.owner.ok('POST', '/api/tasks', { title: '[입찰] 다른 공고', assigneeId: ctx.staffA.id });
  await ctx.owner.ok('POST', `/api/tasks/${t.id}/checklist`, { text: '서류 챙기기' }); await ctx.owner.ok('POST', `/api/tasks/${t.id}/checklist`, { text: '현장설명회 참석' });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: OLD, name: TITLE, bid: true })} where id = any(${[t.id, done.id]}::uuid[])`;
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: KEEP, name: TITLE, bid: true })}, title = '[입찰] 다른 공고' where id = ${other.id}`;
  await sql`update tasks set status = 'done' where id = ${done.id}`;
  await tick();
  assert.equal((await sql`select sales_ref->'cancel' as c from tasks where id = ${t.id}`)[0].c, null, '취소 전에는 표시 없음');
  // 원천 대조로 남은 줄이 취소됨(K-apt 상세 '취소된 계약' — #751 수집이 상태·사유를 고침)
  await sql`update sales_src_rows set row = row || ${sql.json({ current_status: '취소', notice_state: '취소', notice_kind: 'cancel', result_note: WHY })}::jsonb where src_id = ${KEEP}`;
  await tick();
  const by = Object.fromEntries((await sql`select id, deleted_at, status, sales_ref from tasks where id = any(${[t.id, sub.id, done.id, other.id]}::uuid[])`).map((x) => [x.id, x]));
  assert.equal(by[t.id].deleted_at, null, '휴지통으로 옮기지 않음'); assert.equal(by[t.id].status, 'todo', '업무는 그대로 열려 있음');
  assert.equal(by[t.id].sales_ref.cancel?.reason, WHY, '취소 표시(사유)'); assert.equal(by[t.id].sales_ref.cancel?.noticeId, KEEP); assert.ok(by[t.id].sales_ref.cancel?.day, '취소일');
  assert.equal(by[other.id].sales_ref.cancel?.reason, WHY, '남은 줄을 바로 가리키는 업무도 표시'); assert.equal(by[other.id].deleted_at, null);
  assert.equal(by[done.id].sales_ref.cancel, undefined, '완료한 업무는 손대지 않음'); assert.equal(by[sub.id].deleted_at, null);
  const notes = await sql`select user_id, title, body, link from notifications where title like '공고 취소:%' order by user_id`;
  const to = new Set(notes.filter((n) => n.link === `/tasks/${t.id}`).map((n) => n.user_id));
  for (const u of [ctx.staffA.id, ctx.staffB.id, ctx.ownerId]) assert.ok(to.has(u), `알림 ${u}`);
  const n = notes.find((x) => x.user_id === ctx.staffA.id && x.link === `/tasks/${t.id}`);
  assert.match(n.body, /\[공고 취소로 완료\]/); assert.match(n.body, new RegExp(`사유: ${WHY}`)); assert.ok(!n.title.includes('[입찰]'), n.title);
  // 다시 돌려도 표시·알림이 또 가지 않음
  const before = (await sql`select count(*)::int n from notifications where title like '공고 취소:%'`)[0].n;
  await tick();
  assert.equal((await sql`select count(*)::int n from notifications where title like '공고 취소:%'`)[0].n, before);
  // 상세 응답에 취소 표시 · 목록 줄에도
  const d = await ctx.staffB.client.ok('GET', `/api/tasks/${t.id}`); assert.equal(d.task.sales_ref.cancel.reason, WHY); assert.ok(d.checklist.length >= 2, '직접 넣은 2줄(+335차 고정 칸 줄이 더 붙을 수 있음)');
  assert.ok(d.history.some((h) => h.action === 'notice_canceled'), '활동 기록');
  // 취소 표시가 없는 업무는 400 · 공동 담당(staffB)이 [공고 취소로 완료]
  assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${done.id}/bid-cancel-done`, {})).status, 400);
  const r = await ctx.staffB.client.ok('POST', `/api/tasks/${t.id}/bid-cancel-done`, {});
  assert.equal(r.status, 'done'); assert.ok(r.skippedChecklist >= 2, `남은 항목 전부 건너뜀 ${r.skippedChecklist}`); assert.equal(r.subtasks, 1);
  const after = await ctx.owner.ok('GET', `/api/tasks/${t.id}`);
  assert.equal(after.task.status, 'done'); assert.ok(after.checklist.every((c) => c.skipped_at && !c.done), '남은 체크리스트는 건너뜀(완료 아님)'); assert.equal(after.checklist.length, r.skippedChecklist);
  const cb = after.history.find((h) => h.action === 'closed_by'); assert.ok(cb, '완료 처리 기록'); assert.equal(cb.changes?.as, '공고 취소'); assert.equal(cb.changes?.skippedChecklist, r.skippedChecklist);
  assert.equal((await sql`select status from tasks where id = ${sub.id}`)[0].status, 'done', '하위 업무도 완료');
  const again = await ctx.staffB.client.ok('POST', `/api/tasks/${t.id}/bid-cancel-done`, {}); assert.equal(again.already, true);
  const dn = await sql`select user_id, body from notifications where title like '공고 취소로 완료:%'`;
  assert.ok(dn.some((x) => x.user_id === ctx.staffA.id) && !dn.some((x) => x.user_id === ctx.staffB.id), '다른 담당자에게만 완료 알림');
  assert.match(dn[0].body, /건너뜀/);
});

test('#830 취소 공고는 입찰 목록 모든 탭(전체 포함)에서 빠지고 \'취소된 공고\' 탭에만 — 사유와 함께', async () => {
  const all = await card('all');
  assert.ok(!all.items.some((x) => x.noticeNo === BID), '전체 탭에서 빠짐');
  assert.ok(!(await card('open')).items.some((x) => x.noticeNo === BID));
  const c = await card('canceled');
  const it = c.items.find((x) => x.noticeNo === BID);
  assert.ok(it, JSON.stringify(c.items.map((x) => x.noticeNo))); assert.equal(it.status, '취소'); assert.equal(it.cancelReason, WHY);
  assert.ok(all.canceledCount >= 1, '칩 건수');
});

test('346차: 번호·마감이 다른 \'(긴급)\' 재게시(같은 제목·발주처)가 취소되면 — 원래 공고를 가리키는 업무도 취소 표시(광명자이 f1713d0b 꼴) · 취소 카드에 "업무 열려 있음" 링크', async () => {
  const ORIG = randomUUID(), URG = randomUUID(); const T2 = '[경기] 시험삼사육아파트 커뮤니티센터 위탁운영 업체 선정 입찰공고';
  const t1 = new Date(Date.now() - 5 * 36e5).toISOString(), t2 = new Date(Date.now() - 3 * 36e5).toISOString();
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ORIG}, ${sql.json({ ...base, id: ORIG, source_external_id: 'kg2b_346001', title: T2, issuer: '시험삼사육아파트', facility_name: '시험삼사육아파트', posted_date: plus(-3), deadline_at: `${plus(1)}T17:00:00+09:00`, first_seen_at: t1, updated_at: t1 })}, 'workin')`;
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${URG}, ${sql.json({ ...base, id: URG, source_external_id: 'kg2b_346002', title: `${T2}(긴급)`, issuer: '시험삼사육아파트', facility_name: '시험삼사육아파트', posted_date: plus(-1), deadline_at: `${plus(6)}T17:00:00+09:00`, first_seen_at: t2, updated_at: t2, current_status: '취소', notice_state: '취소', notice_kind: 'cancel', result_note: '사업 계획 변경' })}, 'workin')`;
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: `[입찰] ${T2}`, assigneeId: ctx.staffA.id, space: 'sales' });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: ORIG, name: T2, bid: true })} where id = ${t.id}`;
  // 이 회사 진행 기록(넘긴 줄 = 원래 공고)에 업무 id — 취소 카드의 업무 링크는 이 기록으로 찾음
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, data) values ('default', 'procurement_notices', ${ORIG}, ${ORIG}, '입찰 진행', ${sql.json({ status: '입찰 진행', notice_id: ORIG, bid_task_id: t.id, assignees: [ctx.staffA.id] })})`.catch(() => {});
  await tick();
  const [row] = await sql`select sales_ref, deleted_at, status from tasks where id = ${t.id}`;
  assert.equal(row.deleted_at, null); assert.equal(row.status, 'todo');
  assert.equal(row.sales_ref.cancel?.noticeId, URG, '뒤에 올라온 긴급 재게시의 취소로 표시'); assert.equal(row.sales_ref.cancel?.reason, '사업 계획 변경');
  const c = await card('canceled'); const it = c.items.find((x) => String(x.title).includes('시험삼사육'));
  assert.ok(it, JSON.stringify(c.items.map((x) => x.title)));
  if (it.cancelTask) { assert.equal(it.cancelTask.id, t.id); assert.equal(it.cancelTask.done, false); }
});

