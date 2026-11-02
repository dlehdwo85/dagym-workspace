// 326차(로컬 11/02 ②: 같은 사진 영상이 27초 또는 250초 초과 — 느린 건은 모두 다른 건과 같은 초에 시작 / ③: 오류 기록에 mkt:render 없음):
// 같은 서버(함수 인스턴스) 안 합성은 한 번에 하나(뒤 건은 기다림) · 남은 시간 안에 차례가 안 오면 시작 횟수를 되돌리고 넘겨 다음 정기 실행이 합성 ·
// 기록(renderLog)에 인스턴스·켜진 지 몇 초·대기·단계별 시간·ffmpeg 속도 · 편 합성 실패는 오류 기록(error_logs 'mkt:render')에도
// (구조 시험 — 운영 함수 메모리 안에서 2건이 같이 안 들어가는 것은 재현 측정(합성 1건 1.3GB)으로, 운영 효과는 운영 기록으로 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { BASE, bootstrap, ensureTls, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
async function upload(name, data) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'image/jpeg', size: data.length, folder: '마케팅/현장 사진', space: 'marketing' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
const photo = (k) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="rgb(${40 * k + 20},120,${210 - 40 * k})"/>${Array.from({ length: 8 }, (_, i) => `<circle cx="${100 + i * 200}" cy="${200 + (i % 3) * 350}" r="90" fill="#fff" opacity="0.6"/>`).join('')}</svg>`)).jpeg({ quality: 80 }).toBuffer();
async function content(kind = 'reels') {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by)
    values ('default', ${P.brand}, ${`합성 차례 ${kind} ${Math.random().toString(36).slice(2, 6)}`}, 'instagram', ${kind}, 'pending', 1, ${ctx.ownerId}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${c.id}, 1, '아침 7시, 문을 열면 가장 먼저 반겨 주는 곳.\n깨끗한 운동 공간에서 하루를 시작하세요.\n상담은 전화로 편하게 받습니다.', ${[]}, ${ctx.ownerId})`;
  return c.id;
}
const row = async (id) => (await sql`select status, error, result from mkt_briefs where id = ${id}`)[0];
const last = (r) => r.result.renderLog[r.result.renderLog.length - 1];
const slideshow = (contentId) => ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId, photoIds: P.photos });

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '차례짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { headline: '오늘도 차례' }, facts: { phone: '1600-5678' } });
  P.photos = []; for (let k = 0; k < 3; k++) P.photos.push(await upload(`현장 ${k + 1}.jpg`, await photo(k)));
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('같은 서버에 2건이 동시에 들어오면 하나는 바로, 하나는 앞 건이 끝난 뒤 합성(둘 다 완성) · 기록: 같은 인스턴스 표시·켜진 지 몇 초·대기 시간·단계별 시간(prep·tts·ffmpeg·save)·ffmpeg 속도', async () => {
  const [a, b] = [await content('reels'), await content('shorts')];
  const [ra, rb] = await Promise.all([slideshow(a), slideshow(b)]);
  const A = await row(ra.briefId), B = await row(rb.briefId);
  assert.equal(A.status, 'review', JSON.stringify(A.result?.variants?.[0]?.renderError ?? A.result?.errors));
  assert.equal(B.status, 'review', JSON.stringify(B.result?.variants?.[0]?.renderError ?? B.result?.errors));
  const la = last(A), lb = last(B);
  assert.match(la.inst, /^[0-9a-f]{8}$/); assert.equal(la.inst, lb.inst, '같은 서버 프로세스');
  assert.ok(typeof la.up === 'number' && la.up >= 0 && lb.up >= la.up - 1, '켜진 지 몇 초');
  const first = [la, lb].find((l) => l.busy === false), second = [la, lb].find((l) => l.busy === true);
  assert.ok(first && second, `하나는 바로, 하나는 대기 ${JSON.stringify([la, lb])}`);
  assert.ok(second.wait >= 300 && second.wait < 120e3, `뒤 건은 앞 건이 끝날 때까지 기다림 ${second.wait}`); assert.equal(first.wait, undefined);
  for (const l of [la, lb]) {
    assert.ok(l.steps && l.steps.prep >= 0 && l.steps.tts >= 0 && l.steps.ffmpeg > 0 && l.steps.save >= 0, `단계별 시간 ${JSON.stringify(l.steps)}`);
    assert.ok(typeof l.speed === 'number' && l.speed > 0, `ffmpeg 속도 ${l.speed}`); assert.equal(l.skipped, undefined); assert.ok(typeof l.ms === 'number' && l.ms >= l.steps.ffmpeg);
  }
  assert.deepEqual([A.result.renderTries, B.result.renderTries], [1, 1]);
});

test('남은 시간(예산 − 120초) 안에 차례가 안 오면 시작 횟수를 되돌리고 넘김(renderAt 비움·기록에 사유) → 다음 정기 실행이 그 건을 합성', async () => {
  srv.proc.kill(); srv = await startServer({ VIDEO_RENDER_BUDGET_MS: '122000' }); // 기다리는 시간 = 122 − 120 = 2초
  const [a, b] = [await content('reels'), await content('shorts')];
  const [ra, rb] = await Promise.all([slideshow(a), slideshow(b)]);
  const rows = [await row(ra.briefId), await row(rb.briefId)];
  const done = rows.find((r) => r.status === 'review'), held = rows.find((r) => r.status === 'generating');
  assert.ok(done && held, `하나는 완성, 하나는 넘김 ${JSON.stringify(rows.map((r) => [r.status, last(r)]))}`);
  const lh = last(held);
  assert.match(lh.skipped, /차례가 안 와 넘김 — 다음 정기 실행에서/); assert.equal(lh.busy, true); assert.ok(lh.wait >= 1500 && lh.wait < 15e3, String(lh.wait));
  assert.equal(held.result.renderTries, 0, '시작 횟수 되돌림'); assert.ok(held.result.renderAt == null, '바로 다음 정기 실행이 집어 갈 수 있게(renderAt 지움)'); assert.equal(held.result.stage, 'render');
  assert.equal(last(done).busy, false);
  const t = await tick();
  assert.deepEqual(t.detail.mktRender, { kicked: 1, stale: 0 }, '넘긴 건만 대기열에');
  const again = await row(held === rows[0] ? ra.briefId : rb.briefId);
  assert.equal(again.status, 'review', JSON.stringify(again.result?.variants?.[0]?.renderError ?? again.result?.errors));
  assert.equal(again.result.renderTries, 1); assert.equal(again.result.renderLog.length, 2); assert.equal(last(again).busy, false); assert.ok(last(again).steps?.ffmpeg > 0);
});

test('편 합성이 실패하면(원본 파일 없음) 오류 기록 error_logs 에 mkt:render(의뢰·편·몇 번째 시작·단계)로 남고 · 두 번째 시작에서 실패 처리', async () => {
  const c = await content('reels');
  const result = { provider: 'slideshow', pipeline: 'v2', model: null, stage: 'render', errors: [], notes: [], mediaIds: [], reuse: { slideshow: true, photos: [] },
    variants: [{ n: 0, scenes: [{ k: 0, seconds: 3, line: '시험 자막', visualEn: '', screen: null, status: 'completed', tries: 0, key: 'render/none/missing-326.jpg', still: true }] }] };
  const [b] = await sql`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, status, prompt, content_id, est_credits, result, created_by, mode)
    values ('default', ${P.brand}, 'instagram', 'reels', 'awareness', '시험', ${sql.json({ slideshow: true })}, null, 1, 'generating', ${sql.json({ caption: '시험', source: 'slideshow' })}, ${c}, 0, ${sql.json(result)}, ${ctx.ownerId}, 'content') returning id`;
  assert.equal((await tick()).detail.mktRender.kicked, 1);
  const r1 = await row(b.id);
  assert.equal(r1.status, 'generating', '첫 실패는 한 번 더'); assert.equal(r1.result.variants[0].renderTries, 1); assert.ok(r1.result.variants[0].renderError, '편에 실패 사유');
  assert.ok(last(r1).inst && typeof last(r1).steps === 'object', JSON.stringify(last(r1)));
  const logs = await sql`select message, context from error_logs where source = 'mkt:render' and context->>'briefId' = ${b.id}`;
  assert.equal(logs.length, 1, '오류 기록 1건');
  assert.equal(logs[0].context.variant, 0); assert.equal(logs[0].context.tries, 1); assert.equal(logs[0].context.start, 1); assert.equal(logs[0].context.inst, last(r1).inst); assert.equal(logs[0].message, r1.result.variants[0].renderError);
  assert.equal((await tick()).detail.mktRender.kicked, 1, 'renderAt 이 비어 바로 다음 차례');
  const r2 = await row(b.id);
  assert.equal(r2.status, 'failed'); assert.match(r2.error, /^합성 실패: /); assert.equal(r2.result.stage, 'failed');
  assert.equal((await sql`select count(*)::int as n from error_logs where source = 'mkt:render' and context->>'briefId' = ${b.id}`)[0].n, 2, '두 번째 실패도 기록');
});
