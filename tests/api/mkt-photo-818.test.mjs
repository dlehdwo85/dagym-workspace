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

test('⑤ 승인 대기 시안: 바탕 사진이 나중에 흔들림으로 판정되면 한 번 다시 그림(다른 선명한 사진) · 선명도를 아직 안 쟀으면 기다림', async () => {
  const b3 = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다시짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b3.id}`, { intro: '동네 헬스장', products: '1개월 회원권' });
  const good = await libFile('다시짐 매장 스쿼트.jpg', await textured(11));
  await describe(good, V({ caption: '스쿼트 랙이 있는 매장', tags: ['스쿼트', '매장'] }));
  const shaky = await libFile('다시짐 매장 스쿼트 2.jpg', await blurred(12));
  await describe(shaky, V({ caption: '스쿼트 랙이 있는 매장', tags: ['스쿼트', '매장'] }));
  await sql`update library_files set vision = vision - 'sharp' where id = ${shaky}`; // 282차 전에 설명한 사진처럼(선명도 없음) → 처음엔 고름
  const c = await slot(b3.id, '스쿼트 자세 바로잡기', { day: 2, ago: 2 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const v1 = await cur(c);
  assert.equal(v1.quality.visual.photoId, shaky, '선명도 없을 때는 예전처럼 고름');
  assert.equal(v1.status, 'pending');
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const w = await cur(c); assert.notEqual(w.quality.visual.rv, 4, '선명도를 아직 안 쟀으면 끝냄 표시(4)를 하지 않고 기다림'); assert.equal(w.current_version, v1.current_version);
  await sql`update library_files set vision = vision || '{"sharp": 2.5}'::jsonb where id = ${shaky}`; // 정기 실행이 선명도를 잼
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const v2 = await cur(c);
  assert.equal(v2.quality.visual.photoId, good, JSON.stringify(v2.quality.visual));
  assert.match(v2.note ?? '', /흔들린·초점 나간 바탕 사진 바꿈/);
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const v3 = await cur(c); assert.equal(v3.quality.visual.rv, 4, '한 번만'); assert.equal(v3.quality.visual.photoId, good);
});
