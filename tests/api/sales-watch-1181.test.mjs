// #1181 상업화 마감 3번(설계 A, DB 290): 내 수집 원천(게시판·RSS) — 안전 장치 먼저
// ① 내부 주소·메타데이터·다른 포트·ftp·아이디 든 주소는 등록 못 함 ② 사이트가 수집을 막으면(robots.txt) 등록 못 함
// ③ 리다이렉트로 내부 주소에 가면 받지 않음(실패 기록) ④ 게시판: 게시일 있는 최근 30일 글만 · 찾을 낱말 · RSS 항목
// ⑤ 글 → 업무 · 직원은 못 넣음(403) · 다른 회사는 못 봄 — 구조 시험(가짜 게시판 서버)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3304; const BASEX = `http://localhost:${PORT}`;
let srv, ctx, sql, fake;
const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const board = () => `<html><body><table>
<tr><td><a href="/post/1">협회 회원사 모집 안내</a></td><td>${ymd(0)}</td></tr>
<tr><td><a href="/post/2">홈페이지 유지보수 업체 모집</a></td><td>${ymd(-1).replace(/-/g, '.')}</td></tr>
<tr><td><a href="/post/3">오래된 모집 공지</a></td><td>${ymd(-60)}</td></tr>
<tr><td><a href="/menu">회사소개</a></td><td></td></tr></table></body></html>`;
const rss = () => `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>RSS 새 소식 하나</title><link>${BASEX}/r/1</link><pubDate>${new Date().toUTCString()}</pubDate></item>
<item><title><![CDATA[RSS 새 소식 둘]]></title><link>${BASEX}/r/2</link></item></channel></rss>`;

// 로컬 11/26(행안부 보도자료 RSS = 본문까지 실어 1MB 넘음): 앞부분만 받아 끝이 온전한 항목만 읽음
const bigRss = () => `<?xml version="1.0"?><rss version="2.0"><channel><title>big</title>${Array.from({ length: 40 }, (_, i) => `<item><title>큰 피드 글 ${i + 1}</title><link>${BASEX}/big/${i + 1}</link><pubDate>${new Date().toUTCString()}</pubDate><description><![CDATA[${'본문'.repeat(20_000)}]]></description></item>`).join('')}</channel></rss>`;
before(async () => {
  fake = http.createServer((req, res) => {
    const send = (code, body, type = 'text/html; charset=utf-8', headers = {}) => { res.writeHead(code, { 'content-type': type, ...headers }); res.end(body); };
    if (req.url === '/robots.txt') return send(200, 'User-agent: *\nDisallow: /secret/\n', 'text/plain');
    if (req.url === '/board') return send(200, board());
    if (req.url === '/feed') return send(200, rss(), 'application/rss+xml');
    if (req.url === '/bigfeed') return send(200, bigRss(), 'application/rss+xml');
    if (req.url === '/hop') return send(302, '', 'text/plain', { location: 'http://127.0.0.1:5432/' });
    return send(404, 'no');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: BASEX }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('안전 장치: 내부 주소·포트·ftp·아이디 주소·수집 금지 사이트는 등록 못 함 · 리다이렉트로 내부 주소는 받지 않음', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1/admin', 'http://localhost:3399/x', 'http://10.0.0.5/', 'http://[::1]/', 'ftp://example.com/file', 'http://user:pw@example.com/']) {
    const r = await ctx.owner.req('POST', '/api/sales/watch', { label: '막힘', url });
    assert.equal(r.status, 400, `${url} → ${r.status} ${JSON.stringify(r.body)}`);
  }
  const rb = await ctx.owner.req('POST', '/api/sales/watch', { label: '금지', url: `${BASEX}/secret/list` });
  assert.equal(rb.status, 400); assert.equal(rb.body.error.code, 'robots_blocked');
  const hop = await ctx.owner.ok('POST', '/api/sales/watch', { label: '넘김', url: `${BASEX}/hop` });
  const [h] = await sql`select status, fail_count, last_error from sales_watch_sources where id = ${hop.id}`;
  assert.equal(h.fail_count, 1, '내부 주소로 넘어가면 받지 않고 실패로'); assert.match(h.last_error, /포트|내부/);
  assert.equal((await sql`select count(*)::int n from sales_watch_items where source_id = ${hop.id}`)[0].n, 0);
  await ctx.owner.ok('DELETE', `/api/sales/watch/${hop.id}`);
});

test('게시판·RSS 글 모으기 · 찾을 낱말 · 30일 · 글 → 업무 · 직원 403 · 다른 회사 못 봄', async () => {
  const b = await ctx.owner.ok('POST', '/api/sales/watch', { label: '협회 게시판', url: `${BASEX}/board`, words: ['모집'] });
  assert.equal(b.check.status, 'ok'); assert.equal(b.check.added, 2, '최근 30일·게시일 있는 글 중 낱말 든 2건(오래된 글·메뉴 링크 뺌)');
  const f = await ctx.owner.ok('POST', '/api/sales/watch', { label: '소식 RSS', url: `${BASEX}/feed` });
  assert.equal(f.check.added, 2, 'RSS 항목 2건');
  const again = await ctx.owner.ok('POST', `/api/sales/watch/${b.id}`, { action: 'check' });
  assert.equal(again.added, 0, '같은 글은 다시 안 넣음');
  const v = await ctx.owner.ok('GET', '/api/sales/watch');
  assert.deepEqual(v.sources.map((s) => [s.label, s.statusLabel, s.items]), [['협회 게시판', '연결됨', 2], ['소식 RSS', '연결됨', 2]]);
  const titles = v.items.map((i) => i.title).sort();
  assert.deepEqual(titles, ['RSS 새 소식 둘', 'RSS 새 소식 하나', '협회 회원사 모집 안내', '홈페이지 유지보수 업체 모집']);
  const it = v.items.find((i) => i.title === '홈페이지 유지보수 업체 모집');
  assert.equal(it.url, `${BASEX}/post/2`);
  const t = await ctx.owner.ok('POST', `/api/sales/watch/${b.id}`, { action: 'task', itemId: it.id });
  const [task] = await sql`select title, space, description from tasks where id = ${t.taskId}`;
  assert.equal(task.title, '홈페이지 유지보수 업체 모집'); assert.equal(task.space, 'sales'); assert.match(task.description, /\/post\/2/);
  assert.equal((await ctx.owner.ok('POST', `/api/sales/watch/${b.id}`, { action: 'task', itemId: it.id })).already, true, '두 번 만들지 않음');
  // 직원은 못 넣음 · 다른 회사는 못 봄
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/watch', { label: 'x', url: `${BASEX}/board` })).status, 403);
  assert.equal((await ctx.staffA.client.req('GET', '/api/sales/watch')).status, 200, '영업 공간 직원은 볼 수 있음');
  const [{ tenant: other }] = await sql`select id as tenant from tenants where id <> 'default' limit 1`.catch(() => [{ tenant: null }]);
  if (other) assert.equal((await sql`select count(*)::int n from sales_watch_items where tenant = ${other}`)[0].n, 0, '다른 회사 표에는 없음');
});

test('1MB 넘는 RSS(본문을 실은 공공기관 목록)는 앞부분만 받아 끝이 온전한 글만 넣음(로컬 11/26)', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/watch', { label: '큰 피드', url: `${BASEX}/bigfeed` });
  assert.equal(r.check.status, 'ok', JSON.stringify(r.check));
  assert.ok(r.check.added >= 5 && r.check.added < 40, `앞부분 글만 ${r.check.added}건`);
  const [s] = await sql`select status, last_error from sales_watch_sources where id = ${r.id}`; assert.equal(s.last_error, null);
  const titles = (await sql`select title from sales_watch_items where source_id = ${r.id} order by title`).map((x) => x.title);
  assert.ok(titles.includes('큰 피드 글 1') && titles.every((t) => /^큰 피드 글 \d+$/.test(t)), titles.slice(0, 3).join(','));
  await ctx.owner.ok('DELETE', `/api/sales/watch/${r.id}`);
});
