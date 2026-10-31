// 288차 #814-2(대표 10/31 "브랜드 사진 폴더 밖 사진은 못 쓰게 · 워크인은 앱 화면 녹화·캡처만", 로컬 14:30: 워크인 블로그 본문에 다짐 현장 사진):
// 브랜드 키트 '시안에 쓸 사진' — brand(기본) = 브랜드가 둘 이상인 회사는 이 브랜드 이름(다른 표기 포함)이 폴더·이름·태그·설명·AI 설명(영상 장면은 원본 영상)에 든 사진만 ·
// screen = 실사 안 씀(표지 브랜드 색·블로그 본문은 이 브랜드 화면 캡처) · any = 예전처럼. 승인 대기 글 다시 검사도 같은 규칙으로 바꿈(맞는 사진이 없으면 줄을 빼고 도표형 카드). 구조 시험(가짜 AI)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const B = {}; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const V = (o) => ({ caption: '매장 안 사진', scene: '매장 안 모습입니다.', tags: ['매장'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
const textured = (seed) => { const w = 320, h = 240; const b = randomBytes(w * h * 3); b[0] = seed; return sharp(b, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer(); };
let minutes = 90;
async function libFile(name, { folder = '마케팅/사진', mime = 'image/jpeg', data } = {}) {
  data ??= await textured(minutes);
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, created_at)
    values ('default', 'marketing', ${folder}, ${name}, ${name}, ${mime}, ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${[]}, now() - ${`${minutes--} minutes`}::interval) returning id`;
  const key = `lib/default/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
const describe = async (id, answer) => { await ctl({ visionQueue: [answer] }); return ctx.owner.ok('POST', '/api/marketing/photos/describe', { ids: [id], redo: true }); };
async function slot(brandId, title, { kind = 'feed', channel = 'instagram', day = 2, ago = 1 } = {}) {
  const at = new Date(Date.now() + day * 864e5); at.setUTCHours(1, 0, 0, 0);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produce_at)
    values ('default', ${brandId}, ${title}, ${channel}, ${kind}, ${at}, 'draft', 0, ${ctx.ownerId}, true, now() - ${`${ago} minutes`}::interval) returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.quality, c.current_version, v.media_ids, v.note, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: false });
  B.ga = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '가나짐' });
  B.app = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '일앱' });
  for (const b of [B.ga, B.app]) await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b.id}`, { intro: '소개', products: '상품' });
  // 가나짐: 이름 든 사진 · 브랜드 폴더 사진 · 원본 영상이 브랜드 폴더인 영상 장면 / 이름 없는 사진(가장 최근, 글과 낱말이 가장 잘 맞음) / 일앱 화면 캡처
  P.named = await libFile('가나짐 매장 러닝머신.jpg'); await describe(P.named, V({ caption: '러닝머신이 있는 매장', tags: ['러닝머신'] }));
  P.folder = await libFile('매장 덤벨 구역.jpg', { folder: '마케팅/가나짐' }); await describe(P.folder, V({ caption: '덤벨이 놓인 구역', tags: ['덤벨'] }));
  const vid = await libFile('가나짐 매장 소개.mp4', { mime: 'video/mp4', data: Buffer.from('not a real video') });
  P.frame = await libFile('매장 소개 — 장면 1.jpg', { folder: '마케팅/영상 장면' });
  await sql`update library_files set source = 'video_frame', meta = ${sql.json({ video: { id: vid, at: 2, title: '가나짐 매장 소개' } })} where id = ${P.frame}`;
  await describe(P.frame, V({ caption: '매장 입구', tags: ['입구'] }));
  P.cap = await libFile('일앱 일정 화면.jpg', { folder: '마케팅/영상 화면 캡처' }); await describe(P.cap, V({ caption: '일정 앱 화면', kind: 'screen', text: 'much', tags: ['앱', '일정'] }));
  P.unnamed = await libFile('스피닝 자전거 수업 안내.jpg'); await describe(P.unnamed, V({ caption: '스피닝 자전거가 늘어선 수업 공간', tags: ['스피닝', '자전거', '수업', '안내'] }));
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('브랜드별 쓸 수 있는 사진 수: 이름·폴더·영상 장면(원본 영상 이름)으로 셈 · 어느 브랜드 이름도 없는 실사 수', async () => {
  const v = await ctx.owner.ok('GET', '/api/marketing/photos');
  const ga = v.brands.list.find((b) => b.name === '가나짐'); const app = v.brands.list.find((b) => b.name === '일앱');
  assert.deepEqual([ga.src, ga.strict, ga.photos, app.photos, app.captures], ['brand', true, 3, 0, 1], JSON.stringify(v.brands));
  assert.equal(v.brands.unnamed, 1); assert.equal(v.brands.strict, true);
});

test('기본(이 브랜드 사진만): 글과 더 잘 맞는 이름 없는 최근 사진 대신 이 브랜드 사진 · 예전 방식(any)으로 바꾸면 이름 없는 사진도 씀', async () => {
  const c1 = await slot(B.ga.id, '스피닝 자전거 수업 안내', { ago: 5 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const a = await cur(c1);
  assert.ok([P.named, P.folder, P.frame].includes(a.quality.visual.photoId), `이 브랜드 사진만 ${JSON.stringify(a.quality.visual)}`);
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${B.ga.id}`, { video: { photoSource: 'any' } });
  const c2 = await slot(B.ga.id, '스피닝 자전거 수업 안내 2', { day: 3, ago: 4 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal((await cur(c2)).quality.visual.photoId, P.unnamed, '예전 방식은 이름 없는 사진도');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${B.ga.id}`, { video: { photoSource: 'brand' } });
});

test("앱 화면 캡처만(screen): 블로그 표지는 사진 없이(브랜드 색) · 본문은 이 브랜드 화면 캡처 · 실사는 안 씀", async () => {
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${B.app.id}`, { video: { photoSource: 'screen' } });
  const bl = await slot(B.app.id, '일정 앱으로 하루 정리', { kind: 'blog', channel: 'blog', ago: 3 });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const b = await cur(bl);
  assert.ok(b, 'blog drafted');
  assert.equal(b.quality.visual.photoId ?? null, null, '표지는 브랜드 색');
  const tail = b.media_ids.slice(1);
  assert.ok(tail.includes(P.cap), `본문에 화면 캡처 ${JSON.stringify(tail)}`);
  assert.ok(![P.named, P.folder, P.frame, P.unnamed].some((x) => tail.includes(x)), '실사는 안 씀');
});

test('승인 대기 블로그 다시 검사: 브랜드 밖 본문 사진은 이 브랜드 사진으로 바꾸고, 맞는 사진이 없으면 그 줄을 빼고 번호를 당김(도표형 카드로 채움)', async () => {
  const drawn = async (name, meta = {}) => { const id = await libFile(name); await sql`update library_files set source = 'ai', folder = '마케팅/자동 시안', meta = ${sql.json(meta)} where id = ${id}`; return id; };
  // 가나짐 글: 본문에 이름 없는 사진 → 가나짐 사진으로(앞 시험 카드뉴스 장이 가나짐 사진 셋을 다 써서 — 가까운 글 사진은 안 씀 — 새 사진 한 장)
  const fresh = await libFile('가나짐 러닝머신 존.jpg'); await describe(fresh, V({ caption: '러닝머신이 늘어선 공간', tags: ['러닝머신'] }));
  const cover = await drawn('가나짐 블로그 표지.jpg', { photoId: null });
  const at = new Date(Date.now() + 2 * 864e5 + 3 * 3600e3);
  const body = '운동 공간을 소개합니다.\n\n[사진 1] 스피닝 자전거가 늘어선 수업 공간\n\n러닝머신도 넉넉합니다.\n\n상담은 언제든 문의 주세요.';
  const [g] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
    values ('default', ${B.ga.id}, '러닝머신 공간 소개', 'blog', 'blog', ${at}, 'pending', 1, ${ctx.ownerId}, true, ${sql.json({ visual: { by: 'server', fileId: cover, photoId: null, rv: 6 } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${g.id}, 1, ${body}, ${[cover, P.unnamed]}, '시안', ${ctx.ownerId})`;
  // 일앱 글(화면 캡처만): 본문 실사 2장 → 캡처 1장으로 바꾸고 남은 자리는 줄을 빼고 번호 당김(앞 시험 블로그가 쓴 캡처는 가까운 글 사진이라 안 씀)
  const cap2 = await libFile('일앱 할 일 화면.jpg', { folder: '마케팅/영상 화면 캡처' }); await describe(cap2, V({ caption: '할 일 앱 화면', kind: 'screen', text: 'much', tags: ['앱', '할 일'] }));
  const cover2 = await drawn('일앱 블로그 표지.jpg', { photoId: null });
  const body2 = '앱 사용법입니다.\n\n[사진 1] 러닝머신이 있는 매장\n\n일정을 이렇게 봅니다.\n\n[사진 2] 덤벨이 놓인 구역\n\n끝.';
  const [w] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
    values ('default', ${B.app.id}, '일정 화면 보기', 'blog', 'blog', ${new Date(at.getTime() + 3600e3)}, 'pending', 1, ${ctx.ownerId}, true, ${sql.json({ visual: { by: 'server', fileId: cover2, photoId: null, rv: 6 } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${w.id}, 1, ${body2}, ${[cover2, P.named, P.folder]}, '시안', ${ctx.ownerId})`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const a = await cur(g.id);
  assert.equal(a.current_version, 2, JSON.stringify(a.quality));
  assert.deepEqual(a.media_ids, [cover, fresh], '이 브랜드 새 사진으로');
  assert.match(a.body, /\[사진 1\] 러닝머신이 늘어선 공간/);
  assert.match(a.note, /브랜드 밖 본문 사진 1장 바꿈/);
  const b = await cur(w.id);
  assert.equal(b.current_version, 2, JSON.stringify(b.quality));
  assert.equal(b.media_ids[1], cap2, '화면 캡처로');
  assert.ok(![P.named, P.folder].some((x) => b.media_ids.includes(x)), '실사는 빠짐');
  assert.match(b.body, /\[사진 1\] 할 일 앱 화면/); assert.ok(!/\[사진 2\]/.test(b.body), '맞는 사진이 없는 줄은 빠짐'); assert.match(b.body, /일정을 이렇게 봅니다/);
  assert.match(b.note, /브랜드 밖 본문 사진 2장 바꿈/);
  const n = await sql`select body from notifications where entity_id = ${w.id} and title like '시안을 다시 그렸습니다%'`;
  assert.match(n[0]?.body ?? '', /이 브랜드 사진이 아니어서/);
});

// 289차 #814-2 '다시 만든 시안이 수정 요청을 반영했는지 확인 단계': 사진 요청(다른 브랜드·흔들림·얼굴·중복·문구와 사진 불일치·단색 바탕)은 수정본에 쓴 사진을 세어 판정(AI 호출 없음)
async function pendingBlog(brandId, title, body, media, visual, hours) {
  const at = new Date(Date.now() + 2 * 864e5 + hours * 3600e3);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
    values ('default', ${brandId}, ${title}, 'blog', 'blog', ${at}, 'pending', 1, ${ctx.ownerId}, true, ${sql.json({ visual: { by: 'server', rv: 7, ...visual } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${body}, ${media}, '시안', ${ctx.ownerId})`;
  return c.id;
}
const drawnCover = async (name) => { const id = await libFile(name); await sql`update library_files set source = 'ai', folder = '마케팅/자동 시안', meta = '{"photoId":null}' where id = ${id}`; return id; };
const lastRev = async (id) => (await sql`select v.revision, v.note, v.media_ids, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];

test("289차 수정 요청 '다른 브랜드 사진 쓰지 마세요' → 글은 그대로, 본문 사진까지 이 브랜드 사진으로 바꾸고 확인 = 반영(이 브랜드 사진만 씀)", async () => {
  const yoga = await libFile('가나짐 요가 매트 공간.jpg'); await describe(yoga, V({ caption: '요가 매트가 깔린 공간', tags: ['요가', '매트'] }));
  const mat = await libFile('가나짐 매트 스트레칭.jpg'); await describe(mat, V({ caption: '매트 위에서 스트레칭', tags: ['매트', '스트레칭'] })); // 표지가 요가 사진을 쓰면 본문은 이 사진(앞 시험들이 가나짐 사진을 가까운 글에 다 씀)
  const cover = await drawnCover('가나짐 요가 표지.jpg');
  const body = '요가 공간을 소개합니다.\n\n[사진 1] 스피닝 자전거가 늘어선 수업 공간\n\n매트가 넉넉합니다.';
  const id = await pendingBlog(B.ga.id, '요가 매트 공간 소개', body, [cover, P.unnamed], { fileId: cover, photoId: null }, 6);
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'changes', comment: '다른 브랜드 사진 쓰지 마세요' });
  assert.ok(r.revision?.version, JSON.stringify(r.revision));
  const v = await lastRev(id);
  assert.ok(!v.media_ids.includes(P.unnamed), `이름 없는(다른 브랜드) 본문 사진은 빠짐 ${JSON.stringify(v.media_ids)}`);
  const [cv] = await sql`select quality->'visual'->>'photoId' as p from mkt_contents where id = ${id}`;
  const [np] = await sql`select f.title, f.folder, f.vision->>'caption' as caption, (select pv.title from library_files pv where pv.id::text = f.meta->'video'->>'id') as parent from library_files f where f.id = ${v.media_ids[1]}`;
  assert.ok(`${np.title} ${np.folder} ${np.parent ?? ''}`.includes('가나짐'), `이 브랜드 사진 ${JSON.stringify(np)}`);
  assert.notEqual(v.media_ids[1], cv.p, '표지에 쓴 사진과 다른 사진');
  assert.ok(v.body.includes(`[사진 1] ${np.caption}`), v.body); assert.match(v.body, /매트가 넉넉합니다/);
  assert.ok([yoga, mat].includes(v.media_ids[1]));
  assert.match(v.note, /브랜드 밖 본문 사진 1장 바꿈/);
  assert.equal(v.revision.check.status, 'applied', JSON.stringify(v.revision.check)); assert.match(v.revision.check.detail, /이 브랜드 사진만 씀/);
});

test("289차 수정 요청 '얼굴 모자이크' — 얼굴 위치를 모르는 예전 사진이 남으면 확인 = 반영 안 됨/일부 + [얼굴 위치 다시 읽기] 안내", async () => {
  const face = await libFile('가나짐 회원 운동.jpg'); await describe(face, V({ caption: '회원이 운동하는 모습', tags: ['회원'], faces: true, people: 1 })); // face_boxes 없음 = 286차 전 설명
  const cover = await drawnCover('가나짐 회원 표지.jpg');
  const id = await pendingBlog(B.ga.id, '회원 운동 이야기', '회원 이야기입니다.\n\n[사진 1] 회원이 운동하는 모습\n\n끝.', [cover, face], { fileId: cover, photoId: null }, 7);
  await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'changes', comment: '사람 얼굴은 모자이크 해 주세요' });
  const v = await lastRev(id);
  assert.ok(['unmet', 'partial'].includes(v.revision.check.status), JSON.stringify(v.revision.check));
  assert.match(v.revision.check.detail, /얼굴 위치를 몰라 못 가린 사진 1장/);
});

