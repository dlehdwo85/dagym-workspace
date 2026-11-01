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

// 314차(로컬 11/01): ④ 사진 영상 장면 기록 — 장면마다 쓴 사진(id·이름)·얼굴 처리(가림 사본/얼굴 없음)·얼굴 때문에 뺀 사진을 사진 기록에 · 첫 장면 표시
test('④ 사진 영상 장면 기록: 장면 사진 이름·첫 장면·얼굴 가린 사본(원본 이름) · 직접 고른 사진 중 얼굴 자리를 몰라 뺀 사진도 남김', async () => {
  const id = await slot(P.face, '얼굴짐 직접 고른 영상', { kind: 'reels', days: 20 });
  await sql`update mkt_contents set auto = false where id = ${id}`; // 정기 실행이 이 칸을 만들지 않게(직접 만드는 영상)
  const picked = [P.eq[0], P.unk, P.eq[1], P.boxed];
  const r = await ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId: id, photoIds: picked });
  assert.equal(r.photos, 3, JSON.stringify(r));
  const reuse = (await sql`select result->'reuse' as r from mkt_briefs where content_id = ${id} order by created_at desc limit 1`)[0].r;
  assert.deepEqual(reuse.faceDropped, [P.unk], '뺀 사진 = 얼굴 자리 모르는 사진');
  const rows = (await ctx.owner.ok('GET', `/api/marketing/contents/${id}`)).photoRecord ?? [];
  const sc = rows.filter((x) => /^영상 장면 \d$/.test(x.where));
  assert.deepEqual(sc.map((x) => x.id), reuse.photos, JSON.stringify(rows));
  assert.match(sc[0].why, /^첫 장면 · 실사 — 얼굴 없음/);
  assert.equal(sc[0].title, '얼굴짐 기구 1.jpg');
  const m = sc.find((x) => x.face === 'masked');
  assert.ok(m && /얼굴 가린 사본으로 넣음\(원본: 얼굴짐 상담 데스크\.jpg\)/.test(m.why) && m.fix.includes('얼굴 모자이크'), JSON.stringify(m));
  const gone = rows.filter((x) => x.face === 'dropped');
  assert.deepEqual(gone.map((x) => [x.where, x.id, x.title]), [['영상에서 뺀 사진', P.unk, '얼굴짐 GX 수업.jpg']]);
});

// 314차(로컬 11/01 ③: 다짐 11/3 피드 표지 GX 수업 사진에 얼굴 그대로): '시안 바탕' 폴더 사진도 얼굴 규칙 — 자리를 모르면 표지로 안 고르고, 알면 모자이크해서 그림(기록 '보정: 얼굴 모자이크')
test('⑤ 표지 바탕도 얼굴 규칙: 시안 바탕 폴더의 얼굴 자리 모르는 사진은 안 씀 · 자리를 아는 사진은 모자이크해서 그리고 사진 기록에 남김', async () => {
  const cov = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '표지짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${cov}`, { intro: '동네 헬스장', products: '회원권' });
  const unk = await libFile('표지짐 GX 수업.jpg', { caption: '단체 GX 수업', tags: ['수업'], people: 6, faces: true });
  const boxed = await libFile('표지짐 상담 데스크.jpg', { caption: '상담 데스크', tags: ['상담'], people: 1, faces: true });
  await sql`update library_files set vision = vision || ${sql.json({ faceBoxes: [{ x: 0.35, y: 0.2, w: 0.3, h: 0.25 }] })} where id = ${boxed}`;
  await sql`update library_files set folder = '마케팅/시안 바탕', tags = array['글자없음'] where id in ${sql([unk, boxed])}`;
  const id = await slot(cov, '표지짐 GX 수업 안내', { days: 9 });
  const feed = say({ title: '표지짐 GX 수업 안내', body: 'GX 수업 시간을 알려 드립니다.\n저녁 7시에 시작합니다.', brief: '실사', why: '', hooks: [], keyword: 'GX', card: CARD });
  await run([feed, feed]);
  const c = await cur(id);
  const vis = c.quality?.visual ?? {};
  const used = [vis.photoId, ...(vis.photoIds ?? []), ...(c.quality?.pages ?? []).map((p) => p.photoId)].filter(Boolean);
  assert.ok(!used.includes(unk), `얼굴 자리 모르는 사진은 표지·장에 없음: ${JSON.stringify(vis)}`);
  assert.equal(vis.photoId ?? vis.photoIds?.[0], boxed, JSON.stringify(vis));
  assert.ok((vis.fix ?? []).includes('얼굴 모자이크'), JSON.stringify(vis));
  const rows = (await ctx.owner.ok('GET', `/api/marketing/contents/${id}`)).photoRecord ?? [];
  const top = rows.find((x) => x.id === boxed);
  assert.ok(top && top.face === 'masked' && top.fix.includes('얼굴 모자이크'), JSON.stringify(rows));
});

// 315차(로컬 11/01 314차 확인 ①: 다짐 요가·GX 수업 사진 여러 명 얼굴이 '실사 — 얼굴 없음'): 사람 2명 이상·단체 장면은 AI 가 얼굴 없다 해도 얼굴 있음 —
// 자리를 모르니 영상·표지·본문에서 뺌 · 예전 설명은 238 마이그레이션이 같은 규칙으로 바꿈 · [얼굴 위치 다시 읽기] 대상(새 규칙으로 읽은 사진은 또 안 읽음)
test('⑥ 단체 사진: 사람 2명 이상·단체 장면은 얼굴 있음으로(자리 모름 → 영상에서 뺌) · 예전 설명은 238 마이그레이션 · 다시 읽기 대상', async () => {
  const grp = await libFile('얼굴짐 요가 수업.jpg', { caption: '요가 수업 중인 회원들', tags: ['요가'], people: 5, faces: false });
  const one = await libFile('얼굴짐 회원 한 명.jpg', { caption: '회원들 사이 트레이너', tags: ['수업'], people: 1, faces: false });
  const solo = await libFile('얼굴짐 기구 정리.jpg', { caption: '기구를 정리하는 직원', tags: ['기구'], people: 1, faces: false });
  const vis = async (id) => (await sql`select vision from library_files where id = ${id}`)[0].vision;
  const g = await vis(grp);
  assert.deepEqual([g.faces, g.facesBy, g.fv, g.faceBoxes], [true, 'people', 2, undefined], JSON.stringify(g));
  assert.deepEqual([(await vis(one)).faces, (await vis(one)).facesBy], [true, 'people'], '한 명이라도 설명에 회원들(단체)');
  assert.equal((await vis(solo)).faces, false, '혼자·단체 아님 = AI 판정 그대로');
  // 예전 설명(fv 없음) → 238 마이그레이션
  const old = await libFile('얼굴짐 GX 예전.jpg', { caption: 'GX 수업 장면', tags: ['수업'], people: 3, faces: false });
  const old1 = await libFile('얼굴짐 예전 한 명.jpg', { caption: '러닝머신 위 회원', tags: ['기구'], people: 1, faces: false });
  for (const id of [old, old1]) await sql`update library_files set vision = (vision - 'fv' - 'facesBy') || '{"faces": false}'::jsonb where id = ${id}`;
  const mig = await readFile(path.join(process.cwd(), 'db/migrations/238_group_faces.sql'), 'utf8');
  await sql.unsafe(mig); await sql.unsafe(mig); // 두 번 돌려도 같음
  assert.deepEqual([(await vis(old)).faces, (await vis(old)).facesBy], [true, 'people']);
  assert.equal((await vis(old1)).faces, false);
  // 영상: 고른 사진 중 단체 사진은 얼굴 자리를 몰라 뺌
  const id = await slot(P.face, '얼굴짐 단체 사진 영상', { kind: 'reels', days: 25 });
  await sql`update mkt_contents set auto = false where id = ${id}`;
  await ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId: id, photoIds: [P.eq[2], grp, P.eq[3], P.eq[4]] });
  const reuse = (await sql`select result->'reuse' as r from mkt_briefs where content_id = ${id} order by created_at desc limit 1`)[0].r;
  assert.deepEqual(reuse.faceDropped, [grp]); assert.ok(!reuse.photos.includes(grp));
  // 사진 AI 설명 칸: 다시 읽을 사진(예전 설명) = noBoxes · 새 규칙으로 읽고도 자리 모름 = stuck
  const all = (await ctx.owner.ok('GET', '/api/marketing/photos')).all;
  assert.ok(all.noBoxes >= 1 && all.stuck >= 2, JSON.stringify(all)); // noBoxes = 238 이 바꾼 예전 사진 · stuck = 새 규칙으로 읽은 단체·얼굴 사진
});

// 315차(로컬 11/01 ②: 다시 그린 다짐 피드 표지 2건이 '사진 없는 틀(브랜드 색)' = 남색 바탕 + 번호 목록 글자): 사진 틀 키트는 사람 없는 사진 먼저 ·
// 쓸 사진이 없어 글자뿐인 틀(목록형 포함)로 가면 단색 표지로 봄 → 승인함 대신 수정 요청 + 자료 요청(정기 제작·다시 그리기 모두)
test('⑦ 표지: 사람 없는 사진 먼저 · 쓸 사진이 없으면 목록형도 단색으로 봄 → 승인함 대신 수정 요청 + 자료 요청(다시 그리기 포함)', async () => {
  const FEED = { style: 'trust', templates: ['photo_fade', 'title', 'list'], palette: { bg: '#152037', accent: '#f0b038' }, header: '틀짐 소식', contact: '상담 1234-5678', kicker: '운영 기록' };
  const tb = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '틀짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${tb}`, { intro: '동네 헬스장', products: '회원권', feed: FEED });
  const door = await libFile('틀짐 입구 모습.jpg', { caption: '틀짐 입구와 안내 데스크', tags: ['입구'] });
  const staff = await libFile('틀짐 입구 직원.jpg', { caption: '틀짐 입구와 안내 데스크', tags: ['입구'], people: 1, facing: 'side' }); // 더 최근 · 글 낱말은 같고 사람만 있음
  const grp = await libFile('틀짐 입구 단체.jpg', { caption: '틀짐 입구에 모인 회원들', tags: ['입구'], people: 6 }); // 얼굴 자리 모름
  const CARD5 = { ...CARD, points: ['입구 옆 안내 데스크', '평일 아침 6시 문 엶', '주차 2시간 무료'] }; // 목록형 틀이 될 수 있게
  const feed = (t) => say({ title: t, body: '틀짐 입구 안내입니다.\n입구 옆에 안내 데스크가 있습니다.', brief: '실사', why: '', hooks: [], keyword: '입구', card: CARD5 });
  const a = await slot(tb, '틀짐 입구 안내', { days: 40 });
  await run([feed('틀짐 입구 안내'), feed('틀짐 입구 안내')]);
  const ca = await cur(a);
  assert.equal(ca.quality.visual.photoId ?? ca.quality.visual.photoIds?.[0], door, `사람 없는 입구 사진 먼저: ${JSON.stringify(ca.quality.visual)}`);
  assert.ok(!ca.quality.visual.plain);
  await sql`update library_files set tags = array['쓰지않음'] where id = ${staff}`; // 이제 남은 표지 사진 없음(입구 = 가까운 글이 씀, 단체 = 얼굴 자리 모름)
  const b = await slot(tb, '틀짐 입구 안내 둘째', { days: 41 });
  await run([feed('틀짐 입구 안내 둘째'), feed('틀짐 입구 안내 둘째')]);
  const cb = await cur(b); const vb = cb.quality.visual;
  assert.ok(![vb.photoId, ...(vb.photoIds ?? [])].includes(grp), '단체 사진은 안 씀');
  assert.ok(!vb.photoId && !(vb.photoIds ?? []).length, JSON.stringify(vb));
  assert.ok(vb.plain, `사진 없는 글자뿐 틀(${vb.template}) = 단색으로 봄`);
  assert.notEqual(cb.status, 'pending', '승인함에 안 올림');
  const mats = async () => (await sql`select count(*)::int as n from mkt_material_requests where brand_id = ${tb}`)[0].n;
  assert.ok(await mats() > 0, '자료 요청');
  // 다시 그리기: 써 본 사진(입구)은 빼므로 남은 표지 사진 없음 → 단색 → 수정 요청(승인함 아님)
  await sql`update mkt_contents set status = 'pending' where id = ${a}`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${a}/visual`, { redraw: true });
  const ra = await cur(a);
  assert.ok(ra.quality.visual.plain && !ra.quality.visual.photoId, JSON.stringify(ra.quality.visual));
  assert.equal(ra.status, 'changes');
});
