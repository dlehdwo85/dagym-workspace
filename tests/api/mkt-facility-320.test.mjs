// 320차(대표 11/01 23:3x 지적 — 다짐 11/3 피드 「사우나랑 독서실도 맡길 수 있나요?」 표지·4분할이 헬스장·GX룸 사진): 제목·표지 첫 줄에 시설 이름이 있으면 그 시설 사진만 ·
// 비슷한 말 묶음(독서실·열람실·스터디카페 / 사우나·목욕탕·찜질) · 맞는 사진이 없으면 다른 시설 사진으로 채우지 않고 보류 + 그 시설 자료 요청 ·
// ④ 무엇이 찍혔는지 모르는 사진('내용 확인 불가'·설명이 파일 이름뿐)은 안 씀 · ⑤ 낱말이 안 맞는 장을 '관련 약함'으로 채우지 않음(mkt-cardnews 에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const V = (o) => ({ caption: '매장 안 사진', scene: '매장 안 모습입니다.', tags: ['매장'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
const describe = async (id, answer) => { await ctl({ visionQueue: [answer] }); return ctx.owner.ok('POST', '/api/marketing/photos/describe', { ids: [id], redo: true }); };
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
let nth = 0;
const photo = () => { nth++; return sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 60 + (nth * 37) % 150, g: 110 + (nth * 23) % 100, b: 140 } } }).jpeg().toBuffer(); };
async function libFile(name, vision, { description = null } = {}) {
  const data = await photo();
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, description)
    values ('default', 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${description}) returning id`;
  const key = `lib/default/${f.id}/${f.id}.jpg`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  if (vision) await describe(f.id, V(vision));
  return f.id;
}
async function slot(brand, title, { days = 3 } = {}) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${brand}, ${title}, 'instagram', now() + make_interval(days => ${days}), 'draft', 0, ${ctx.ownerId}, 'feed', true, now(), false, ${[]}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality from mkt_contents c where c.id = ${id}`)[0];
const used = (v) => [v.photoId, ...(v.photoIds ?? [])].filter(Boolean);
const run = async (queue) => { await ctl({ anthropicReset: true, anthropicQueue: queue }); return ctx.owner.ok('POST', '/api/marketing/auto/run', {}); };
const feed = (t) => say({ title: t, body: `${t}\n아파트 커뮤니티 시설을 한 곳에서 맡아 운영합니다.`, brief: '실사', why: '', hooks: [], keyword: '시설', card: CARD,
  slides: [{ role: 'cover', title: t, body: '' }, { role: 'problem', title: '시설마다 업체가 달라요', body: '관리가 나뉨' }, { role: 'solution', title: '한 곳에서 운영', body: '한 번에' }, { role: 'cta', title: '상담해 보세요', body: '' }] });
const FEED = { style: 'trust', templates: ['photo_fade', 'grid4', 'title', 'list'], palette: { bg: '#152037', accent: '#f0b038' }, header: '시설짐 소식', contact: '상담 1234-5678', kicker: '운영 기록' };

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  P.b = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '시설짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.b}`, { intro: '아파트 커뮤니티 시설 위탁 운영', products: '헬스장·사우나·독서실 운영', feed: FEED });
  P.gym = [];
  for (let k = 1; k <= 4; k++) P.gym.push(await libFile(`시설짐 헬스장 ${k}.jpg`, { caption: `시설짐 헬스장 기구 ${k}`, tags: ['헬스장', '기구'] }));
  P.gx = await libFile('시설짐 GX룸.jpg', { caption: '시설짐 GX룸 매트와 짐볼', tags: ['GX룸'] });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('① 제목에 사우나·독서실 → 그 시설 사진이 없으면 헬스장·GX룸 사진으로 채우지 않음 · 보류(승인함 아님) + 사우나·독서실 자료 요청', async () => {
  const t = '사우나랑 독서실도 맡길 수 있나요?';
  P.c1 = await slot(P.b, t, { days: 30 });
  await run([feed(t), feed(t)]);
  const c = await cur(P.c1); const v = c.quality.visual;
  assert.deepEqual(used(v), [], `다른 시설 사진이 표지에: ${JSON.stringify(v)}`);
  assert.ok(v.plain, '사진 없는 표지 = 단색으로 봄');
  assert.notEqual(c.status, 'pending', '승인함에 안 올림');
  const pagePhotos = (c.quality.pages ?? []).map((p) => p.photoId).filter(Boolean);
  assert.ok(!pagePhotos.some((id) => [...P.gym, P.gx].includes(id)), `카드 장에도 다른 시설 사진: ${JSON.stringify(c.quality.pages)}`);
  const mats = await sql`select title, detail, wanted from mkt_material_requests where brand_id = ${P.b} and status = 'requested'`;
  assert.equal(mats.length, 1, JSON.stringify(mats));
  assert.match(mats[0].title, /사우나·독서실/);
  assert.match(mats[0].detail, /사우나랑 독서실도/);
  assert.equal(mats[0].wanted, 6, '시설마다 3장');
});

test('② 비슷한 말: 찜질방(사우나)·스터디카페(독서실) 사진을 올리면 다시 그리기에 그 사진만 · 사람 있는 열람실 사진(얼굴 자리 모름)은 안 씀 · 자료 요청은 더 안 만듦', async () => {
  P.sauna = await libFile('시설짐 찜질방 내부.jpg', { caption: '시설짐 찜질방 내부 모습', tags: ['찜질방'] });
  P.study = await libFile('시설짐 스터디카페 좌석.jpg', { caption: '시설짐 스터디카페 좌석 줄', tags: ['스터디카페'] });
  P.room = await libFile('시설짐 열람실 이용.jpg', { caption: '시설짐 열람실에서 공부하는 사람들', tags: ['열람실'], people: 3, faces: true });
  await ctx.owner.ok('POST', `/api/marketing/contents/${P.c1}/visual`, { redraw: true });
  const v = (await cur(P.c1)).quality.visual;
  assert.ok(used(v).length >= 1, JSON.stringify(v));
  assert.ok(used(v).every((id) => [P.sauna, P.study].includes(id)), `사우나·독서실 사진만: ${JSON.stringify(v)}`);
  assert.ok(!v.plain);
  assert.equal((await sql`select count(*)::int n from mkt_material_requests where brand_id = ${P.b}`)[0].n, 1, '같은 시설 요청은 한 번');
});

test('③ 시설 이름이 없는 제목은 제한 없음(헬스장 사진도 씀) · 헬스장은 기본 시설이라 묶음 아님', async () => {
  const t = '아침 7시에 문을 엽니다';
  const id = await slot(P.b, t, { days: 33 });
  await run([feed(t), feed(t)]);
  const v = (await cur(id)).quality.visual;
  assert.ok(used(v).length >= 1 && !v.plain, JSON.stringify(v));
});

test('④ 무엇이 찍혔는지 모르는 사진(설명 \'내용 확인 불가\' · AI 설명 없이 설명이 파일 이름뿐)은 표지·장 후보에서 빠짐 — 미리보기로 확인', async () => {
  const b2 = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '모름짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b2}`, { intro: '동네 헬스장', products: '회원권', feed: { ...FEED, header: '모름짐 소식' } });
  const unk = await libFile('모름짐 카톡 사진.jpg', { caption: '카카오톡 이미지, 내용 확인 불가', scene: '모름짐 사진인데 내용 확인이 어렵습니다.', tags: ['모름짐'] });
  const fname = await libFile('모름짐 KakaoTalk_20251101_123456.jpg', null, { description: 'KakaoTalk_20251101_123456.jpg' }); // AI 설명 없음 · 설명 = 파일 이름
  await sql`update library_files set tags = array['글자없음'] where id = ${fname}`; // 바탕 후보로 들어오게(사람이 고른 표시) — 고른 사진은 그대로 씀
  const ok = await libFile('모름짐 러닝머신.jpg', { caption: '모름짐 러닝머신 줄', tags: ['모름짐'] });
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${b2}/feed-preview`, { feed: { ...FEED, header: '모름짐 소식', templates: ['photo_fade'] } });
  assert.ok(!r.sample.photoIds.includes(unk), `내용 확인 불가 사진: ${JSON.stringify(r.sample.photoIds)}`);
  assert.ok(r.sample.photoIds.includes(ok));
  assert.ok(r.sample.photoIds.includes(fname), '사람이 바탕으로 고른 사진(글자없음)은 설명이 파일 이름뿐이어도 씀');
  await sql`update library_files set tags = array[]::text[], folder = '마케팅/사진' where id = ${fname}`;
  const r2 = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${b2}/feed-preview`, { feed: { ...FEED, header: '모름짐 소식', templates: ['photo_fade'] } });
  assert.ok(!r2.sample.photoIds.includes(fname), '고른 표시가 없으면 파일 이름뿐인 사진은 안 씀');
});

test('⑤ 사람이 만든 열린 자료 요청에 그 시설이 있으면 AI 가 또 만들지 않음', async () => {
  await sql`delete from mkt_material_requests where brand_id = ${P.b}`;
  await ctx.owner.ok('POST', '/api/marketing/materials', { brandId: P.b, kind: 'photo', title: '시설짐 사우나 3장 + 열람실 3장', detail: '사람 없이', wanted: 6 });
  const t = '목욕탕과 열람실도 한 번에';
  const id = await slot(P.b, t, { days: 36 });
  await sql`update library_files set tags = array['쓰지않음'] where id in ${sql([P.sauna, P.study])}`; // 맞는 사진 없음
  await run([feed(t), feed(t)]);
  const c = await cur(id);
  assert.deepEqual(used(c.quality.visual), [], JSON.stringify(c.quality.visual));
  const mats = await sql`select source from mkt_material_requests where brand_id = ${P.b}`;
  assert.deepEqual(mats.map((m) => m.source), ['manual'], '사람 요청 하나뿐');
});

// 323차(로컬 11/02 ②: 하이링크 「이사 나간 다음 날, 그 세대의 헬스장 출입은…」 영상에 카페 사진 2장 — 헬스장은 제한 시설이 아니고 카페 사진은 설명이 있어 321차 규칙을 통과):
// 사진 이름·태그·한 줄 설명·폴더·원본 영상 이름에 글(제목·본문)에 없는 다른 시설(카페·주차장·사우나·독서실…)이 있으면 그 사진은 안 씀 · 글이 그 시설을 말하면 씀 · 장면 설명(긴 글)에 지나가듯 나온 말은 안 봄
test('⑥ 글에 없는 다른 시설 사진(카페·주차장)은 표지·4분할·영상 후보에서 뺌 · 글이 그 시설을 말하면 씀 · 장면 설명에만 나온 말은 안 봄', async () => {
  const b3 = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '출입짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b3}`, { intro: '헬스장 출입 관리', products: '얼굴 출입', feed: { ...FEED, header: '출입짐 소식', templates: ['photo_fade', 'grid4'] } });
  const door = await libFile('출입짐 출입문 단말.jpg', { caption: '출입짐 출입문 얼굴 인식 단말', tags: ['출입'] });
  const cafe1 = await libFile('출입짐 카페3.jpg', { caption: '카페 안 키오스크', tags: ['카페'] });
  const cafe2 = await libFile('출입짐 매장 창가.jpg', { caption: '출입짐 매장 사진', scene: '카페 창가 자리가 보이는 매장입니다.', tags: ['매장'], }); // 장면 설명에만 '카페' — 안 뺌(이름·태그·한 줄 설명엔 없음)
  const park = await libFile('출입짐 주차장 입구.jpg', { caption: '출입짐 주차장 차단기', tags: ['주차장'] });
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${b3}/feed-preview`, { feed: { ...FEED, header: '출입짐 소식', templates: ['photo_fade'] } });
  const got = r.sample.photoIds;
  assert.ok(got.includes(door) && got.includes(cafe2), JSON.stringify(got));
  assert.ok(!got.includes(cafe1) && !got.includes(park), `다른 시설 사진이 후보에: ${JSON.stringify(got)}`);
  // 영상(고른 사진 포함): 카페 사진은 빠지고 '뺀 사진'에 남음 — 글이 카페를 말하면 그대로 씀
  const t = '이사 나간 다음 날, 그 세대의 헬스장 출입은';
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${b3}, ${t}, 'instagram', now() + make_interval(days => 20), 'pending', 1, ${ctx.ownerId}, 'reels', false, now(), false, ${[]}, 'content') returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${'이사 나간 세대의 출입은 다음 날 자동으로 막힙니다.\n관리사무소가 명단을 따로 지우지 않아도 됩니다.\n입주민 앱 등록이 풀리면 출입도 함께 풀립니다.\n운영 인력은 그대로, 확인할 일은 줄어듭니다.'}, ${[]}, '시험', ${ctx.ownerId})`; // 398차 #1024: 영상 대본은 4줄 넘게
  const ids = [door, cafe1, cafe2, park, ...P.gym.slice(0, 2)];
  const e = await ctx.owner.req('POST', '/api/marketing/studio/slideshow', { contentId: c.id, photoIds: ids });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  const [brief] = await sql`select result->'reuse' as reuse from mkt_briefs where content_id = ${c.id} order by created_at desc limit 1`;
  assert.ok(!brief.reuse.photos.includes(cafe1) && !brief.reuse.photos.includes(park), JSON.stringify(brief.reuse));
  assert.ok((brief.reuse.faceDropped ?? []).includes(cafe1) && (brief.reuse.faceDropped ?? []).includes(park), `뺀 사진 기록: ${JSON.stringify(brief.reuse)}`);
  await sql`update mkt_briefs set status = 'failed' where content_id = ${c.id}`; // 합성은 이 시험 범위 밖
  // 글이 카페를 말하면 카페 사진도 후보
  await sql`update mkt_versions set body = ${'헬스장과 카페 출입을 한 번에 관리합니다.\n이사 나간 세대는 다음 날 자동으로 막힙니다.\n관리사무소가 명단을 따로 지우지 않아도 됩니다.\n운영 인력은 그대로, 확인할 일은 줄어듭니다.'} where content_id = ${c.id}`;
  await ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId: c.id, photoIds: ids });
  const [brief2] = await sql`select result->'reuse' as reuse from mkt_briefs where content_id = ${c.id} order by created_at desc limit 1`;
  assert.ok(brief2.reuse.photos.includes(cafe1), JSON.stringify(brief2.reuse)); assert.ok(!brief2.reuse.photos.includes(park));
  await sql`update mkt_briefs set status = 'failed' where content_id = ${c.id}`;
});
