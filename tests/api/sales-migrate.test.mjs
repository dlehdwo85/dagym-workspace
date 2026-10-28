// V41 단계 2 영업관리 이전 미리보기: 가짜 PostgREST(설명서·count=exact)·Secret 키는 apikey 헤더만·저장 없음·플랫폼 운영자만·관련 공고 건수
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3221, KEY = 'sb_secret_testsalessrc0123456789';
const COUNTS = { leads: 21, procurement_notices: 4356, procurement_reclass_backup_20261014: 10 };
let leadsN = 21, ownerEmail = 'x@y', noticeOver = {};
const rowsOf = (t) => t === 'leads' ? Array.from({ length: leadsN }, (_, i) => ({ id: `L${i}`, name: `거래처 ${i}`, owner_id: 'P1' }))
  : t === 'procurement_notices' ? Array.from({ length: 4356 }, (_, i) => ({ id: i + 1, title: `공고 ${i}`, related: i < 654, classification: i % 10 === 0 ? '회사분류' : null, lead_id: null, ...(noticeOver[i + 1] ?? {}) }))
  : t === 'profiles' ? [{ id: 'P1', email: ownerEmail.toUpperCase(), full_name: '대표' }, { id: 'P2', email: 'nobody@example.com', full_name: '퇴사자' }] : null;
let srv, ctx, sql, fake, hits = [], specFail = false;
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push({ path: u.pathname, q: u.search, h: req.headers });
    if (req.headers.apikey !== KEY || req.headers.authorization) { res.statusCode = 401; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    if (u.pathname.startsWith('/rest/v1/rest/v1')) { res.statusCode = 404; return res.end(JSON.stringify({ code: 'PGRST125' })); }
    if (u.pathname === '/rest/v1/' && specFail) { res.statusCode = 404; return res.end(JSON.stringify({ code: 'PGRST125', message: 'Invalid path specified in request URL' })); }
    if (u.pathname === '/rest/v1/') return res.end(JSON.stringify({ definitions: {
      leads: { properties: { id: {}, name: {}, status: {} } }, procurement_notices: { properties: { id: {}, title: {}, related: {} } }, procurement_reclass_backup_20261014: { properties: { id: {} } } } }));
    const t = decodeURIComponent(u.pathname.replace('/rest/v1/', ''));
    if (req.headers.prefer !== 'count=exact') { // 본문 읽기(적용): limit/offset 페이지
      const all = rowsOf(t); if (!all) { res.statusCode = 404; return res.end(JSON.stringify({ code: 'PGRST205' })); }
      const off = Number(u.searchParams.get('offset') ?? 0), lim = Number(u.searchParams.get('limit') ?? 1000);
      return res.end(JSON.stringify(all.slice(off, off + lim)));
    }
    if (t === 'leads') { res.statusCode = 206; res.setHeader('content-range', `0-0/${leadsN}`); return res.end('[{}]'); }
    if (!(t in COUNTS)) { res.statusCode = 404; return res.end('{}'); }
    const n = t === 'procurement_notices' && u.searchParams.get('related') === 'is.true' ? 654 : COUNTS[t];
    res.statusCode = 206; res.setHeader('content-range', `0-0/${n}`); res.end('[{}]');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_SRC_URL: `http://localhost:${PORT}/rest/v1/`, /* 대표가 /rest/v1/ 까지 붙여 넣은 경우 */ SALES_SRC_SERVICE_KEY: KEY, SALES_SRC_TEST: '1' }); sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('미리보기: 표·건수·칸·관련 공고, 저장 없음', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/sales-migrate', {})).status, 404, '플랫폼 운영자만');
  const r = await ctx.owner.ok('POST', '/api/platform/sales-migrate', {});
  const by = Object.fromEntries(r.tables.map((t) => [t.name, t]));
  assert.equal(by.leads.count, 21); assert.equal(by.leads.expected, 21); assert.deepEqual(by.leads.columns, ['id', 'name', 'status']);
  assert.equal(by.procurement_notices.count, 4356); assert.equal(r.related, 654);
  assert.equal(by.procurement_reclass_backup_20261014.skip, true, '백업 표는 옮기지 않음');
  assert.ok(hits.every((h) => !h.h.authorization), 'Secret 키는 Authorization 에 안 넣음');
  assert.ok(hits.filter((h) => h.path !== '/rest/v1/').every((h) => h.h.prefer === 'count=exact'), '본문 없이 건수만');
  assert.ok(hits.every((h) => h.h['x-http-method-override'] === undefined), '읽기(GET)만');
});

test('설명서가 막히면 알려진 표 27개로 건수만, 원인은 화면에', async () => {
  specFail = true;
  const r = await ctx.owner.ok('POST', '/api/platform/sales-migrate', {});
  assert.match(r.specError, /404/);
  assert.equal(r.tables.length, 27);
  const by = Object.fromEntries(r.tables.map((t) => [t.name, t]));
  assert.equal(by.leads.count, 21); assert.equal(by.lead_opportunity_timing.expected, 2);
  assert.match(by.proposals.error, /표 없음/);
  assert.equal(r.related, 654);
});

test('적용: 공용/회사별·진행 칸 분리·멱등·사라진 행·사용자 연결·대조', async () => {
  specFail = false;
  ownerEmail = (await sql`select email from users where id = ${ctx.ownerId}`)[0].email;
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' })).status, 404);
  const r = await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' });
  const by = Object.fromEntries(r.results.map((t) => [t.tbl, t]));
  assert.deepEqual([by.leads.scope, by.leads.src, by.leads.dst, by.leads.ok], ['tenant', 21, 21, true]);
  assert.deepEqual([by.procurement_notices.scope, by.procurement_notices.dst, by.procurement_notices.ok, by.procurement_notices.progress], ['global', 4356, true, 436]);
  assert.equal(r.related, 654);
  assert.match(by.proposals.error, /404/, '원본에 없는 표는 오류로 표시');
  const [g] = await sql`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = '1'`;
  assert.equal(g.row.classification, undefined, '공용 칸에는 회사 분류 없음');
  const [p] = await sql`select row from sales_src_rows where scope = 'default' and tbl = 'procurement_notices__progress' and src_id = '1'`;
  assert.equal(p.row.classification, '회사분류', '회사 쪽 진행 칸');
  assert.deepEqual([r.users.total, r.users.matched], [2, 1]);
  const map = await sql`select src_user_id, user_id, matched from sales_user_map order by src_user_id`;
  assert.equal(map[0].user_id, ctx.ownerId); assert.equal(map[1].user_id, ctx.ownerId, '못 찾으면 대표');
  // 191차(대표 10/27 판정 정정): 워크인 규칙으로 판정한 공고 줄(judged_at)은 매일 복사가 판정 칸을 원본 값으로 되돌리지 않음 — 다른 칸은 원본 값
  await sql`update sales_src_rows set row = row || ${sql.json({ related: false, fit_business: null, matched_keywords: [], classification: '참고(비관련)', refit_lowered_at: '2026-10-27T00:00:00Z', judged_at: '2026-10-27T00:00:00Z', title: '바뀌기 전 제목' })}::jsonb where scope = 'global' and tbl = 'procurement_notices' and src_id = '2'`;
  await sql`update sales_src_rows set row = row || ${sql.json({ related: false })}::jsonb where scope = 'global' and tbl = 'procurement_notices' and src_id = '3'`;
  // 다시 눌러도 중복 없음 · 원본에서 하나 사라지면 '사라짐' 표시 후 대조 일치
  leadsN = 20;
  const r2 = await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' });
  const l2 = r2.results.find((t) => t.tbl === 'leads');
  assert.deepEqual([l2.src, l2.dst, l2.ok], [20, 20, true]);
  assert.equal((await sql`select count(*)::int n from sales_src_rows where tbl = 'leads'`)[0].n, 21, '지우지 않고 사라짐 표시');
  const [j2] = await sql`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = '2'`;
  assert.deepEqual([j2.row.related, j2.row.fit_business, j2.row.classification, j2.row.judged_at, j2.row.title], [false, null, '참고(비관련)', '2026-10-27T00:00:00Z', '공고 1'], '판정 칸은 워크인 값 · 제목은 원본 값');
  const [j3] = await sql`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = '3'`;
  assert.equal(j3.row.related, true, '워크인이 판정하지 않은 줄은 원본 값 그대로');
  // 로컬 요청 10/19: 이메일로 못 찾은 원본 사용자(P2)를 워크인 사용자에 직접 연결 → 다시 적용해도 유지(멱등)
  assert.equal((await ctx.owner.req('POST', '/api/platform/sales-migrate', { action: 'map', tenant: 'default', srcUserId: 'P2', userId: '00000000-0000-0000-0000-000000000000' })).status, 400, '그 회사 사용자만');
  await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'map', tenant: 'default', srcUserId: 'P2', userId: ctx.staffA.id });
  await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' });
  const [p2] = await sql`select user_id, manual, matched from sales_user_map where src_user_id = 'P2'`;
  assert.deepEqual([p2.user_id, p2.manual, p2.matched], [ctx.staffA.id, true, true], '다시 적용해도 직접 연결 유지');
  const st = await ctx.owner.ok('GET', '/api/platform/sales-migrate');
  assert.equal(st.applied.daily, true); assert.ok(st.sync.find((x) => x.tbl === 'leads' && x.dst_count === 20));
  await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'daily', daily: false });
  assert.equal((await ctx.owner.ok('GET', '/api/platform/sales-migrate')).applied.daily, false);
});

test('전환 T-1: 동결 시점 원본 건수 → 정식 표 변환·대조 → 쓰기 잠금 409 → 대조 맞으면 열기(보류·실패 사유 필수)', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/sales-cutover', { action: 'snapshot' })).status, 404, '플랫폼 운영자만');
  const snap = await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'snapshot', tenant: 'default' });
  assert.deepEqual([snap.srcCounts.leads, snap.srcCounts.procurement_notices, snap.srcCounts.related, snap.srcCounts.proposals], [20, 4356, 654, null], '기준 = 그때 원본 실제 건수(없는 표 null)');
  // 쓰기는 열기 전 409, 대조 전에는 열 수 없음
  assert.equal((await ctx.owner.req('POST', '/api/platform/sales-cutover', { action: 'open', tenant: 'default' })).status, 409);
  const v = await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'convert', tenant: 'default' });
  assert.equal(v.ok, true, JSON.stringify(v.mismatches));
  assert.deepEqual([v.dstCounts.formal.leads, v.dstCounts.formal.procurement_notices__progress, v.dstCounts.related], [20, 436, 654]);
  const [lead] = await sql`select id, owner_id, status from sales_leads where tenant = 'default' and src_id = 'L3'`;
  assert.equal(lead.owner_id, ctx.ownerId, '원본 담당자 → 워크인 사용자');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const ro = await ctx.owner.req('PATCH', `/api/sales/leads/${lead.id}`, { status: '미팅예정' });
  assert.equal(ro.status, 409, '전환 전에는 영업관리에서'); assert.equal(ro.body.error.code, 'sales_read_only');
  // 원본 건수와 다르면(옮긴 행이 하나 빠짐) 대조 실패 → 열 수 없음
  await sql`update sales_src_rows set gone = true where scope = 'default' and tbl = 'leads' and src_id = 'L0'`;
  const bad = await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'convert', tenant: 'default' });
  assert.equal(bad.ok, false); assert.ok(bad.mismatches.some((m) => m.item === 'leads' && m.source === 20 && m.copied === 19), JSON.stringify(bad.mismatches));
  assert.equal((await ctx.owner.req('POST', '/api/platform/sales-cutover', { action: 'open', tenant: 'default' })).status, 409);
  await sql`update sales_src_rows set gone = false where scope = 'default' and tbl = 'leads' and src_id = 'L0'`;
  assert.equal((await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'convert', tenant: 'default' })).ok, true);
  await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'open', tenant: 'default' });
  // 열린 뒤: 보류·실패는 사유 필수, 상태 기록, 담당 변경은 관리자, 다른 회사 404
  assert.equal((await ctx.owner.req('PATCH', `/api/sales/leads/${lead.id}`, { status: '보류' })).status, 400, '사유 없이 보류 불가');
  await ctx.owner.ok('PATCH', `/api/sales/leads/${lead.id}`, { status: '보류', reason: '예산 확정 전', nextContactDate: '2026-11-02' });
  const [after] = await sql`select status, next_contact_date::text d from sales_leads where id = ${lead.id}`;
  assert.deepEqual([after.status, after.d], ['보류', '2026-11-02']);
  const [log] = await sql`select from_status, to_status, reason from sales_status_log where lead_id = ${lead.id}`;
  assert.deepEqual([log.to_status, log.reason], ['보류', '예산 확정 전']);
  assert.equal((await ctx.owner.req('PATCH', `/api/sales/leads/${lead.id}`, { status: '없는단계' })).status, 400);
  // 대표 요청(거래처 장): 표 안 편집 — 거래처명·우선순위, 목록은 단계·사람 목록·한국어 날짜(Date 객체가 'Wed Sep 09' 로 나오지 않게)
  await ctx.owner.ok('PATCH', `/api/sales/leads/${lead.id}`, { name: '표에서 고친 이름', priority: 'high' });
  const [ed] = await sql`select name, priority from sales_leads where id = ${lead.id}`;
  assert.deepEqual([ed.name, ed.priority], ['표에서 고친 이름', 'high']);
  const lv = await ctx.owner.ok('GET', '/api/sales/src?view=leads');
  const row = lv.leads.find((l) => l.id === lead.id);
  assert.deepEqual([row.name, row.priority, row.priorityCode], ['표에서 고친 이름', '높음', 'high']);
  assert.match(String(row.updated), /^\d{4}-\d{2}-\d{2}$/, `날짜 형식 ${row.updated}`);
  assert.ok(lv.stages.length && lv.canAssign && lv.people.length, '표 안 편집에 쓰는 단계·담당 목록');
  assert.equal((await ctx.owner.req('PATCH', `/api/sales/leads/${lead.id}`, { priority: 'nope' })).status, 400);
  assert.equal((await ctx.owner.req('PATCH', '/api/sales/leads/00000000-0000-0000-0000-000000000000', { memo: 'x' })).status, 404);
  const st = await ctx.owner.ok('GET', '/api/platform/sales-cutover');
  assert.ok(st.cutovers.some((c) => c.tenant === 'default' && c.writes_open && c.ok));
  await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'close', tenant: 'default' });
  assert.equal((await ctx.owner.req('PATCH', `/api/sales/leads/${lead.id}`, { memo: 'x' })).status, 409, '닫으면 다시 잠김');
});

test('전환 T-5: 쓰기 열면 화면이 정식 표를 읽음 · 새 리드·상담 기록 · 다시 변환 막힘 · 적용은 공용 표만', async () => {
  await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'convert', tenant: 'default' });
  await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'open', tenant: 'default' });
  assert.equal((await ctx.owner.req('POST', '/api/platform/sales-cutover', { action: 'convert', tenant: 'default' })).status, 409, '연 뒤 다시 변환 = 워크인 수정분 덮어쓰기 → 막음');
  let L = await ctx.owner.ok('GET', '/api/sales/src?view=leads');
  assert.equal(L.readOnly, false);
  const created = await ctx.owner.ok('POST', '/api/sales/leads', { name: '새 거래처', region: '서울' });
  L = await ctx.owner.ok('GET', '/api/sales/src?view=leads');
  assert.ok(L.leads.some((l) => l.id === created.id && l.name === '새 거래처' && l.status === '신규리드'), '새 리드가 목록에');
  await ctx.owner.ok('POST', `/api/sales/leads/${created.id}/activities`, { type: '방문', content: '현장 확인', date: '2026-10-19' });
  await ctx.owner.ok('PATCH', `/api/sales/leads/${created.id}`, { status: '실패', reason: '경쟁사 계약' });
  // 핫픽스 10/19: 다음 연락일(date 칸)이 있는 리드가 있으면 현황·리드·파이프라인·지역이 500 이던 문제
  await ctx.owner.ok('PATCH', `/api/sales/leads/${created.id}`, { nextContactDate: '2026-10-25' });
  for (const view of ['summary', 'leads', 'pipeline', 'regions']) assert.equal((await ctx.owner.req('GET', `/api/sales/src?view=${view}`)).status, 200, view);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((l) => l.id === created.id).next, '2026-10-25');
  const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${created.id}`);
  assert.equal(d.lead.status, '실패'); assert.equal(d.activities[0].content, '현장 확인');
  assert.equal(d.statusLog[0].reason, '경쟁사 계약'); assert.ok(d.stages.includes('보류')); assert.equal(d.canAssign, true);
  // 옮긴 리드(원본 id 기준)도 정식 id 로 열림 · 원본 담당 이름 유지
  const old = L.leads.find((l) => l.name === '거래처 3');
  assert.ok(old && /^[0-9a-f-]{36}$/.test(old.id), JSON.stringify(old));
  // 적용(매일 가져오기)은 공용 표만 — 회사별 리드는 원본으로 덮이지 않음
  leadsN = 25;
  const ap = await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' });
  assert.ok(!ap.results.some((r) => r.tbl === 'leads'), '회사별 표는 건너뜀');
  assert.equal((await sql`select count(*)::int n from sales_leads where tenant = 'default'`)[0].n, 21, '원본 20 + 새 1(원본이 25로 늘어도 회사별 표는 안 가져옴)');
  await ctx.owner.ok('POST', '/api/platform/sales-cutover', { action: 'close', tenant: 'default' });
  assert.equal((await ctx.owner.req('POST', '/api/sales/leads', { name: 'x' })).status, 409);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=leads')).readOnly, true, '닫으면 다시 원본(옮긴 행) 읽기 전용');
});

test('232차(로컬 10/28 15:40 남원시) 원본 매일 복사: 워크인이 채운 결과 칸은 원본이 비어 있으면 남김 · 원본에 값이 있으면 원본 값 · 결과 상태를 되돌리지 않음 · 원본 복사로 결과를 처음 알면 그때가 결과 시각', async () => {
  const at0 = '2026-10-27T23:11:00.000Z';
  const put = (id, o) => sql`update sales_src_rows set row = row || ${sql.json(o)}::jsonb where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
  const row = async (id) => (await sql`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`)[0].row;
  await put('11', { winner_name: '워크인낙찰(주)', winner_biz_no: '1234567890', winner_amount: 26156000, award_date: '2026-10-26', winner_rate: 88.019, bidders: 38, current_status: '낙찰', result_at: at0, result_filled_at: at0,
    kapt_detail_at: at0, participants: [{ name: '워크인낙찰(주)', bizNo: '1234567890', amount: 26156000, won: true }], result_note: '적격심사 1순위' });
  await put('12', { current_status: '유찰', notice_state: '유찰', result_at: at0, result_note: '응찰 업체 부족', kapt_detail_at: at0 });
  noticeOver = { 11: { title: '원본 제목 바뀜', winner_rate: 90.5, bidders: null, winner_name: '', current_status: '진행중' }, 12: { current_status: '마감', notice_state: '일반' }, 13: { winner_name: '원본낙찰(주)', current_status: '낙찰' } };
  try {
    const t0 = Date.now();
    await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' });
    const a = await row('11');
    assert.deepEqual([a.title, a.winner_rate, a.bidders, a.winner_name, a.winner_biz_no, a.current_status, a.result_at, a.result_filled_at, a.kapt_detail_at, a.participants?.length, a.result_note],
      ['원본 제목 바뀜', 90.5, 38, '워크인낙찰(주)', '1234567890', '낙찰', at0, at0, at0, 1, '적격심사 1순위'], '원본에 값이 있으면 원본(제목·낙찰률) · 비면 워크인 값 · 결과 상태 그대로');
    const b = await row('12');
    assert.deepEqual([b.current_status, b.notice_state, b.result_at, b.result_note, b.kapt_detail_at], ['유찰', '유찰', at0, '응찰 업체 부족', at0], '유찰을 원본의 마감으로 되돌리지 않음');
    const c = await row('13');
    assert.equal(c.winner_name, '원본낙찰(주)'); assert.ok(Date.parse(c.result_at) >= t0 - 1000, `원본 복사로 결과를 처음 앎 → 결과 시각 ${c.result_at}`);
    await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' });
    assert.equal((await row('13')).result_at, c.result_at, '다시 적용해도 결과 시각 그대로');
    assert.equal((await row('14')).result_at, undefined, '결과가 아닌 줄은 결과 시각 없음');
  } finally { noticeOver = {}; }
});
