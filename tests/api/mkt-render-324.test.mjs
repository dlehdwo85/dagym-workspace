// 324차(로컬 11/02 멈춘 영상 의뢰 2건·30~60분 지연): 합성 대기열 — 한 번에 4건, 시도 횟수 적은 것·먼저 만든 것 순 · 시작 횟수(renderTries)·시작 기록(renderLog)
// · 8번 넘게 시작해도 못 끝내면 사유 적고 실패 · 만든 지 2시간 넘게 끝나지 않으면 실패 처리(글의 '만드는 중' 풀림) · 실패 사유는 error 칸과 result.errors 양쪽에
// (구조 시험 — 운영 Vercel 함수의 '의뢰 직후 호출' 기록(kickAt·kickStatus)은 운영 행에서 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, ensureTls, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
async function content(kind = 'reels') {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by)
    values ('default', ${P.brand}, ${`합성 대기열 ${kind} 시험`}, 'instagram', ${kind}, 'pending', 1, ${ctx.ownerId}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${c.id}, 1, '합성 대기열 시험 글입니다.\n두 번째 줄.', ${[]}, ${ctx.ownerId})`;
  return c.id;
}
/** 합성 단계(stage render)의 사진 영상 의뢰 — variants 에 error 를 주면 합성 없이 바로 마무리(실패)로 감 */
async function brief(contentId, { tries = null, variants = [{ n: 0, error: '시험용 실패', scenes: [] }], agoHours = 0 } = {}) {
  const result = { provider: 'slideshow', pipeline: 'v2', model: null, stage: 'render', variants, errors: [], notes: [], mediaIds: [], reuse: { slideshow: true, photos: [] }, ...(tries === null ? {} : { renderTries: tries }) };
  const [b] = await sql`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, status, prompt, content_id, est_credits, result, created_by, mode)
    values ('default', ${P.brand}, 'instagram', 'reels', 'awareness', '시험', ${sql.json({ slideshow: true })}, null, 1, 'generating', ${sql.json({ caption: '시험', source: 'slideshow' })}, ${contentId}, 0, ${sql.json(result)}, ${ctx.ownerId}, 'content') returning id`;
  if (agoHours) await sql`update mkt_briefs set created_at = now() - make_interval(hours => ${agoHours}), updated_at = now() - make_interval(hours => ${agoHours}) where id = ${b.id}`;
  return b.id;
}
const row = async (id) => (await sql`select status, error, result from mkt_briefs where id = ${id}`)[0];
const msg = (r) => String(r.body?.error?.message ?? r.body?.message ?? JSON.stringify(r.body));

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '대기열짐' })).id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('대기열: 한 번에 4건 · 시도 횟수 적은 것부터(0번 → 3번 → 9번) · 시작 횟수·기록 남김 · 8번 넘게 시작한 의뢰는 사유 적고 실패 · 실패 사유 error 칸 + result.errors', async () => {
  const c = await content();
  const over = await brief(c, { tries: 9 });            // 9번 시작했는데도 아직 합성 단계
  const some = await brief(c, { tries: 3 });
  const fresh = []; for (let k = 0; k < 4; k++) fresh.push(await brief(c));
  const t1 = await tick();
  assert.deepEqual(t1.detail.mktRender, { kicked: 4, stale: 0 }, '한 번에 4건');
  for (const id of fresh) { const r = await row(id); assert.equal(r.status, 'failed', '0번짜리 4건이 먼저'); assert.equal(r.error, '시험용 실패'); assert.ok(r.result.errors.includes('시험용 실패'), 'result.errors 에도'); assert.equal(r.result.renderTries, 1); assert.equal(r.result.renderLog.length, 1); assert.ok(typeof r.result.renderLog[0].ms === 'number'); assert.equal(r.result.renderAt, null); }
  assert.deepEqual([(await row(some)).status, (await row(over)).status], ['generating', 'generating'], '3번·9번짜리는 다음 차례');
  const t2 = await tick();
  assert.deepEqual(t2.detail.mktRender, { kicked: 2, stale: 0 });
  const s = await row(some); assert.deepEqual([s.status, s.error, s.result.renderTries], ['failed', '시험용 실패', 4]);
  const o = await row(over); assert.equal(o.status, 'failed'); assert.match(o.error, /^합성을 9번 시작했지만 끝내지 못해 멈춤 처리/); assert.equal(o.result.stage, 'failed'); assert.ok(o.result.errors.some((x) => x.startsWith('합성을 9번')));
  assert.deepEqual((await tick()).detail.mktRender, { kicked: 0, stale: 0 }, '남은 것 없음');
});

test('만든 지 2시간 넘게 합성이 끝나지 않은 의뢰는 정기 실행이 사유 적고 실패 처리 → 글의 "이미 만드는 중"이 풀려 다시 의뢰할 수 있음 · 방금 만든 의뢰는 그대로', async () => {
  const c = await content('shorts');
  const old = await brief(c, { variants: [{ n: 0, scenes: [] }], agoHours: 3 });
  const before = await ctx.owner.req('POST', '/api/marketing/studio/slideshow', { contentId: c });
  assert.equal(before.status, 400); assert.match(msg(before), /이미 만드는 중/);
  const t = await tick();
  assert.equal(t.detail.mktRender.stale, 1, '오래된 1건 정리');
  const r = await row(old);
  assert.equal(r.status, 'failed'); assert.match(r.error, /^합성이 2시간 넘게 끝나지 않아 멈춤 처리\(시작 0번\)/); assert.equal(r.result.stage, 'failed'); assert.ok(r.result.errors.some((x) => x.startsWith('합성이 2시간')));
  const again = await ctx.owner.req('POST', '/api/marketing/studio/slideshow', { contentId: c });
  // 398차 #1024: 사진이 없어도 그래픽 카드로 만든다 — 막힘이 풀리면 새 의뢰가 시작되거나(200), 대본이 모자라면 '영상 대본 미달'(400)
  assert.doesNotMatch(msg(again), /이미 만드는 중/, '막힘이 풀림'); assert.ok(again.status === 200 || /영상 대본 미달/.test(msg(again)), `${again.status} ${msg(again)}`);
  await sql`update mkt_briefs set status = 'failed' where content_id = ${c} and status = 'generating'`; // 새로 시작된 의뢰의 합성은 이 시험 범위 밖
  // 방금 만든 의뢰(합성 단계)는 정리 대상이 아니고 대기열로 감
  const c2 = await content(); const now = await brief(c2);
  const t2 = await tick(); assert.deepEqual(t2.detail.mktRender, { kicked: 1, stale: 0 }); assert.equal((await row(now)).status, 'failed'); assert.equal((await row(now)).error, '시험용 실패');
});
