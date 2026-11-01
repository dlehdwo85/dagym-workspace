// 310차(로컬 11/01 운영 확인 뒤 남은 흠 3개): ① 사진 영상 장면에도 얼굴 가림(자리를 알면 모자이크 사본, 모르면 뺌) ·
// ② 행동 장('저장해 두세요')을 검정 단색 대신 이 글 사진을 흐리고 어둡게 깐 바탕으로 · ③ 블로그·영상 후보에서 얼굴 자리를 모르는 사진은 고르기 전에 빼고
// 얼굴 없는 시설·기구 사진이 먼저 + 같은 브랜드 가까운 영상끼리 같은 장면 사진을 다시 안 씀(아직 영상 파일이 없는 글도)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const fakeState = async () => (await fetch(`${FAKE}/__state`)).json();
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const V = (o) => ({ caption: '매장 안 사진', scene: '매장 안 모습입니다.', tags: ['매장'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
const describe = async (id, answer) => { await ctl({ visionQueue: [answer] }); return ctx.owner.ok('POST', '/api/marketing/photos/describe', { ids: [id], redo: true }); };
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
let nth = 0;
const photo = () => { nth++; return sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 60 + (nth * 37) % 150, g: 110 + (nth * 23) % 100, b: 140 } } }).jpeg().toBuffer(); };
async function libFile(name, vision) {
  const data = await photo();
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source)
    values ('default', 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload') returning id`;
  const key = `lib/default/${f.id}/${f.id}.jpg`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  await describe(f.id, V(vision));
  return f.id;
}
async function slot(brand, title, { channel = 'instagram', kind = 'feed', days = 3 } = {}) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${brand}, ${title}, ${channel}, now() + make_interval(days => ${days}), 'draft', 0, ${ctx.ownerId}, ${kind}, true, now(), false, ${[]}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const briefPhotos = async (id) => (await sql`select result->'reuse'->'photos' as p from mkt_briefs where content_id = ${id} order by created_at desc limit 1`)[0]?.p ?? null;
const origOf = async (ids) => Promise.all(ids.map(async (id) => (await sql`select coalesce(meta->>'of', id::text) as o from library_files where id = ${id}`)[0].o));
const reelsDraft = say({ title: '얼굴짐 아침', body: '아침 7시에 문을 엽니다.', brief: '실사', why: '', hooks: [], keyword: '운동', script: ['아침 7시 문 여는 곳', '기구가 넉넉합니다', '상담은 전화로'] });
const run = async (queue) => { await ctl({ anthropicReset: true, anthropicQueue: queue }); return ctx.owner.ok('POST', '/api/marketing/auto/run', {}); };

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, videoPause: false });
  P.face = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '얼굴짐' })).id;
  P.act = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '행동짐' })).id; // 브랜드 둘 = 이 브랜드 이름이 든 사진만
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.face}`, { intro: '동네 헬스장', products: '회원권', video: { method: 'photos' } });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.act}`, { intro: '동네 헬스장', products: '회원권' });
  P.unk = await libFile('얼굴짐 GX 수업.jpg', { caption: '단체 GX 수업 장면', tags: ['수업'], people: 6, faces: true }); // 얼굴 자리 모름(286차 전 설명)
  P.boxed = await libFile('얼굴짐 상담 데스크.jpg', { caption: '상담 데스크 직원', tags: ['상담'], people: 1, faces: true });
  await sql`update library_files set vision = vision || ${sql.json({ faceBoxes: [{ x: 0.35, y: 0.2, w: 0.3, h: 0.25 }] })} where id = ${P.boxed}`;
  P.eq = [];
  for (let k = 1; k <= 3; k++) P.eq.push(await libFile(`얼굴짐 기구 ${k}.jpg`, { caption: `러닝머신 줄 ${k}`, tags: ['기구'] }));
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('① 사진 영상: 얼굴 자리를 모르는 사진은 장면에서 빠지고 · 자리를 아는 사진은 모자이크 사본으로 · 얼굴 없는 기구 사진이 앞(첫 장면)', async () => {
  const id = await slot(P.face, '얼굴짐 릴스', { kind: 'reels', days: 5 });
  await run([reelsDraft, reelsDraft]);
  const ph = await briefPhotos(id);
  assert.ok(Array.isArray(ph) && ph.length === 4, JSON.stringify(ph));
  assert.ok(!ph.includes(P.unk), '얼굴 자리를 모르는 사진은 장면에 없음');
  assert.ok(!ph.includes(P.boxed), '얼굴 그대로인 원본은 안 씀');
  const [m] = await sql`select id::text, source, meta->>'of' as of from library_files where id = ${ph[ph.length - 1]}`;
  assert.deepEqual([m.source, m.of], ['mosaic', P.boxed], '얼굴 있는 사진은 모자이크 사본 · 맨 뒤');
  assert.ok(P.eq.includes(ph[0]), '첫 장면 = 얼굴 없는 기구 사진');
  P.first = ph;
});

test('③ 같은 브랜드 가까운 영상끼리 같은 장면 사진을 다시 안 씀(앞 영상은 아직 영상 파일 전) — 얼굴 가린 사본을 쓴 원본도 쓴 것으로', async () => {
  for (let k = 4; k <= 6; k++) P.eq.push(await libFile(`얼굴짐 기구 ${k}.jpg`, { caption: `덤벨 선반 ${k}`, tags: ['기구'] }));
  const id = await slot(P.face, '얼굴짐 쇼츠', { kind: 'reels', days: 5 });
  await run([reelsDraft, reelsDraft]);
  const ph = await briefPhotos(id);
  assert.ok(Array.isArray(ph) && ph.length === 3, JSON.stringify(ph));
  const before = new Set(await origOf(P.first)); const now = await origOf(ph);
  assert.deepEqual(now.filter((x) => before.has(x)), [], '앞 영상 장면 사진(원본 기준)과 겹치지 않음');
  assert.notEqual(ph[0], P.first[0], '첫 장면이 같은 사진 아님');
  P.second = ph;
});

test('③ 새 사진이 모자라면(가까운 글에 다 씀) 영상을 멈추지 않고 다시 쓰되 첫 장면은 앞뒤 3일 영상의 첫 장면과 다르게', async () => {
  const id = await slot(P.face, '얼굴짐 릴스 셋째', { kind: 'reels', days: 5 });
  await run([reelsDraft, reelsDraft]);
  const ph = await briefPhotos(id);
  assert.ok(Array.isArray(ph) && ph.length >= 3, `영상 만듦(보류 아님): ${JSON.stringify(ph)} ${(await cur(id))?.note ?? ''}`);
  const firsts = new Set(await origOf([P.first[0], P.second[0]]));
  assert.ok(!firsts.has((await origOf([ph[0]]))[0]), '첫 장면이 앞 영상들 첫 장면과 다름');
  assert.ok(!ph.includes(P.unk) && !ph.includes(P.boxed), '다시 쓸 때도 얼굴 규칙 그대로');
});

test('③ 블로그 본문 후보: 얼굴 자리를 모르는 사진은 원고 AI 에 주는 후보 목록에서부터 빠짐(고른 뒤에 빠져 1장만 남던 것)', async () => {
  for (let k = 7; k <= 9; k++) await libFile(`얼굴짐 시설 ${k}.jpg`, { caption: `탈의실 사물함 ${k}`, tags: ['시설'] });
  const id = await slot(P.face, '얼굴짐 블로그', { channel: 'blog', kind: 'blog', days: 30 });
  const n0 = (await fakeState()).anthropic.length;
  const blog = say({ title: '얼굴짐 처음 오는 분께', body: '처음 오는 분께 알려 드립니다.\n\n[사진 P1]\n\n시설을 소개합니다.', brief: '실사', why: '', hooks: [], keyword: '헬스장', persona: '직장인', subKeywords: ['시설'] });
  await run([blog, blog, blog]);
  const reqs = (await fakeState()).anthropic.slice(n0).map((r) => String(r.body?.messages?.[0]?.content ?? ''));
  const user = reqs.find((u) => /^P1: /m.test(u));
  assert.ok(user, `후보 목록 있는 요청: ${reqs.length}건`);
  const cand = [...user.matchAll(/^P\d+: (.+?)(?: — .*)?$/gm)].map((m) => m[1]);
  assert.ok(cand.length >= 3 && cand.some((c) => /탈의실 사물함/.test(c)), JSON.stringify(cand));
  assert.ok(!cand.some((c) => /단체 GX 수업/.test(c)), `얼굴 자리 모르는 사진 없음: ${JSON.stringify(cand)}`);
  assert.ok(await cur(id));
});

test('② 행동 장: 검정 단색 대신 이 글 사진을 흐리고 어둡게 깐 바탕 · 시안 기록·파일 설명에 남김', async () => {
  for (let k = 1; k <= 5; k++) await libFile(`행동짐 시설 ${k}.jpg`, { caption: `행동짐 운동 공간 ${k}`, tags: ['시설'] });
  const id = await slot(P.act, '행동짐 아침 운동', { days: 12 });
  const draft = say({ title: '아침 운동 시작', body: '아침 운동 이야기입니다.\n가볍게 시작해 보세요.', brief: '실사', why: '', hooks: [], keyword: '운동', card: CARD,
    slides: [{ role: 'cover', title: '아침 운동 시작', body: '' }, { role: 'problem', title: '운동을 미루게 되죠', body: '아침엔 춥고' }, { role: 'solution', title: '30분부터', body: '가볍게' }, { role: 'proof', title: '넓은 공간', body: '기구가 넉넉' }, { role: 'cta', title: '저장해 두세요', body: '전화 주세요' }] });
  await run([draft, draft]);
  const c = await cur(id);
  const pages = c.quality.pages ?? [];
  const k = pages.findIndex((p) => p.role === 'cta');
  assert.ok(k >= 0, JSON.stringify(pages.map((p) => p.role)));
  const cta = pages[k];
  assert.ok(!cta.photoId && typeof cta.back === 'string' && pages.some((p) => p.photoId === cta.back), `흐린 바탕 = 이 글 다른 장 사진: ${JSON.stringify(cta)}`);
  const fileId = c.media_ids[k + 1];
  const [f] = await sql`select description, storage_key from library_files where id = ${fileId}`;
  assert.match(f.description, /행동 장 · 흐린 사진 바탕/);
  // 그림: 모서리(글자 없는 곳)가 검정이 아님 = 사진 바탕
  const img = await readFile(path.join(tmpdir(), 'workos-test', 'uploads', f.storage_key));
  const px = await sharp(img).extract({ left: 8, top: 1300, width: 24, height: 24 }).stats();
  assert.ok(px.channels.slice(0, 3).some((ch) => ch.mean > 14), `바탕이 검정 단색 아님: ${px.channels.map((ch) => Math.round(ch.mean))}`);
  const rec = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  const rows = rec.photoRecord ?? [];
  assert.ok(rows.some((r) => /흐리고 어둡게 깐 바탕/.test(r.why)), JSON.stringify(rows.map((r) => r.why)));
});

test('② 보완: [다시 그리기](표지만 새로)도 예전 검정 행동 장은 흐린 사진 바탕으로 다시 — 나머지 장 파일은 그대로 · AI 비용 0', async () => {
  const [c0] = await sql`select id, current_version, quality from mkt_contents where brand_id = ${P.act} and kind = 'feed' order by created_at desc limit 1`;
  const pages = c0.quality.pages; const k = pages.findIndex((p) => p.role === 'cta');
  delete pages[k].back; // 310차 전에 그린 글처럼(행동 장 검정)
  await sql`update mkt_contents set quality = jsonb_set(quality, '{pages}', ${sql.json(pages)}::jsonb), status = 'pending' where id = ${c0.id}`;
  const before = await cur(c0.id);
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${c0.id}/visual`, { redraw: true });
  assert.equal(r.version, before.current_version + 1);
  const after = await cur(c0.id);
  assert.equal(after.media_ids.length, before.media_ids.length, '장 수 그대로');
  assert.notEqual(after.media_ids[0], before.media_ids[0], '표지 새로');
  after.media_ids.slice(1).forEach((id, j) => { if (j === k) assert.notEqual(id, before.media_ids[j + 1], '행동 장 새로'); else assert.equal(id, before.media_ids[j + 1], `${j + 2}장 그대로`); });
  assert.ok(typeof after.quality.pages[k].back === 'string', JSON.stringify(after.quality.pages[k]));
  assert.match(after.note, /행동 장 1장 흐린 사진 바탕으로/);
  const [f] = await sql`select description from library_files where id = ${after.media_ids[k + 1]}`;
  assert.match(f.description, /흐린 사진 바탕/);
});
