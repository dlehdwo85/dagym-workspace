// 312차 #867(대표 11/01 '페이지별 홍보 목표', PAGE_GOALS_867 §2): 브랜드 '페이지별 주제' — 주마다 한 페이지를 돌아가며 그 페이지 주제로 쓰고
// 글 끝에 그 페이지 링크(+utm: 채널·페이지·글) · 인스타그램은 링크 줄 없음 · 같은 날 묶음은 같은 주제 · 수정본도 링크 한 줄(겹치지 않음) · 비우면 예전처럼 주제 풀
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const draft = (t) => say({ title: t, body: '업무가 메신저에 흩어지면 놓치기 쉽습니다.\n한 줄로 적고 담당을 정해 보세요.', brief: '화면', why: '', hooks: [], keyword: '업무', card: CARD,
  slides: [{ role: 'cover', title: t, body: '' }, { role: 'problem', title: '놓치는 업무', body: '메신저에 흩어짐' }, { role: 'solution', title: '한 줄 등록', body: '담당·마감' }, { role: 'proof', title: '알림', body: '마감 전' }, { role: 'cta', title: '저장해 두세요', body: '' }] });
const PAGES = [
  { url: 'https://www.example.com/landing/task-management', topics: ['한 줄로 업무 등록하기', '마감 전에 알림 받기'] },
  { url: 'https://www.example.com/landing/bid-collection', topics: ['입찰 공고를 매일 아침 한 번에'] },
];
const DAY = 864e5;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const weekNo = (day) => Math.floor((Date.parse(`${day}T00:00:00+09:00`) - Date.parse('2026-01-05T00:00:00+09:00')) / (7 * DAY));
async function slot(title, channel, days, hm = '11:00') {
  const day = ymd(new Date(Date.now() + days * DAY));
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${P.brand}, ${title}, ${channel}, ${new Date(`${day}T${hm}:00+09:00`)}, 'draft', 0, ${ctx.ownerId}, 'feed', true, now(), false, ${[]}, 'content') returning id`;
  return { id: c.id, day };
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.rationale, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const run = async (n) => { await ctl({ anthropicReset: true, anthropicQueue: Array.from({ length: n }, () => draft('업무를 놓치지 않는 법')) }); return ctx.owner.ok('POST', '/api/marketing/auto/run', {}); };

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, plainFill: true });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '페이지짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '업무 관리 서비스', products: '업무·일정', topicPool: ['주제 풀 주제(페이지가 있으면 안 씀)'] });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('브랜드 키트: 페이지별 주제 저장(주소 → 페이지 이름) · 관리자만 · 주소 형식·주제 없음은 400 · 설정 화면에 보임', async () => {
  assert.ok([403, 404].includes((await ctx.staffA.client.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { pageRotation: PAGES })).status), '관리자만(마케팅 공간 밖 직원은 404)');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { pageRotation: [{ url: 'example.com/x', topics: ['a'] }] })).status, 400, '주소 형식');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { pageRotation: [{ url: 'https://www.example.com/x', topics: [] }] })).status, 400, '주제 없음');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { pageRotation: PAGES });
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  const b = v.brands.find((x) => x.id === P.brand);
  assert.deepEqual(b.page_rotation.map((r) => [r.key, r.url, r.topics.length]), [['task-management', PAGES[0].url, 2], ['bid-collection', PAGES[1].url, 1]]);
});

test('제작: 그 주 페이지의 주제로 · 페이스북은 끝에 페이지 링크(utm 채널·페이지·글) · 인스타그램은 링크 줄 없음 · 같은 날 묶음은 같은 주제 · 다음 주는 다음 페이지', async () => {
  const fb = await slot('이번 주 페이스북', 'facebook', 4);
  const ig = await slot('이번 주 인스타', 'instagram', 4, '15:00');
  const nx = await slot('다음 주 페이스북', 'facebook', 11);
  const r = await run(12);
  assert.ok([fb, ig, nx].every((s) => r.produced.some((p) => p.id === s.id && !p.error)), JSON.stringify(r.produced));
  const want = (day) => PAGES[weekNo(day) % PAGES.length];
  const keyOf = (u) => u.split('/').pop();
  const f = await cur(fb.id); const g = await cur(ig.id); const n = await cur(nx.id);
  const pf = want(fb.day);
  assert.deepEqual([f.rationale.topicFrom, f.rationale.page], ['page', keyOf(pf.url)]);
  assert.ok(pf.topics.includes(f.rationale.topic), f.rationale.topic);
  assert.ok(f.body.includes(`자세히 보기: ${pf.url}?utm_source=facebook&utm_medium=social&utm_campaign=${keyOf(pf.url)}&utm_content=${fb.id.slice(0, 8)}`), f.body);
  assert.equal(f.body.split('자세히 보기:').length - 1, 1, '링크 한 줄');
  assert.deepEqual([g.rationale.page, g.rationale.topic], [keyOf(pf.url), f.rationale.topic], '같은 날 인스타 = 같은 페이지·같은 주제');
  assert.ok(!g.body.includes('자세히 보기:'), '인스타그램은 링크 줄 없음');
  const pn = want(nx.day);
  assert.notEqual(keyOf(pn.url), keyOf(pf.url), '다음 주는 다음 페이지');
  assert.equal(n.rationale.page, keyOf(pn.url)); assert.ok(n.body.includes(`utm_campaign=${keyOf(pn.url)}`));
  for (const x of [f, g, n]) assert.ok(!/주제 풀 주제/.test(x.rationale.topic), '페이지가 있으면 주제 풀은 안 씀');
  P.fb = fb.id;
});

test('수정 요청 수정본: 같은 페이지 링크 한 줄 그대로(겹치지 않음) · 페이지를 비우면 다음 글은 주제 풀', async () => {
  const before = await cur(P.fb);
  await ctl({ anthropicReset: true, anthropicQueue: Array.from({ length: 6 }, () => draft('업무를 놓치지 않는 법')) });
  await ctx.owner.ok('POST', `/api/marketing/contents/${P.fb}/decide`, { version: before.current_version, decision: 'changes', comment: '첫 문장을 조금 더 짧게 써 주세요' });
  const after = await cur(P.fb);
  assert.ok(after.current_version > before.current_version, '수정본');
  assert.equal(after.body.split('자세히 보기:').length - 1, 1, after.body);
  assert.ok(after.body.includes(`utm_campaign=${before.rationale.page}`));
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { pageRotation: [] });
  const s = await slot('페이지 없는 주', 'facebook', 5);
  await run(6);
  const c = await cur(s.id);
  assert.equal(c.rationale.topicFrom, 'pool'); assert.ok(!c.body.includes('자세히 보기:'));
});
