// V41 단계 2 영업관리 이전 미리보기: 가짜 PostgREST(설명서·count=exact)·Secret 키는 apikey 헤더만·저장 없음·플랫폼 운영자만·관련 공고 건수
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3221, KEY = 'sb_secret_testsalessrc0123456789';
const COUNTS = { leads: 21, procurement_notices: 4356, procurement_reclass_backup_20261014: 10 };
let leadsN = 21, ownerEmail = 'x@y';
const rowsOf = (t) => t === 'leads' ? Array.from({ length: leadsN }, (_, i) => ({ id: `L${i}`, name: `거래처 ${i}`, owner_id: 'P1' }))
  : t === 'procurement_notices' ? Array.from({ length: 4356 }, (_, i) => ({ id: i + 1, title: `공고 ${i}`, related: i < 654, classification: i % 10 === 0 ? '회사분류' : null, lead_id: null }))
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
  // 다시 눌러도 중복 없음 · 원본에서 하나 사라지면 '사라짐' 표시 후 대조 일치
  leadsN = 20;
  const r2 = await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'apply', tenant: 'default' });
  const l2 = r2.results.find((t) => t.tbl === 'leads');
  assert.deepEqual([l2.src, l2.dst, l2.ok], [20, 20, true]);
  assert.equal((await sql`select count(*)::int n from sales_src_rows where tbl = 'leads'`)[0].n, 21, '지우지 않고 사라짐 표시');
  const st = await ctx.owner.ok('GET', '/api/platform/sales-migrate');
  assert.equal(st.applied.daily, true); assert.ok(st.sync.find((x) => x.tbl === 'leads' && x.dst_count === 20));
  await ctx.owner.ok('POST', '/api/platform/sales-migrate', { action: 'daily', daily: false });
  assert.equal((await ctx.owner.ok('GET', '/api/platform/sales-migrate')).applied.daily, false);
});
