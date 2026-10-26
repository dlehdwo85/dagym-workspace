// 172차(로컬 10/26 ①): 올리기 전 자동 검사에 걸리면(스토리 문구 3줄·블로그 길이 미달 …) 걸린 줄을 알려 주고 1번 다시 쓴 뒤 다시 검사 —
// 덜 걸리면 그 원고로 승인함, 그래도 같으면 첫 원고 그대로 '수정 요청'. 시험 서버 기본은 끔(MKT_PREFLIGHT_RETRY=0) → 이 파일만 켜고 돌림
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const FRAMES = [{ title: '요즘 운동 시작하셨나요?', body: '' }, { title: '아침 30분이면 충분해요', body: '기구 안내부터' }, { title: '궁금하면 물어보세요', body: '문의 032-111-2222' }];
const story = (body) => say({ title: '운동 시작했나요', body, brief: '', why: '', hooks: [], keyword: '송도', card: CARD, frames: FRAMES });
const THREE = '첫째 줄입니다.\n둘째 줄입니다.\n셋째 줄입니다.\n스티커 제안: 투표 — 아침 / 저녁'; // 스토리 문구 3줄 → 검사에 걸림
const TWO = '요즘 운동 시작하셨나요?\n스티커 제안: 투표 — 아침 / 저녁';
async function slot(title) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${P.brand}, ${title}, 'instagram', ${new Date(Date.now() + 2 * 86400e3)}, 'draft', 0, ${ctx.ownerId}, 'story', true, now(), false, ${[]}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.quality, v.body, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const text = (req) => JSON.stringify(req.body.messages); // fake-google 은 { key, beta, body } 로 기록

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ MKT_PREFLIGHT_RETRY: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '재작성브랜드' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '송도 동네 헬스장', products: '1개월 회원권, 처음 상담', facts: { phone: '032-111-2222' } });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('검사에 걸린 스토리(문구 3줄) → 걸린 줄을 알려 주고 1번 다시 씀 → 통과하면 그 원고로 승인 대기 · 노트·quality.preflightRetry', async () => {
  const id = await slot('재작성브랜드 스토리 1');
  const n0 = fake.state.anthropic.length;
  await ctl({ anthropicReset: true, anthropicQueue: [story(THREE), story(TWO)] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === id && !p.error), JSON.stringify(run.produced));
  const c = await cur(id);
  assert.equal(c.status, 'pending', JSON.stringify(c.quality));
  assert.match(c.body, /^요즘 운동 시작하셨나요\?/, '다시 쓴 원고로');
  assert.deepEqual(c.quality.preflightRetry, ['스토리 문구 3줄 — 1~2줄'], JSON.stringify(c.quality));
  assert.ok(!c.quality.issues.some((x) => /스토리 문구/.test(x)), JSON.stringify(c.quality.issues));
  assert.match(c.note, /검사에 걸려 1번 다시 씀\(스토리 문구 3줄 — 1~2줄\)/, c.note);
  assert.equal(fake.state.anthropic.length - n0, 2, '원고 2번(처음 + 다시 쓰기)');
  const again = text(fake.state.anthropic[n0 + 1]);
  assert.ok(again.includes('[수정 요청]') && again.includes('스토리 문구 3줄 — 1~2줄') && again.includes('첫째 줄입니다.'), '다시 쓰기 요청에 지난 원고·걸린 줄이 들어감');
});

test('다시 써도 같은 줄에 걸리면 첫 원고 그대로 수정 요청(2번만 쓰고 멈춤)', async () => {
  const id = await slot('재작성브랜드 스토리 2');
  const n0 = fake.state.anthropic.length;
  await ctl({ anthropicReset: true, anthropicQueue: [story(THREE), story('넷째 줄까지 길게 씁니다.\n둘째 줄입니다.\n셋째 줄입니다.\n스티커 제안: 질문 — 운동 고민')] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  assert.equal(c.status, 'changes', JSON.stringify(c.quality));
  assert.ok(c.quality.issues.some((x) => x === '스토리 문구 3줄 — 1~2줄'), JSON.stringify(c.quality.issues));
  assert.match(c.body, /^첫째 줄입니다\./, '첫 원고 그대로');
  assert.equal(c.quality.preflightRetry, undefined);
  assert.doesNotMatch(c.note, /다시 씀/);
  assert.equal(fake.state.anthropic.length - n0, 2);
});
