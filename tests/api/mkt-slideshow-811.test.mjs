// 271차 #811(대표 10/29 '마케팅 AI 영상 제작 비용 최소화'): 릴스·쇼츠를 자료실 실제 사진으로 — 사진 3~8장을 천천히 움직여 자막·끝 화면과 합성(서버 ffmpeg), 생성 비용 0
// (구조 시험 — 운영 서버에서 걸리는 시간·화질은 운영 확인 필요)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
async function upload(name, data) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'image/jpeg', size: data.length, folder: '마케팅/현장 사진', space: 'marketing' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
// 무늬 있는 사진(움직임이 화면에서 보이게)
const photo = (k) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="rgb(${30 * k},140,${200 - 30 * k})"/>${Array.from({ length: 8 }, (_, i) => `<circle cx="${100 + i * 200}" cy="${200 + (i % 3) * 350}" r="90" fill="#fff" opacity="0.6"/>`).join('')}</svg>`)).jpeg({ quality: 80 }).toBuffer();
async function probe(fileId) {
  const [f] = await sql`select storage_key from library_files where id = ${fileId}`;
  const r = spawnSync(FF, ['-hide_banner', '-i', join(tmpdir(), 'workos-test', 'uploads', f.storage_key)], { encoding: 'utf8' });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr); const v = /Video:[^\n]*?(\d{3,4})x(\d{3,4})/.exec(r.stderr);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, w: v ? +v[1] : null, h: v ? +v[2] : null };
}
async function content(kind, body = '아침 7시, 문을 열면 가장 먼저 반겨 주는 곳.\n깨끗한 운동 공간에서 하루를 시작하세요.\n상담은 전화로 편하게 받습니다.\n#다짐') {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by)
    values ('default', ${P.brand}, ${`다짐 ${kind} 시험`}, 'instagram', ${kind}, 'pending', 1, ${ctx.ownerId}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${c.id}, 1, ${body}, ${[]}, ${ctx.ownerId})`;
  return c.id;
}

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { headline: '오늘도 다짐' }, facts: { phone: '1600-5678' } });
  P.photos = []; for (let k = 0; k < 6; k++) P.photos.push(await upload(`현장 ${k + 1}.jpg`, await photo(k)));
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('릴스 글 → [실제 사진으로 영상 만들기] = 사진 6장(약 15초) → 세로 영상 새 버전(자막·끝 화면 전화) · 생성 비용 0(크레딧 원장 없음) · 관리자만 · 릴스·쇼츠만 · 사진 3장 미만은 안 됨', async () => {
  const id = await content('reels');
  assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/marketing/studio/slideshow', { contentId: id, photoIds: P.photos })).status), '관리자만');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/studio/slideshow', { contentId: await content('feed'), photoIds: P.photos })).status, 400, '피드 글은 안 됨');
  const t0 = Date.now();
  const r = await ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId: id, photoIds: P.photos });
  const ms = Date.now() - t0;
  assert.deepEqual([r.photos, r.seconds], [6, 16]);
  const [b] = await sql`select status, est_credits, result from mkt_briefs where id = ${r.briefId}`;
  assert.equal(b.status, 'review', JSON.stringify(b.result?.variants?.[0]?.renderError ?? b.result?.errors));
  assert.equal(Number(b.est_credits), 0);
  const [c] = await sql`select current_version from mkt_contents where id = ${id}`;
  assert.equal(c.current_version, 2, '새 버전');
  const [v] = await sql`select media_ids, note from mkt_versions where content_id = ${id} and version = 2`;
  assert.match(v.note, /^실제 사진 6장으로 만든 영상\(생성 비용 0\) · 자막·끝 화면 전화/);
  const [lf] = await sql`select file_name, tags from library_files where id = ${v.media_ids[0]}`;
  assert.match(lf.file_name, /\(실제 사진\)\.mp4$/); assert.ok(lf.tags.includes('실제 사진') && !lf.tags.includes('AI 생성') && !lf.tags.includes('다시 합성'), lf.tags.join(','));
  const p = await probe(v.media_ids[0]);
  assert.deepEqual([p.w, p.h], [1080, 1920], '세로 영상');
  assert.ok(p.duration > 13 && p.duration < 19, `길이 ${p.duration}초`);
  assert.equal((await sql`select count(*)::int n from mkt_credit_ledger where content_id = ${id}`)[0].n, 0, '생성 비용 없음');
  console.log(`# 사진 6장 ${p.duration}초 영상 합성 ${Math.round(ms / 100) / 10}초(시험 서버, 내레이션 없음)`);
  // 사진이 2장뿐이면 안 됨
  assert.equal((await ctx.owner.req('POST', '/api/marketing/studio/slideshow', { contentId: await content('shorts'), photoIds: P.photos.slice(0, 2) })).status, 400);
});

test('사진을 고르지 않으면 이 글에 맞는 자료실 실사를 골라 씀', async () => {
  const id = await content('shorts');
  const r = await ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId: id });
  assert.ok(r.photos >= 3 && r.photos <= 6, String(r.photos));
  const [b] = await sql`select status, result from mkt_briefs where id = ${r.briefId}`;
  assert.equal(b.status, 'review');
  assert.ok(b.result.reuse.photos.every((x) => P.photos.includes(x)), '자료실 실사');
});

test('자동 제작: 브랜드 영상 방법 = 실제 사진 → 릴스 원고 직후 그 판(v1)에 사진 영상(새 판 없음) · 영상 제작 요청 카드는 대신함 · 생성 비용 0 · 앱 화면 녹화 = 카드 예상 0', async () => {
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { method: 'photos' } })).status, 403, '관리자만');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { method: 'photos' } });
  const [bk] = await sql`select video from mkt_brands where id = ${P.brand}`;
  assert.deepEqual([bk.video.method, bk.video.headline], ['photos', '오늘도 다짐'], '다른 영상 키트 칸은 그대로');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { videoPause: false, leadDays: 3, quietStart: 0, quietEnd: 0 });
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'reels', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '12:00', topicHint: '아침 운동' });
  const slots = await sql`select id from mkt_contents where rule_id = ${r.id} order by scheduled_at`;
  assert.ok(slots.length >= 2, String(slots.length));
  const only = async (id) => { await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${r.id} and produced_at is null`; await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${id}`; };
  const body = '아침 7시, 문을 열면 가장 먼저 반겨 주는 곳.\n깨끗한 운동 공간에서 하루를 시작하세요.\n상담은 전화로 편하게 받습니다.';
  const draft = say({ title: '아침 운동은 다짐에서', body, brief: '현장 실사', script: ['아침 7시 문 여는 다짐', '깨끗한 운동 공간', '상담은 전화로 편하게'] });
  await only(slots[0].id);
  await ctl({ anthropicReset: true, anthropicQueue: [draft, draft] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === slots[0].id), JSON.stringify(run.produced));
  const [c] = await sql`select status, current_version, quality from mkt_contents where id = ${slots[0].id}`;
  assert.equal(c.current_version, 1, '새 판 없이 원고 판에');
  const [v] = await sql`select media_ids, note from mkt_versions where content_id = ${slots[0].id} and version = 1`;
  assert.equal(v.media_ids.length, 1, v.note);
  assert.match(v.note, /^AI 자동 제작.* · 실제 사진 [3-6]장으로 만든 영상\(생성 비용 0\)/);
  const issues = c.quality.issues ?? [];
  assert.ok(!issues.some((x) => /영상 시안 제작 중/.test(x)), JSON.stringify(issues));
  assert.equal(c.status, issues.length ? 'changes' : 'pending', JSON.stringify(c.quality));
  const [q] = await sql`select status, brief from mkt_production_requests where content_id = ${slots[0].id} and kind = 'video'`;
  assert.equal(q.status, 'done'); assert.match(q.brief, /실제 사진 영상으로 대신함\(생성 비용 0\)$/);
  assert.equal((await sql`select count(*)::int n from mkt_credit_ledger where content_id = ${slots[0].id} and kind = 'generate_video'`)[0].n, 0, '생성 비용 없음');
  const p = await probe(v.media_ids[0]); assert.deepEqual([p.w, p.h], [1080, 1920]);
  // 앱 화면 녹화: 사진 영상을 만들지 않고 녹화 파일을 붙이는 카드(예상 크레딧 0)
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { method: 'screen' } });
  await only(slots[1].id);
  await ctl({ anthropicReset: true, anthropicQueue: [draft, draft] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const [q2] = await sql`select status, brief, est_credits from mkt_production_requests where content_id = ${slots[1].id} and kind = 'video'`;
  assert.ok(q2 && ['open', 'needs_approval'].includes(q2.status), JSON.stringify(q2));
  assert.equal(Number(q2.est_credits), 0); assert.match(q2.brief, /^앱 화면 녹화로 만듭니다\(생성 비용 0\)/);
  assert.equal((await sql`select count(*)::int n from mkt_briefs where content_id = ${slots[1].id}`)[0].n, 0, '사진 영상 안 만듦');
  await sql`update mkt_rules set active = false where id = ${r.id}`;
});
