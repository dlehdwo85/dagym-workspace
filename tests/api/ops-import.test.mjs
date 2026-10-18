// V41 4-2 운영실 → 워크인 이관: 서명 요청(가짜 운영실이 HMAC·시각 검사)·manifest + 페이지(500건 단위 대신 2건)·건수/해시 대조·
// 미리보기는 저장 없음·불일치면 적용 안 함·적용 멱등·플랫폼 운영자만·회사 안 조회는 마케팅 관리자만·전화 기록 보관 기간 삭제
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3219, TOKEN = 'ops-export-test-token-123';
const DATA = {
  'mkt:posts:v1': { kind: 'list', value: [{ id: 'p1', title: '가을 행사', status: 'published' }, { id: 'p2', title: '신규 회원' }, { id: 'p3', title: '리뷰' }] },
  'mkt:plan-state:v1': { kind: 'object', value: { week: '2026-W42', locked: false } },
  'mkt:call-records:v1': { kind: 'list', value: [{ phone: '010-1111-2222', at: '2026-10-10T01:00:00Z', source: 'ads' }] },
};
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
let srv, ctx, sql, fake, tamper = false, seen = [];
before(async () => {
  fake = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const ts = req.headers['x-export-ts'], sig = req.headers['x-export-sig'];
    const want = createHmac('sha256', TOKEN).update(`${ts}\n${req.url}`).digest('hex');
    if (sig !== want || Math.abs(Date.now() / 1000 - Number(ts)) > 300) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'bad signature' })); }
    seen.push(req.url);
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/marketing/export/manifest') return res.end(JSON.stringify({ ok: true, generatedAt: '2026-10-18T01:00:00.000Z', frozen: false,
      keys: Object.entries(DATA).map(([key, d]) => ({ key, kind: d.kind, count: Array.isArray(d.value) ? d.value.length : 1, bytes: 10, sha256: sha(d.value) })) }));
    const key = u.searchParams.get('key'), d = DATA[key], cur = Number(u.searchParams.get('cursor'));
    if (!d) { res.statusCode = 404; return res.end(JSON.stringify({ ok: false })); }
    if (d.kind !== 'list') return res.end(JSON.stringify({ ok: true, key, kind: d.kind, items: d.value, sha256: sha(d.value) }));
    let items = d.value.slice(cur, cur + 2);
    if (tamper && key === 'mkt:posts:v1' && cur === 0) items = items.slice(0, 1); // 한 건 빠짐
    return res.end(JSON.stringify({ ok: true, key, kind: 'list', total: d.value.length, cursor: cur, next: cur + 2 < d.value.length ? cur + 2 : null, items, sha256: sha(d.value) }));
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ OPS_EXPORT_URL: `http://localhost:${PORT}`, OPS_EXPORT_TOKEN: TOKEN });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('미리보기·대조·적용·권한·보관 기간', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/ops-import')).status, 404, '플랫폼 운영자만');
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/ops-import', { tenant: 'default', mode: 'apply' })).status, 404);
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const st = await ctx.owner.ok('GET', '/api/platform/ops-import');
  assert.equal(st.configured, true); assert.equal(st.keys.length, 18);
  // 미리보기: 3개 키 일치·나머지 15개는 '목록에 없음', 저장 없음, posts 는 2페이지
  const pv = await ctx.owner.ok('POST', '/api/platform/ops-import', { tenant: 'default', mode: 'preview' });
  assert.equal(pv.status, 'ok', JSON.stringify(pv.results.filter((r) => !r.missing)));
  const posts = pv.results.find((r) => r.key === 'mkt:posts:v1');
  assert.deepEqual([posts.count, posts.countOk, posts.shaOk], [3, true, true]);
  assert.deepEqual(posts.sample, ['id', 'title', 'status'], '칸 이름만');
  assert.ok(!JSON.stringify(pv).includes('010-1111-2222'), '미리보기에 전화번호 없음');
  assert.equal(pv.results.filter((r) => r.missing).length, 15);
  assert.equal(seen.filter((x) => x.includes('mkt%3Aposts%3Av1')).length, 2, '페이지 2번');
  assert.equal((await sql`select count(*)::int n from ops_import_items`)[0].n, 0, '미리보기는 저장 없음');
  // 불일치 → 적용 안 함
  tamper = true;
  const bad = await ctx.owner.ok('POST', '/api/platform/ops-import', { tenant: 'default', mode: 'apply' });
  assert.equal(bad.status, 'mismatch'); assert.equal(bad.applied, false);
  assert.equal((await sql`select count(*)::int n from ops_import_items`)[0].n, 0);
  tamper = false;
  // 적용 두 번 = 같은 결과
  for (let k = 0; k < 2; k++) assert.equal((await ctx.owner.ok('POST', '/api/platform/ops-import', { tenant: 'default', mode: 'apply' })).applied, true);
  const rows = await sql`select key, count(*)::int n from ops_import_items where tenant = 'default' group by key order by key`;
  assert.deepEqual(rows.map((r) => [r.key, r.n]), [['mkt:call-records:v1', 1], ['mkt:plan-state:v1', 1], ['mkt:posts:v1', 3]]);
  assert.equal((await ctx.owner.req('POST', '/api/platform/ops-import', { tenant: 'nope', mode: 'preview' })).status, 400, '없는 회사');
  // 회사 안 조회: 마케팅 공간·관리자만, 전화 기록 조회는 감사 기록
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  assert.equal((await ctx.staffA.client.req('GET', '/api/marketing/imported')).status, 403, '직원은 못 봄');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/imported')).keys.length, 3);
  const calls = await ctx.owner.ok('GET', '/api/marketing/imported?key=mkt%3Acall-records%3Av1');
  assert.equal(calls.items[0].item.phone, '010-1111-2222');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'ops_import.view_pii'`)[0].n, 1);
  // 보관 기간(기본 365일) 지난 전화 기록은 tick 이 삭제, 다른 키는 그대로
  await sql`update ops_import_items set imported_at = now() - interval '400 days'`;
  await tick();
  const left = await sql`select key from ops_import_items group by key order by key`;
  assert.deepEqual(left.map((r) => r.key), ['mkt:plan-state:v1', 'mkt:posts:v1']);
});
