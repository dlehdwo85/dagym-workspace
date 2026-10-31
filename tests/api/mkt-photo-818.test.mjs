// 282차 #818 ①②(대표 10/31 "승인 대기 게시물들의 사진이 문구와 전혀 관련이 없거나 사진이 흔들리거나 초점이 안맞음에도 그대로 구현해둠"):
// ① 사진 설명 때 서버가 선명도(라플라시안 분산)를 계산해 vision.sharp 로 저장(AI 호출 없음) — 결이 없는 단색 그림은 판단 안 함 ·
//    선명도 미달(흔들림·초점 나감) 또는 AI 가 '화질 나쁨'으로 본 사진은 시안 바탕·블로그 사진에서 아예 뺌 · 예전에 설명한 사진은 정기 실행이 선명도만 채움
// ② 제목·본문 낱말과 맞는 사진이 하나라도 있으면 그것만 고름 — 구조 시험(가짜 AI). 실제 사진에서 기준값(40)이 맞는지는 운영 사진으로 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { BASE, FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake, br; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const V = (o) => ({ caption: '매장 안 사진', scene: '매장 안 모습입니다.', tags: ['매장'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
/** 결이 있는 사진(무늬) · 같은 사진을 흐리게 · 한 색 */
const textured = (seed) => { const w = 320, h = 240; const b = randomBytes(w * h * 3); b[0] = seed; return sharp(b, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer(); };
const blurred = async (seed) => sharp(await textured(seed)).blur(8).jpeg({ quality: 90 }).toBuffer();
const solid = () => sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 90, g: 120, b: 160 } } }).jpeg().toBuffer();
let minutes = 60;
async function libFile(name, data) {
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, created_at)
    values ('default', 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${[]}, now() - ${`${minutes--} minutes`}::interval) returning id`;
  const key = `lib/default/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
const describe = async (id, answer) => { await ctl({ visionQueue: [answer] }); return ctx.owner.ok('POST', '/api/marketing/photos/describe', { ids: [id], redo: true }); };
const vis = async (id) => (await sql`select vision from library_files where id = ${id}`)[0].vision;
async function slot(brandId, title, { kind = 'feed', channel = 'instagram', day = 3, ago = 1 } = {}) {
  const at = new Date(Date.now() + day * 864e5); at.setUTCHours(1, 0, 0, 0);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produce_at)
    values ('default', ${brandId}, ${title}, ${channel}, ${kind}, ${at}, 'draft', 0, ${ctx.ownerId}, true, now() - ${`${ago} minutes`}::interval) returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.quality, c.current_version, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: false });
  br = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '선명짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${br.id}`, { intro: '동네 헬스장', products: '1개월 회원권' });
  P.sharp = await libFile('선명짐 매장 러닝머신.jpg', await textured(1));
  P.blur = await libFile('선명짐 매장 러닝머신 2.jpg', await blurred(2)); // 더 최근 + 같은 점수 → 예전이라면 먼저 뽑힘
  P.solid = await libFile('선명짐 로고 바탕.jpg', await solid());
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('① 선명도: 결이 있는 사진은 높게 · 흐린 사진은 기준(40) 아래 · 한 색 그림은 판단 안 함 — AI 가 화질 좋음으로 봐도 서버 값은 따로', async () => {
  await describe(P.sharp, V({ caption: '러닝머신이 놓인 매장 안', tags: ['러닝머신', '매장'] }));
  await describe(P.blur, V({ caption: '러닝머신이 놓인 매장 안', tags: ['러닝머신', '매장'] }));
  await describe(P.solid, V({ caption: '한 가지 색 바탕', tags: ['바탕'] }));
  const a = await vis(P.sharp), b = await vis(P.blur), c = await vis(P.solid);
  assert.ok(a.sharp >= 40, `선명한 사진 ${a.sharp}`); assert.ok(typeof b.sharp === 'number' && b.sharp < 40, `흐린 사진 ${b.sharp}`);
  assert.equal(c.sharp, -1, '한 색 그림은 판단 안 함(-1 = 쟀지만 판단 못함)');
  assert.equal(b.quality, 'good', 'AI 판정은 그대로 두고 서버 값으로 가림');
});

test('① 시안 바탕: 흐린 사진(더 최근·같은 이름)은 고르지 않고 선명한 사진', async () => {
  const feed = await slot(br.id, '러닝머신 처음 쓰는 법', { ago: 5 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const f = await cur(feed);
  assert.equal(f.quality.visual.photoId, P.sharp, JSON.stringify(f.quality.visual));
});

test('① 예전에 설명한 사진(선명도 없음)은 정기 실행이 선명도만 채움(AI 호출 없음)', async () => {
  const old = await libFile('선명짐 예전 사진.jpg', await blurred(3));
  await sql`update library_files set vision = ${sql.json({ v: 1, at: new Date().toISOString(), ...V({ caption: '예전 설명' }) })} where id = ${old}`;
  const v0 = fake.state.vision.length;
  for (let i = 0; i < 20 && (await vis(old)).sharp === undefined; i++) {
    await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } });
    await new Promise((r) => setTimeout(r, 500));
  }
  const v = await vis(old);
  assert.ok(typeof v.sharp === 'number' && v.sharp < 40, JSON.stringify(v));
  assert.equal(v.caption, '예전 설명', '설명은 그대로');
  assert.equal(fake.state.vision.length, v0, 'AI 사진 설명은 다시 부르지 않음');
});

test('② 사진 생성을 켠 회사: 제목·본문 낱말이 하나도 안 맞는 사진(브랜드만 같음)은 안 씀 → 빈 칸(생성이 채움) · 끄면 예전처럼 브랜드 사진', async () => {
  const b2 = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '관련짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b2.id}`, { intro: '동네 필라테스', products: '필라테스 10회권' });
  const park = await libFile('관련짐 주차장.jpg', await textured(7));
  await describe(park, V({ caption: '건물 뒤 주차장', scene: '차 몇 대가 서 있는 주차장입니다.', tags: ['주차장', '차량'] }));
  await ctx.owner.ok('PUT', '/api/marketing/auto', { photoGen: true });
  const on = await slot(b2.id, '필라테스 첫 수업 안내', { day: 2, ago: 4 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c1 = await cur(on); assert.ok(c1, JSON.stringify(await sql`select status, current_version, produce_at, quality from mkt_contents where id = ${on}`));
  assert.equal(c1.quality.visual.photoId ?? null, null, '관련 없는 주차장 사진은 안 씀');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { photoGen: false });
  const off = await slot(b2.id, '필라테스 둘째 수업 안내', { day: 3, ago: 3 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal((await cur(off)).quality.visual.photoId, park, '생성을 끈 회사는 예전처럼(모든 장 실사)');
});

test('⑤ 승인 대기 시안: 바탕 사진이 흔들림이면 한 번 다시 그림(다른 선명한 사진) · 선명도를 아직 안 쟀으면 287차부터 그 자리에서 잼', async () => {
  const b3 = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다시짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b3.id}`, { intro: '동네 헬스장', products: '1개월 회원권' });
  const good = await libFile('다시짐 매장 스쿼트.jpg', await textured(11));
  await describe(good, V({ caption: '스쿼트 랙이 있는 매장', tags: ['스쿼트', '매장'] }));
  const shaky = await libFile('다시짐 매장 스쿼트 2.jpg', await blurred(12));
  await describe(shaky, V({ caption: '스쿼트 랙이 있는 매장', tags: ['스쿼트', '매장'] }));
  await sql`update library_files set vision = vision - 'sharp' where id = ${shaky}`; // 282차 전에 설명한 사진처럼(선명도 없음) → 처음엔 고름
  const c = await slot(b3.id, '스쿼트 자세 바로잡기', { day: 2, ago: 2 });
  for (let k = 0; k < 2 && (await cur(c))?.quality?.visual?.photoId !== good; k++) await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const [first] = await sql`select (select meta->>'photoId' from library_files where id = v.media_ids[1]) as p from mkt_versions v where v.content_id = ${c} and cardinality(v.media_ids) > 0 order by v.version limit 1`;
  assert.equal(first.p, shaky, '선명도 없을 때는 예전처럼 고름');
  assert.equal(typeof (await vis(shaky)).sharp, 'number', '다시 검사가 그 자리에서 선명도를 잼(정기 실행을 기다리지 않음)');
  const v2 = await cur(c);
  assert.equal(v2.quality.visual.photoId, good, JSON.stringify(v2.quality.visual));
  assert.match(v2.note ?? '', /흔들린·초점 나간 바탕 사진 바꿈/);
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const v3 = await cur(c); assert.equal(v3.quality.visual.rv, 8, '한 번만'); assert.equal(v3.quality.visual.photoId, good); assert.equal(v3.current_version, v2.current_version);
});

test('286차 AI 설명 문장: "사진이 약간 흔들려 흐릿" 이면 선명도 값이 높아도 안 씀 · 배경만 흐린 사진은 씀 · 중앙값도 기록', async () => {
  const b4 = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '문장짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b4.id}`, { intro: '동네 헬스장', products: '1개월 회원권' });
  const bokeh = await libFile('문장짐 매장 덤벨.jpg', await textured(21));
  await describe(bokeh, V({ caption: '덤벨이 놓인 매장', scene: '배경이 흐릿하게 처리된 덤벨 사진입니다.', tags: ['덤벨', '매장'] }));
  const shaky = await libFile('문장짐 매장 덤벨 2.jpg', await textured(22)); // 더 최근 — 예전이라면 먼저 뽑힘
  await describe(shaky, V({ caption: '덤벨이 놓인 매장', scene: '사진이 약간 흔들려 흐릿합니다.', tags: ['덤벨', '매장'] }));
  const v = await vis(shaky); assert.ok(v.sharp >= 40 && typeof v.sharpMed === 'number', JSON.stringify(v));
  const c = await slot(b4.id, '덤벨 고르는 법', { day: 2, ago: 2 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal((await cur(c)).quality.visual.photoId, bokeh, '흔들렸다고 설명된 사진은 빼고, 배경만 흐린 사진은 씀');
});

test('286차 #818 ④ 얼굴 모자이크: AI 설명이 얼굴 자리를 알려 준 사진을 블로그 본문에 쓰면 얼굴을 가린 사본(원본은 그대로)', async () => {
  const b5 = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '얼굴짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b5.id}`, { intro: '동네 헬스장', products: '1개월 회원권' });
  const face = await libFile('얼굴짐 회원 사진.jpg', await textured(31));
  await describe(face, V({ caption: '회원 두 명이 운동하는 모습', tags: ['회원'], faces: true, people: 2, face_boxes: [{ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }] }));
  assert.deepEqual((await vis(face)).faceBoxes, [{ x: 0.3, y: 0.3, w: 0.4, h: 0.4 }]);
  const cover = await libFile('얼굴짐 트레이너 수업 공간.jpg', await textured(32)); // 제목 낱말이 맞고 더 최근 → 표지, 본문은 남은 얼굴 사진
  await describe(cover, V({ caption: '트레이너 수업 공간', tags: ['트레이너', '수업'] }));
  const at = new Date(Date.now() + 2 * 864e5); at.setUTCHours(4, 0, 0, 0);
  const [bl] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produce_at)
    values ('default', ${b5.id}, '트레이너 수업 이야기', 'blog', 'blog', ${at}, 'draft', 0, ${ctx.ownerId}, true, now() - interval '1 minute') returning id`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const b = await cur(bl.id);
  const ids = b.media_ids.slice(1);
  assert.ok(!ids.includes(face), `원본 얼굴 사진을 그대로 붙이지 않음 ${JSON.stringify(ids)}`);
  const [copy] = await sql`select id, source, meta, storage_key, folder from library_files where source = 'mosaic' and meta->>'of' = ${face}`;
  assert.ok(copy && ids.includes(copy.id), '얼굴 가린 사본을 붙임');
  assert.equal(copy.folder, '마케팅/자동 시안');
  const center = async (buf) => { const { data, info } = await sharp(buf).greyscale().extract({ left: 128, top: 96, width: 64, height: 48 }).raw().toBuffer({ resolveWithObject: true });
    let s = 0, q = 0; for (const x of data) { s += x; q += x * x; } const m = s / data.length; return q / data.length - m * m; };
  const orig = await center(await (await import('node:fs/promises')).readFile(path.join(tmpdir(), 'workos-test', 'uploads', (await sql`select storage_key from library_files where id = ${face}`)[0].storage_key)));
  const blur = await center(await (await import('node:fs/promises')).readFile(path.join(tmpdir(), 'workos-test', 'uploads', copy.storage_key)));
  assert.ok(blur < orig / 3, `얼굴 자리 결이 크게 줄어듦 ${orig} → ${blur}`);
  // 같은 사진을 다시 쓰면 사본을 다시 만들지 않음 · 사본은 사진 고르기 후보에서 빠짐
  const pool = await ctx.owner.ok('GET', '/api/marketing/photos?limit=200').catch(() => null);
  if (pool?.items) assert.ok(!pool.items.some((x) => x.id === copy.id), '사본은 사진 목록·고르기에서 빠짐');
});

/** 287차: 서버가 그린 그림처럼(자동 시안 폴더·source ai) — 표지 파일·카드 장·도표형 카드 자리 */
async function drawnFile(name, meta = {}) {
  const id = await libFile(name, await textured(99));
  await sql`update library_files set source = 'ai', folder = '마케팅/자동 시안', meta = ${sql.json(meta)} where id = ${id}`;
  return id;
}
async function pendingPost(brandId, { title, channel, kind, body, media, quality, hours }) {
  const at = new Date(Date.now() + 2 * 864e5 + hours * 3600e3);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
    values ('default', ${brandId}, ${title}, ${channel}, ${kind}, ${at}, 'pending', 1, ${ctx.ownerId}, true, ${sql.json(quality)}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${body}, ${media}, '시안 자동 그리기', ${ctx.ownerId})`;
  return c.id;
}

test('287차 #818 승인 대기 블로그: 흔들린 본문 사진만 그 자리 글과 맞는 다른 실사로 · [사진 n] 줄 설명도 새 사진으로 · 표지·다른 본문 사진은 그대로 · 한 번만', async () => {
  const b6 = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '뒤쪽짐' });
  const coverPh = await libFile('뒤쪽짐 매장 입구.jpg', await textured(41));
  await describe(coverPh, V({ caption: '매장 입구', tags: ['입구'] }));
  const goodBody = await libFile('뒤쪽짐 상담 공간.jpg', await textured(42));
  await describe(goodBody, V({ caption: '상담 테이블이 있는 공간', tags: ['상담'] }));
  const shakyBody = await libFile('뒤쪽짐 스트레칭 공간 2.jpg', await blurred(43));
  await describe(shakyBody, V({ caption: '스트레칭 하는 공간', tags: ['스트레칭'] }));
  await sql`update library_files set vision = vision - 'sharp' - 'sharpMed' where id = ${shakyBody}`; // 예전에 설명한 사진(선명도 없음)
  const spare = await libFile('뒤쪽짐 스트레칭 매트.jpg', await textured(44));
  await describe(spare, V({ caption: '스트레칭 매트가 깔린 공간', tags: ['스트레칭', '매트'] }));
  const coverFile = await drawnFile('뒤쪽짐 블로그 표지.jpg', { photoId: coverPh });
  const info = await drawnFile('뒤쪽짐 도표형 카드.jpg');
  const body = '스트레칭 공간을 소개합니다.\n\n[사진 1] 스트레칭 하는 공간\n\n매트가 넉넉해 운동 전후에 쓰기 좋습니다.\n\n[사진 2] 상담 테이블이 있는 공간\n\n상담은 언제든 문의 주세요.';
  const bl = await pendingPost(b6.id, { title: '스트레칭 공간 소개', channel: 'blog', kind: 'blog', body, media: [coverFile, shakyBody, goodBody, info], hours: 1,
    quality: { visual: { by: 'server', fileId: coverFile, photoId: coverPh, rv: 5, tried: [coverPh] } } });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const b = await cur(bl);
  assert.equal(b.current_version, 2, JSON.stringify(b.quality));
  assert.deepEqual(b.media_ids, [coverFile, spare, goodBody, info], '표지·다른 본문 사진·도표형 카드는 그대로, 흔들린 사진 자리만 바꿈');
  assert.match(b.note ?? '', /표지는 그대로 · 흔들린·초점 나간 본문 사진 1장 바꿈/);
  assert.equal(b.quality.visual.photoId, coverPh); assert.equal(b.quality.visual.fileId, coverFile);
  const [{ body: nb }] = await sql`select body from mkt_versions where content_id = ${bl} and version = 2`;
  assert.match(nb, /\[사진 1\] 스트레칭 매트가 깔린 공간/); assert.match(nb, /\[사진 2\] 상담 테이블이 있는 공간/); assert.match(nb, /매트가 넉넉해/);
  assert.equal(typeof (await vis(shakyBody)).sharpMed, 'number', '선명도를 그 자리에서 재서 남김');
  const n = await sql`select title, body from notifications where entity_id = ${bl} and title like '시안을 다시 그렸습니다%'`;
  assert.match(n[0]?.body ?? '', /본문 사진이 흔들렸거나/);
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const b2 = await cur(bl); assert.equal(b2.current_version, 2, '한 번만'); assert.equal(b2.quality.visual.rv, 8);
});

test('287차 #818 승인 대기 카드뉴스: 흔들린 장 사진만 다시 고르고(다른 장 사진은 그대로) 장을 새로 그림 · 표지 그대로', async () => {
  const b7 = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '카드짐' });
  const coverPh = await libFile('카드짐 매장 전경.jpg', await textured(51));
  await describe(coverPh, V({ caption: '매장 전경', tags: ['전경'] }));
  const shaky = await libFile('카드짐 러닝 구역 2.jpg', await blurred(52));
  await describe(shaky, V({ caption: '러닝 구역', tags: ['러닝'] }));
  const good = await libFile('카드짐 러닝 구역.jpg', await textured(53));
  await describe(good, V({ caption: '러닝머신이 있는 구역', tags: ['러닝', '러닝머신'] }));
  const keep = await libFile('카드짐 상담실.jpg', await textured(54));
  await describe(keep, V({ caption: '상담실', tags: ['상담'] }));
  const coverFile = await drawnFile('카드짐 피드 표지.jpg', { photoId: coverPh });
  const pagesF = [await drawnFile('카드짐 카드 2.jpg'), await drawnFile('카드짐 카드 3.jpg'), await drawnFile('카드짐 카드 4.jpg')];
  const pages = [{ role: 'problem', title: '러닝 구역', body: '러닝머신이 넉넉합니다', photoId: shaky }, { role: 'proof', title: '상담실', body: '상담실에서 편하게 이야기합니다', photoId: keep }, { role: 'cta', title: '문의', body: '프로필에서 문의하세요' }];
  const f = await pendingPost(b7.id, { title: '러닝 구역 안내', channel: 'instagram', kind: 'feed', body: '러닝 구역을 안내합니다.', media: [coverFile, ...pagesF], hours: 2,
    quality: { pages, visual: { by: 'server', fileId: coverFile, photoId: coverPh, rv: 5, tried: [coverPh] } } });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(f);
  assert.equal(c.current_version, 2, JSON.stringify(c.quality));
  assert.equal(c.media_ids[0], coverFile, '표지 그대로'); assert.equal(c.media_ids.length, 4);
  assert.ok(!c.media_ids.slice(1).some((x) => pagesF.includes(x)), '장은 새로 그림');
  assert.deepEqual(c.quality.pages.map((p) => p.photoId ?? null), [good, keep, null], '흔들린 장만 다른 사진, 다른 장 사진은 그대로');
  assert.match(c.note ?? '', /흔들린·초점 나간 카드 사진 1장 바꿈/);
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal((await cur(f)).current_version, 2, '한 번만');
});

test('287차 #818 ④ [얼굴 위치 다시 읽기]: 600장 상한 없는 숫자 · 얼굴은 보이는데 위치를 모르는 예전 사진만 다시 설명', async () => {
  const old = await libFile('얼굴짐 예전 회원 사진.jpg', await textured(61));
  await describe(old, V({ caption: '회원이 운동하는 모습', tags: ['회원'], faces: true, people: 1, face_boxes: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.3 }] }));
  await sql`update library_files set vision = vision - 'faceBoxes' where id = ${old}`; // 286차 전에 설명한 사진처럼
  const v0 = await ctx.owner.ok('GET', '/api/marketing/photos');
  assert.ok(v0.all.total >= v0.total && v0.all.faces >= 2, JSON.stringify(v0.all));
  assert.equal(v0.all.noBoxes, 1);
  assert.ok([403, 404].includes((await ctx.staffA.client.post('/api/marketing/photos/describe', { faces: true })).status), '관리자만(마케팅 공간이 없으면 404)');
  await ctl({ visionQueue: [V({ caption: '회원이 운동하는 모습', tags: ['회원'], faces: true, people: 1, face_boxes: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.3 }] })] });
  const r = await ctx.owner.ok('POST', '/api/marketing/photos/describe', { faces: true });
  assert.deepEqual([r.done, r.left], [1, 0], JSON.stringify(r));
  assert.deepEqual((await vis(old)).faceBoxes, [{ x: 0.4, y: 0.2, w: 0.2, h: 0.3 }]);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/photos')).all.noBoxes, 0);
});
