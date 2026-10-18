// V41 4-2 운영실 → 워크인 이관: 서명 요청(가짜 운영실이 HMAC·시각 검사)·manifest + 페이지(500건 단위 대신 2건)·건수/해시 대조·
// 미리보기는 저장 없음·불일치면 적용 안 함·적용 멱등·플랫폼 운영자만·회사 안 조회는 마케팅 관리자만·전화 기록 보관 기간 삭제
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3219, TOKEN = 'ops-export-test-token-123';
const DATA = {
  'mkt:posts:v1': { kind: 'list', value: [{ id: 'p1', title: '가을 행사', status: 'published' }, { id: 'p2', title: '신규 회원' }, { id: 'p3', title: '리뷰 010-7777-8888 문의' }] },
  'mkt:library:v1': { kind: 'list', value: [{ id: 'L1', name: '가을 포스터.png', url: 'http://localhost:3219/blob/library/poster.png', size: 8, type: 'image/png', brand: '다짐', note: '메인 시안', usedIn: ['p1'], createdAt: '2026-10-01' }] },
  'mkt:call-clicks:first-seen:v1': { kind: 'string', value: '2026-10-01T00:00:00.000Z' },
  'mkt:plan-state:v1': { kind: 'object', value: { week: '2026-W42', locked: false } },
  'mkt:call-records:v1': { kind: 'list', value: [{ phone: '010-1111-2222', at: '2026-10-10T01:00:00Z', source: 'ads', memo: '02 555 3344 로 다시 전화' }] },
};
const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
let srv, ctx, sql, fake, tamper = false, seen = [], blobHits = 0;
before(async () => {
  fake = http.createServer((req, res) => {
    if (req.url === '/blob/library/poster.png') { blobHits++; res.setHeader('content-type', 'image/png'); return res.end(Buffer.from('PNGDATA!')); }
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
  srv = await startServer({ OPS_EXPORT_URL: `http://localhost:${PORT}`, OPS_EXPORT_TOKEN: TOKEN, OPS_BLOB_TEST: '1' });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('미리보기·대조·적용·권한·보관 기간', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/ops-import')).status, 404, '플랫폼 운영자만');
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/ops-import', { tenant: 'default', mode: 'apply' })).status, 404);
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const st = await ctx.owner.ok('GET', '/api/platform/ops-import');
  assert.equal(st.configured, true); assert.equal(st.keys.length, 19);
  // 미리보기: 3개 키 일치·나머지 15개는 '목록에 없음', 저장 없음, posts 는 2페이지
  const pv = await ctx.owner.ok('POST', '/api/platform/ops-import', { tenant: 'default', mode: 'preview' });
  assert.equal(pv.status, 'ok', JSON.stringify(pv.results.filter((r) => !r.missing)));
  const posts = pv.results.find((r) => r.key === 'mkt:posts:v1');
  assert.deepEqual([posts.count, posts.countOk, posts.shaOk], [3, true, true]);
  assert.deepEqual(posts.sample, ['id', 'title', 'status'], '칸 이름만');
  assert.ok(!JSON.stringify(pv).includes('010-1111-2222'), '미리보기에 전화번호 없음');
  assert.equal(pv.results.filter((r) => r.missing).length, 14);
  assert.deepEqual((({ count, countOk, shaOk }) => [count, countOk, shaOk])(pv.results.find((r) => r.key === 'mkt:call-clicks:first-seen:v1')), [1, true, true], '19번째 키(문자열)');
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
  assert.deepEqual(rows.map((r) => [r.key, r.n]), [['mkt:call-clicks:first-seen:v1', 1], ['mkt:call-records:v1', 1], ['mkt:library:v1', 1], ['mkt:plan-state:v1', 1], ['mkt:posts:v1', 3]]);
  // 자료실 파일은 워크인 저장소로 한 번만 복사(마케팅 공간·브랜드 폴더·usedIn 유지), 두 번째 적용은 건너뜀
  const lib = await sql`select space, folder, file_name, size_bytes, upload_status, meta, tags from library_files where ext_ref = 'ops-library:L1'`;
  assert.equal(lib.length, 1); assert.equal(blobHits, 1, '파일은 한 번만 내려받음');
  assert.deepEqual([lib[0].space, lib[0].folder, lib[0].size_bytes, lib[0].upload_status], ['marketing', '운영실 자료/다짐', '8', 'ready']);
  assert.deepEqual(lib[0].meta.usedIn, ['p1']); assert.deepEqual(lib[0].tags, ['다짐']);
  assert.equal((await sql`select count(*)::int n from mkt_brands where tenant = 'default' and name = '다짐'`)[0].n, 1, '브랜드 = 회사별 브랜드 표');
  assert.equal((await ctx.owner.req('POST', '/api/platform/ops-import', { tenant: 'nope', mode: 'preview' })).status, 400, '없는 회사');
  // 회사 안 조회: 마케팅 공간·관리자만, 전화 기록 조회는 감사 기록
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  assert.equal((await ctx.staffA.client.req('GET', '/api/marketing/imported')).status, 403, '직원은 못 봄');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/imported')).keys.length, 5);
  const calls = await ctx.owner.ok('GET', '/api/marketing/imported?key=mkt%3Acall-records%3Av1');
  assert.equal(calls.items[0].item.phone, '***-****-2222', '가리지 않고 온 번호는 뒤 4자리만 저장');
  assert.equal(calls.items[0].item.memo, '***-****-3344 로 다시 전화', '글 안의 번호도 가림');
  assert.equal(pv.results.find((r) => r.key === 'mkt:call-records:v1').unmaskedPhones, 2);
  const [p3] = await sql`select item from ops_import_items where key = 'mkt:posts:v1' and item->>'id' = 'p3'`;
  assert.equal(p3.item.title, '리뷰 ***-****-8888 문의', '개인정보 키가 아니어도 번호는 가림');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'ops_import.view_pii'`)[0].n, 1);
  // 보관 기간(기본 365일) 지난 전화 기록은 tick 이 삭제, 다른 키는 그대로
  await sql`update ops_import_items set imported_at = now() - interval '400 days'`;
  await tick();
  const left = await sql`select key from ops_import_items group by key order by key`;
  assert.deepEqual(left.map((r) => r.key), ['mkt:call-clicks:first-seen:v1', 'mkt:library:v1', 'mkt:plan-state:v1', 'mkt:posts:v1']);
});
