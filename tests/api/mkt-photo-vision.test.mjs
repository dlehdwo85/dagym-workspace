// #235 ⓒ(대표 #563 "자료실 사진을 AI가 보고 설명·태그를 단다 — 글자 든 홍보물 판정 포함. 사진 고르기와 블로그 사진 설명에 쓴다")
// 사진마다 한 번 설명(줄인 JPEG·빠른 모델·원가 기록) · 숫자·목록 API · 관리자만 설명·판정 고치기 · 실패는 사진에 남기고 일시 장애는 멈춤
// · 시안 바탕 = 고른 사진 + AI 가 '글자 없는 실사'로 본 사진(얼굴 보이면 빼고) · 블로그 본문 = 홍보물·그래픽 빼고 · 원고 재료 사진 목록 = AI 설명
// · 마케팅 사진을 올리면 응답 뒤에 설명 — 구조 시험(가짜 AI·시험 저장소). 실제 AI 판정 품질은 운영에서
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { BASE, FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake, br; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const V = (o) => ({ caption: '실내 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'little', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
const jpeg = (r, g, b) => sharp({ create: { width: 64, height: 48, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
let minutes = 60;
async function libFile(name, { tags = [], space = 'marketing' } = {}) {
  const data = await jpeg(40 + minutes, 120, 160);
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, created_at)
    values ('default', ${space}, '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${tags}, now() - ${`${minutes--} minutes`}::interval) returning id`;
  const key = `lib/default/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
const describe = async (id, answer, c = ctx.owner) => { await ctl({ visionQueue: [answer] }); return c.ok('POST', '/api/marketing/photos/describe', { ids: [id], redo: true }); };
const vis = async (id) => (await sql`select vision, description, tags from library_files where id = ${id}`)[0];
async function slot(brandId, { channel = 'instagram', kind = 'feed', day = 3, hour = 10, ago = 1 } = {}) {
  const at = new Date(Date.now() + day * 864e5); at.setUTCHours(hour - 9, 0, 0, 0);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produce_at)
    values ('default', ${brandId}, '자동 칸', ${channel}, ${kind}, ${at}, 'draft', 0, ${ctx.ownerId}, true, now() - ${`${ago} minutes`}::interval) returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.quality, v.media_ids from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: false });
  br = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '사진짐' });
  await ctx.owner.ok('POST', '/api/marketing/brands', { name: '옆동네짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${br.id}`, { intro: '동네 헬스장', products: '1개월 회원권' });
  P.clean = await libFile('사진짐 매장 1.jpg');
  P.promo = await libFile('IMG_0002.jpg');
  P.face = await libFile('IMG_0003.jpg');
  P.other = await libFile('IMG_0004.jpg');
  P.named = await libFile('썸네일 원본.jpg');
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('사진 설명: 줄인 JPEG·빠른 모델로 한 번 · 저장(설명이 비어 있으면 자료실 설명에도) · 원가 기록 · 관리자만 · 다른 회사 사진 404 · 판정 고치기', async () => {
  const v0 = fake.state.vision.length;
  const r = await describe(P.clean, V({ caption: '러닝머신이 줄지어 선 매장 안', scene: '아침 매장 안쪽. 러닝머신 여섯 대가 창가에 서 있습니다.', tags: ['러닝머신', '매장', '#창가'], text: 'none' }));
  assert.equal(r.done, 1);
  const req = fake.state.vision[v0];
  const img = req.messages[0].content.find((b) => b.type === 'image');
  assert.equal(img.source.media_type, 'image/jpeg');
  assert.ok(req.messages[0].content.some((b) => b.type === 'text' && b.text.includes('사진짐 매장 1.jpg')));
  assert.match(String(req.system), /글자가 든 홍보물/);
  const a = await vis(P.clean);
  assert.equal(a.vision.caption, '러닝머신이 줄지어 선 매장 안'); assert.deepEqual(a.vision.tags, ['러닝머신', '매장', '창가']);
  assert.equal(a.vision.text, 'none'); assert.equal(a.description, '러닝머신이 줄지어 선 매장 안', '설명이 비어 있던 자료는 한 줄 설명으로');
  const [u] = await sql`select count(*)::int n, sum(input_tokens)::int i from ai_usage where purpose = 'marketing_vision'`;
  assert.deepEqual([u.n, u.i], [1, 1600]);
  await describe(P.promo, V({ caption: '할인 이벤트 포스터', kind: 'graphic', text: 'much', promo: true, seen: '사진짐 10월 이벤트' }));
  await describe(P.face, V({ caption: '트레이너가 회원에게 자세를 알려 주는 모습', faces: true, people: 2, seen: '사진짐' }));
  await describe(P.other, V({ caption: '다른 매장 간판', text: 'none', seen: '옆동네짐' }));
  await describe(P.named, V({ caption: '창가 벤치', text: 'none' }));
  // 숫자·목록: 바탕 = AI 가 글자 없는 실사로 본 사진(얼굴 보이면 뺌·이름 규칙 '썸네일'은 그래픽), 쓰지 않음 = 홍보물 + 이름 규칙
  const view = await ctx.owner.ok('GET', '/api/marketing/photos');
  assert.deepEqual([view.total, view.described, view.pending, view.failed, view.cover, view.graphic, view.canEdit], [5, 5, 0, 0, 2, 2, true]);
  const it = Object.fromEntries(view.items.map((x) => [x.id, x]));
  assert.deepEqual([it[P.clean].cover, it[P.other].cover, it[P.face].cover, it[P.face].body, it[P.promo].body, it[P.named].body], [true, true, false, true, false, false]);
  assert.ok(view.perPhotoKrw > 0 && view.perPhotoKrw < 5, `사진 1장 원가 ${view.perPhotoKrw}원`);
  // 직원(마케팅 공간 멤버): 보기만
  const sv = await ctx.staffA.client.ok('GET', '/api/marketing/photos');
  assert.equal(sv.canEdit, false);
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/photos/describe', {})).status, 403);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/photos/${P.face}`, { text: 'none' })).status, 403);
  // 판정 고치기: 얼굴 보이는 사진을 '글자 없음' = 바탕으로 씀 · 깨끗한 사진을 '글자 있음' = 바탕에서만 뺌(로컬 10/25: 본문에는 씀) · '쓰지 않음' = 바탕·본문 모두 뺌 · 'auto' = 되돌림
  assert.deepEqual((await ctx.owner.ok('PATCH', `/api/marketing/photos/${P.face}`, { text: 'none' })).tags, ['글자없음']);
  await ctx.owner.ok('PATCH', `/api/marketing/photos/${P.clean}`, { text: 'has' });
  const v2 = Object.fromEntries((await ctx.owner.ok('GET', '/api/marketing/photos')).items.map((x) => [x.id, x]));
  assert.deepEqual([v2[P.face].cover, v2[P.face].mark, v2[P.clean].cover, v2[P.clean].body, v2[P.clean].mark], [true, 'none', false, true, 'has']);
  assert.deepEqual((await ctx.owner.ok('PATCH', `/api/marketing/photos/${P.clean}`, { text: 'skip' })).tags, ['쓰지않음']);
  const v3 = Object.fromEntries((await ctx.owner.ok('GET', '/api/marketing/photos')).items.map((x) => [x.id, x]));
  assert.deepEqual([v3[P.clean].cover, v3[P.clean].body, v3[P.clean].mark], [false, false, 'skip']);
  await ctx.owner.ok('PATCH', `/api/marketing/photos/${P.face}`, { text: 'auto' });
  await ctx.owner.ok('PATCH', `/api/marketing/photos/${P.clean}`, { text: 'auto' });
  assert.deepEqual([(await vis(P.face)).tags, (await vis(P.clean)).tags], [[], []]);
  // 다른 회사·없는 사진·마케팅 공간이 아닌 사진 = 404
  const [t2] = await sql`insert into tenants (id, name) values ('pv-other', '다른회사') on conflict (id) do update set name = excluded.name returning id`;
  const [o] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source) values (${t2.id}, 'marketing', '', 'x', 'x.jpg', 'image/jpeg', 10, ${ctx.ownerId}, 'ready', 'upload') returning id`;
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/photos/${o.id}`, { text: 'none' })).status, 404);
  assert.equal((await ctx.owner.req('PATCH', '/api/marketing/photos/00000000-0000-4000-8000-000000000000', { text: 'none' })).status, 404);
  const work = await libFile('업무 사진.jpg', { space: 'work' });
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/photos/${work}`, { text: 'none' })).status, 404);
  assert.equal((await ctx.owner.ok('POST', '/api/marketing/photos/describe', { ids: [work], redo: true })).done, 0, '업무 공간 사진은 설명하지 않음');
});

test('설명 못 함은 사진에 남김(세 번까지·1시간 뒤 다시) · 일시 장애는 사진 탓으로 남기지 않고 멈춤 · [설명하기]는 설명 없는 사진만', async () => {
  const bad = await libFile('IMG_0099.jpg');
  const r1 = await describe(bad, { httpError: 400, errorType: 'invalid_request_error', message: 'Could not process image' });
  assert.equal(r1.failed, 1);
  const a = await vis(bad);
  assert.match(a.vision.error, /AI 설명 실패/); assert.equal(a.vision.tries, 1);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/photos')).failed, 1);
  // 1시간이 안 지난 실패는 [설명하기]가 건너뜀 → 할 일 없음
  const r2 = await ctx.owner.ok('POST', '/api/marketing/photos/describe', {});
  assert.deepEqual([r2.done, r2.failed], [0, 0]);
  // 1시간 지난 실패 + 새 사진 → 다시 설명(기본 답)
  await sql`update library_files set vision = jsonb_set(vision, '{at}', to_jsonb((now() - interval '2 hours')::text)) where id = ${bad}`;
  const fresh = await libFile('IMG_0100.jpg');
  const r3 = await ctx.owner.ok('POST', '/api/marketing/photos/describe', {});
  assert.deepEqual([r3.done, r3.failed, r3.left, r3.stopped], [2, 0, 0, null]);
  assert.equal((await vis(fresh)).vision.caption, '실내를 찍은 사진');
  assert.equal((await vis(bad)).vision.caption, '실내를 찍은 사진');
  // 서버 불안정(재시도까지 529) = 멈춤, 사진에는 실패를 남기지 않음
  const later = await libFile('IMG_0101.jpg');
  await ctl({ visionQueue: [{ httpError: 529, errorType: 'overloaded_error', message: 'Overloaded' }, { httpError: 529, errorType: 'overloaded_error', message: 'Overloaded' }, { httpError: 529, errorType: 'overloaded_error', message: 'Overloaded' }] });
  const r4 = await ctx.owner.ok('POST', '/api/marketing/photos/describe', {});
  assert.match(r4.stopped ?? '', /불안정/);
  assert.equal((await vis(later)).vision, null);
  await ctl({ anthropicReset: true });
  await ctx.owner.ok('POST', '/api/marketing/photos/describe', {});
  assert.equal((await vis(later)).vision.caption, '실내를 찍은 사진');
});

test('쓰임: 피드 시안 바탕 = AI 가 글자 없는 실사로 본 이 브랜드 사진 · 블로그 본문 = 홍보물·이름 규칙 그래픽·다른 브랜드 빼고 · 원고 재료 사진 목록 = AI 설명', async () => {
  const feed = await slot(br.id, { channel: 'instagram', kind: 'feed', day: 4, hour: 10, ago: 5 });
  const blog = await slot(br.id, { channel: 'blog', kind: 'blog', day: 4, hour: 13, ago: 4 });
  const n0 = fake.state.anthropic.length;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const f = await cur(feed); const b = await cur(blog);
  assert.equal(f.quality.visual.photoId, P.clean, '바탕 = 글자 없는 실사(폴더·태그로 고르지 않았어도)');
  assert.equal(b.media_ids.length, 4, '요청 C: 블로그 = 표지 + 본문 실사 1장 + 도표형 카드 2장(표지+3장)');
  assert.equal(b.media_ids[1], P.face, '본문 = 홍보물·그래픽·다른 브랜드 빼고 이 브랜드 사진');
  const prompts = fake.state.anthropic.slice(n0).map((x) => JSON.stringify(x.body));
  assert.ok(prompts.some((p) => p.includes('AI 사진 설명') && p.includes('러닝머신이 줄지어 선 매장 안') && p.includes('트레이너가 회원에게 자세를 알려 주는 모습')), '원고 재료에 AI 사진 설명');
  assert.ok(!prompts.some((p) => p.includes('할인 이벤트 포스터') || p.includes('다른 매장 간판') || p.includes('창가 벤치')), '홍보물·다른 브랜드·이름 규칙 그래픽은 재료에서 뺌');
  // 사람이 '글자 있음'으로 고치면 바탕에서 빠짐 → 브랜드 색 바탕
  await ctx.owner.ok('PATCH', `/api/marketing/photos/${P.clean}`, { text: 'has' });
  const feed2 = await slot(br.id, { channel: 'instagram', kind: 'feed', day: 6, hour: 10, ago: 2 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.notEqual((await cur(feed2)).quality.visual.photoId, P.clean);
  await ctx.owner.ok('PATCH', `/api/marketing/photos/${P.clean}`, { text: 'auto' });
});

test('마케팅 사진을 올리면 응답 뒤에 설명(업무 공간 사진은 안 함) · 자료실 목록에 AI 사진 설명', async () => {
  const up = async (name, space) => {
    const data = await jpeg(200, 80, 40);
    const r = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'image/jpeg', size: data.length, folder: '마케팅', ...(space ? { space } : {}) });
    await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body: data });
    await ctx.owner.ok('POST', `/api/library/${r.id}/complete`);
    return r.id;
  };
  const v0 = fake.state.vision.length;
  await ctl({ visionQueue: [V({ caption: '새로 올린 매장 입구 사진', text: 'none' })] });
  const id = await up('입구.jpg', 'marketing');
  let v = null;
  for (let k = 0; k < 40 && !v?.caption; k++) { await new Promise((r) => setTimeout(r, 250)); v = (await vis(id)).vision; }
  assert.equal(v?.caption, '새로 올린 매장 입구 사진');
  const w = await up('회의.jpg');
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await vis(w)).vision, null, '업무 공간 사진은 설명하지 않음');
  assert.equal(fake.state.vision.length, v0 + 1);
  const lib = await ctx.owner.ok('GET', '/api/library?folder=*');
  assert.equal(lib.files.find((x) => x.id === id)?.vision?.caption, '새로 올린 매장 입구 사진');
});
