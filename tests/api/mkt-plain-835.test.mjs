// 295차 #835(대표 10/31 '배경 단색에 글자 하나 툭 놓고 단조롭다 · 레퍼런스대로 · 사진이 별로면 제작하거나 요청'):
// ① 피드 표지가 단색 바탕 + 글자뿐이면 승인함 대신 수정 요청(사유 줄) · 알림 '표지 사진 필요'
// ② 같은 브랜드 실사를 참고해 표지 칸을 생성(빈 칸 채우기에 표지 포함) → 사진 틀로 다시 그려 승인 대기 + 알림
// ③ 키트 틀이 단색 틀뿐이어도 사진이 있으면 공통 사진 틀로 그림 · 예전 규칙으로 그린 단색 표지(rv 7)는 한 번 다시 그림(사진 없으면 '단색' 표시만, 되풀이 없음)
// ④ 레퍼런스 대조표 API(승인 대기·수정 요청 × 기준 항목) · 마케팅 공간 밖 사람은 못 봄
// 가짜 AI·가짜 생성 서버로만 시험 — 실제 생성·과금 없음, 그림 모양은 운영 화면에서
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
const CARD = { kicker: '운동 소식', kickerAlts: [], points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '', scene: '', tags: [], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', pose: 'none', facing: 'none', light: 'bright', ...o });
const photo = () => sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 90, g: 140, b: 120 } } })
  .composite([{ input: { create: { width: 1200, height: 750, channels: 3, background: { r: 210, g: 200, b: 180 } } }, left: 0, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
async function lib(name, data, { folder = '마케팅/사진', vision = null, source = 'upload', tags = ['글자없음'], meta = {} } = {}) {
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision, meta)
    values ('default', 'marketing', ${folder}, ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', ${source}, ${tags}, ${vision ? sql.json(vision) : null}, ${sql.json(meta)}) returning id`;
  const key = `lib/default/${f.id}/${f.id}.jpg`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
const day = (n, h = 0) => new Date(Date.now() + n * 864e5 + h * 3600e3);
async function slot(brand, title, at) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${brand}, ${title}, 'instagram', ${at}, 'draft', 0, ${ctx.ownerId}, 'feed', true, now(), false, ${[]}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const SLIDES = (cover) => [{ role: 'cover', title: cover, body: '' }, { role: 'problem', title: '저녁엔 붐벼요', body: '퇴근 뒤 사람이 몰려요' }, { role: 'solution', title: '아침 시간 추천', body: '7시 전엔 한산해요' },
  { role: 'proof', title: '넓어진 공간', body: '기구 사이가 넓어졌어요' }, { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }];
async function produce(id, title) {
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where tenant = 'default' and status = 'draft' and produced_at is null and id <> ${id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title, body: `${title}\n가볍게 들러 보세요.\n문의 032-111-2222\n#운동 #헬스`, brief: '', why: '', hooks: [], keyword: '', card: CARD, slides: SLIDES(title) })] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === id && !p.error), JSON.stringify(run.produced));
  return cur(id);
}
const PLAIN_KIT = { style: 'product', templates: ['title', 'statement', 'report'], palette: { bg: '#0c776d', accent: '#f5c400' }, header: '', contact: '', kicker: '' };

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, autoHold: false });
  P.plain = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '단색짐' })).id;
  P.old = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '옛표지짐' })).id;
  P.none = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '사진없는짐' })).id;
  for (const b of [P.plain, P.old, P.none]) await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b}`, { intro: '동네 운동 공간', products: '1개월 회원권', facts: { phone: '032-111-2222' }, feed: PLAIN_KIT });
  const s0 = await ctx.owner.ok('GET', '/api/platform/higgsfield');
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf`, models: s0.models.map((m) => (m.id === 'higgsfield-ai/soul/v2/standard' ? { ...m, ref: 'image_url' } : m)) });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('295차 ① 단색 틀뿐 + 실사 없음 → 수정 요청(사유) · ② 실사가 생기면 표지 칸 생성 → 사진 틀로 다시 그려 승인 대기 + 알림', async () => {
  const id = await slot(P.plain, '단색짐 아침 운동 소식', day(3));
  const c1 = await produce(id, '아침 운동 소식');
  assert.equal(c1.status, 'changes', JSON.stringify(c1.quality.issues));
  assert.ok(['title', 'statement', 'report'].includes(c1.quality.visual.template), c1.quality.visual.template);
  assert.equal(c1.quality.visual.plain, true);
  assert.ok(c1.quality.issues.some((x) => /^표지가 단색 바탕 \+ 글자뿐/.test(x)), JSON.stringify(c1.quality.issues));
  const [n] = await sql`select title from notifications where entity_id = ${id} order by created_at desc limit 1`;
  assert.match(n?.title ?? '', /^표지 사진 필요: /);
  P.plainId = id;
  // 실사가 생김 → 빈 칸 채우기(관리자 버튼)에 표지 칸이 들어감 → 생성 → 사진 틀(키트에 없으면 공통 사진 틀)로 다시 그림
  P.ref = await lib('단색짐 매장 전경.jpg', await photo(), { vision: V({ caption: '밝은 매장 전경', tags: ['매장', '전경'] }) });
  const d0 = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.equal(d0.fill.empty, 4, `표지 1 + 장 3(행동 장 빼고) → ${JSON.stringify(d0.fill)}`);
  await ctl({ hfReset: true, hfPolls: 0, hfMode: null });
  const f1 = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/fill`, {});
  assert.equal(f1.status, 'generating', JSON.stringify(f1));
  assert.equal(f1.total, 3, `296차: 5장 중 절반(3장)이 되게 — 표지 1 + 장 2 (${JSON.stringify(f1)})`);
  const f2 = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/fill`, { action: 'check' });
  assert.equal(f2.status, 'done', JSON.stringify(f2));
  const c2 = await cur(id);
  assert.equal(c2.status, 'pending', JSON.stringify(c2.quality.issues));
  assert.ok(!c2.quality.issues.some((x) => /단색 바탕/.test(x)));
  assert.equal(c2.quality.visual.plain, undefined);
  assert.equal(c2.quality.visual.gen, true);
  assert.ok(['photo_fade', 'photo_dim'].includes(c2.quality.visual.template), `공통 사진 틀: ${c2.quality.visual.template}`);
  assert.notEqual(c2.media_ids[0], c1.media_ids[0], '표지를 새로 그림');
  const [n2] = await sql`select title, body from notifications where entity_id = ${id} and title like '표지 사진을 채웠습니다%'`;
  assert.match(n2?.body ?? '', /단색 바탕 표지를/);
});

test('295차 ③ 단색 틀 키트여도 실사가 있으면 공통 사진 틀로 · 예전 단색 표지(rv 7)는 한 번 다시 그림, 사진 없는 브랜드는 단색 표시만(되풀이 없음)', async () => {
  // 실사가 있는 브랜드 — 새 자동 제작은 바로 사진 틀
  P.oldPhoto = await lib('옛표지짐 운동 공간.jpg', await photo(), { vision: V({ caption: '운동 기구가 놓인 넓은 공간', tags: ['기구', '공간'] }) });
  const fresh = await produce(await slot(P.old, '옛표지짐 새 기구 소식', day(4)), '새 기구 소식');
  assert.equal(fresh.status, 'pending', JSON.stringify(fresh.quality.issues));
  assert.ok(['photo_fade', 'photo_dim'].includes(fresh.quality.visual.template), fresh.quality.visual.template);
  assert.equal(fresh.quality.visual.photoId, P.oldPhoto);
  // 예전 규칙으로 그린 단색 표지 두 개(rv 7): 실사 있는 브랜드 · 사진 없는 브랜드
  const mk = async (brand, title, at) => {
    const cover = await lib(`${title} 표지.jpg`, await photo(), { folder: '마케팅/자동 시안', source: 'ai', tags: ['자동 시안'], meta: { photoId: null } });
    const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
      values ('default', ${brand}, ${title}, 'instagram', 'feed', ${at}, 'pending', 1, ${ctx.ownerId}, true, ${sql.json({ passed: true, issues: [], visual: { by: 'server', fileId: cover, photoId: null, template: 'title', rv: 7 } })}) returning id`;
    await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${`${title}\n아침에 오면 한산합니다.\n기구 사용법도 알려 드려요.\n문의 032-111-2222`}, ${[cover]}, '시안', ${ctx.ownerId})`;
    return c.id;
  };
  // 가까운 글(위 새 글)에 쓴 사진은 겹침 금지로 빠지므로 한 장 더
  P.oldPhoto2 = await lib('옛표지짐 스트레칭 구역.jpg', await photo(), { vision: V({ caption: '매트가 깔린 스트레칭 구역', tags: ['매트', '스트레칭'] }) });
  const a = await mk(P.old, '옛표지짐 주말 운영 안내', day(8));
  const b = await mk(P.none, '사진없는짐 주말 운영 안내', day(8, 2));
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const a1 = await cur(a);
  assert.equal(a1.current_version, 2, JSON.stringify(a1.quality));
  assert.ok(!['title', 'statement', 'report'].includes(a1.quality.visual.template), `사진·도표 틀로: ${a1.quality.visual.template}`);
  assert.equal(a1.quality.visual.photoId, P.oldPhoto2, '가까운 글과 겹치지 않는 사진');
  assert.match(a1.note, /단색 바탕 \+ 글자 표지 바꿈/);
  assert.equal(a1.status, 'pending');
  const b1 = await cur(b);
  assert.equal(b1.current_version, 2, '사진 없는 브랜드도 한 번은 다시 그림(새 규칙)');
  assert.equal(b1.status, 'changes'); assert.equal(b1.quality.visual.plain, true);
  assert.ok(b1.quality.issues.some((x) => /^표지가 단색 바탕/.test(x)));
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const b2 = await cur(b);
  assert.equal(b2.current_version, 2, '되풀이해 다시 그리지 않음');
  assert.equal(b2.quality.visual.rv, 8);
  P.b = b;
});

test('295차 ④ 레퍼런스 대조표: 승인 대기·수정 요청 글 × 기준 항목(표지·머리말·장 수·사진 장·마지막 장·첫 줄·해시태그·사진 검사) · 마케팅 공간 밖은 못 봄', async () => {
  const r = await ctx.owner.ok('GET', '/api/marketing/refcheck');
  const row = (id) => r.rows.find((x) => x.id === id);
  const plain = row(P.b);
  assert.ok(plain, JSON.stringify(r.rows.map((x) => x.title)));
  const it = (row, k) => row.items.find((i) => i.key === k);
  assert.equal(it(plain, 'cover').ok, false); assert.match(it(plain, 'cover').detail, /단색 바탕 \+ 글자/);
  assert.equal(plain.status, 'changes');
  const filled = row(P.plainId);
  assert.equal(it(filled, 'cover').ok, true, JSON.stringify(it(filled, 'cover'))); assert.match(it(filled, 'cover').detail, /실사 참고 생성/);
  assert.equal(it(filled, 'kicker').ok, true); assert.equal(it(filled, 'count').ok, true, it(filled, 'count').detail);
  assert.equal(it(filled, 'cta').ok, true); assert.equal(it(filled, 'tags').ok, true, it(filled, 'tags').detail);
  assert.ok(['hook', 'photoShare', 'audit'].every((k) => it(filled, k)), '항목 다 있음');
  assert.equal(it(filled, 'photoShare').ok, true, `296차 생성으로 사진 장 절반: ${it(filled, 'photoShare').detail}`);
  // 296차: 블로그 소제목은 원고 규칙(■ 4~6개, 최소 = 회사 설정 2) — 위 상한 없음
  const [bl] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
    values ('default', ${P.old}, '옛표지짐 블로그', 'blog', 'blog', now() + interval '6 days', 'pending', 1, ${ctx.ownerId}, true, ${sql.json({ visual: { by: 'server', fileId: null, photoId: null, rv: 8 } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${bl.id}, 1, ${['운동 공간 소개 글입니다', '', '■ 공간', '넓어요', '', '■ 기구', '많아요', '', '■ 수업', '있어요', '', '■ 시간', '아침', '', '■ 상담', '문의'].join('\n')}, array[gen_random_uuid()], '시안', ${ctx.ownerId})`;
  const r2 = await ctx.owner.ok('GET', '/api/marketing/refcheck');
  const blog = r2.rows.find((x) => x.id === bl.id);
  assert.deepEqual([it(blog, 'heads').ok, it(blog, 'heads').detail, it(blog, 'heads').label], [true, '5개', '소제목 ■ 2개+']);
  assert.equal(filled.total, filled.items.filter((i) => i.ok !== null).length);
  const cover = r.summary.find((s) => s.key === 'cover');
  assert.ok(cover && cover.fail >= 1 && cover.of >= 3, JSON.stringify(r.summary));
  assert.ok([403, 404].includes((await ctx.staffB.client.req('GET', '/api/marketing/refcheck')).status), '마케팅 공간 밖');
  const staff = await ctx.staffA.client.ok('GET', '/api/marketing/refcheck');
  assert.ok(staff.rows.length >= 3, '마케팅 공간 사람은 봄');
});
