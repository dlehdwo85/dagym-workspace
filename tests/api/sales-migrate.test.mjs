// V41 단계 2 영업관리 이전 미리보기: 가짜 PostgREST(설명서·count=exact)·Secret 키는 apikey 헤더만·저장 없음·플랫폼 운영자만·관련 공고 건수
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3221, KEY = 'sb_secret_testsalessrc0123456789';
const COUNTS = { leads: 21, procurement_notices: 4356, procurement_reclass_backup_20261014: 10 };
let srv, ctx, sql, fake, hits = [];
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push({ path: u.pathname, q: u.search, h: req.headers });
    if (req.headers.apikey !== KEY || req.headers.authorization) { res.statusCode = 401; return res.end('{}'); }
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/rest/v1/') return res.end(JSON.stringify({ definitions: {
      leads: { properties: { id: {}, name: {}, status: {} } }, procurement_notices: { properties: { id: {}, title: {}, related: {} } }, procurement_reclass_backup_20261014: { properties: { id: {} } } } }));
    const t = decodeURIComponent(u.pathname.replace('/rest/v1/', ''));
    if (!(t in COUNTS)) { res.statusCode = 404; return res.end('{}'); }
    const n = t === 'procurement_notices' && u.searchParams.get('related') === 'is.true' ? 654 : COUNTS[t];
    res.statusCode = 206; res.setHeader('content-range', `0-0/${n}`); res.end('[{}]');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_SRC_URL: `http://localhost:${PORT}`, SALES_SRC_SERVICE_KEY: KEY, SALES_SRC_TEST: '1' }); sql = testDb(); ctx = await bootstrap();
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
