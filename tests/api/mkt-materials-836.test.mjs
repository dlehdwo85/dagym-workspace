// 297차 #836(대표 10/31 '사진이나 자료를 업로드하는 걸 요청하는 요청 페이지 — AI 마케터가 요청할 자료가 있으면 더 높은 퀄리티', '촬영해서 받는 데 1주일'):
// ① 단색 표지로 막힌 피드가 생기면 AI 마케터가 그 브랜드에 자료 요청 1장(브랜드·종류마다 열린 것 하나) — 앱 화면 브랜드는 '앱 화면' 요청 · 담당·기한 7일·알림
// ② 목록(요청 중·받음·사용함) · 마케팅 공간 밖은 못 봄 · 만들기는 관리자만 · 취소는 관리자·담당만
// ③ 카드에서 올림 → 자료실 '마케팅/브랜드 자료/{브랜드}'·태그 → 받음 → 사진 설명 → 그 브랜드 단색 표지 글 다시 그림 → 시안에 쓰이면 '사용함'
// 가짜 AI 로만 시험 — 실제 AI·생성 호출 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { BASE, FAKE, addDays, bootstrap, ensureTls, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = { kicker: '운동 소식', kickerAlts: [], points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const SLIDES = (cover) => [{ role: 'cover', title: cover, body: '' }, { role: 'problem', title: '저녁엔 붐벼요', body: '퇴근 뒤 사람이 몰려요' }, { role: 'solution', title: '아침 시간 추천', body: '7시 전엔 한산해요' },
  { role: 'proof', title: '넓어진 공간', body: '기구 사이가 넓어졌어요' }, { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }];
const PLAIN_KIT = { style: 'product', templates: ['title', 'statement', 'report'], palette: { bg: '#0c776d', accent: '#f5c400' }, header: '', contact: '', kicker: '' };
const photo = () => sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 90, g: 140, b: 120 } } })
  .composite([{ input: { create: { width: 1200, height: 750, channels: 3, background: { r: 210, g: 200, b: 180 } } }, left: 0, top: 0 }]).jpeg({ quality: 92 }).toBuffer();
const day = (n) => new Date(Date.now() + n * 864e5);
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, v.media_ids from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
async function produce(brand, title) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${brand}, ${title}, 'instagram', ${day(4)}, 'draft', 0, ${ctx.ownerId}, 'feed', true, now(), false, ${[]}, 'content') returning id`;
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where tenant = 'default' and status = 'draft' and produced_at is null and id <> ${c.id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title, body: `${title}\n가볍게 들러 보세요.\n문의 032-111-2222\n#운동 #헬스`, brief: '', why: '', hooks: [], keyword: '', card: CARD, slides: SLIDES(title) })] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === c.id && !p.error), JSON.stringify(run.produced));
  return c.id;
}
const rowsOf = async (client, status = 'all') => (await client.ok('GET', `/api/marketing/materials?status=${status}`));
async function upload(client, name, data, brand) {
  const init = await client.ok('POST', '/api/library', { fileName: name, mimeType: 'image/jpeg', size: data.length, space: 'marketing', folder: `마케팅/브랜드 자료/${brand}`, tags: [brand, '자료 요청'] });
  const put = await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
  assert.ok(put.ok, `올리기 ${put.status}`);
  await client.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, autoHold: false });
  P.gym = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '자료짐' })).id;
  P.app = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '자료앱' })).id;
  for (const b of [P.gym, P.app]) await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b}`, { intro: '동네 운동 공간', products: '1개월 회원권', facts: { phone: '032-111-2222' }, feed: PLAIN_KIT });
  await sql`update mkt_brands set video = coalesce(video, '{}'::jsonb) || ${sql.json({ photoSource: 'screen' })}::jsonb where id = ${P.app}`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('297차 ① 단색 표지로 막힌 피드 → AI 마케터 자료 요청 1장(담당·기한 7일·알림) · 같은 브랜드 두 번째 글은 새 요청 없음 · 앱 화면 브랜드는 앱 화면 요청', async () => {
  P.c1 = await produce(P.gym, '자료짐 아침 운동 소식');
  const c1 = await cur(P.c1);
  assert.equal(c1.status, 'changes'); assert.equal(c1.quality.visual.plain, true);
  const reqs = await sql`select * from mkt_material_requests where brand_id = ${P.gym}`;
  assert.equal(reqs.length, 1, JSON.stringify(reqs));
  const r = reqs[0]; P.r1 = r.id;
  assert.equal(r.source, 'ai'); assert.equal(r.kind, 'photo'); assert.equal(r.status, 'requested'); assert.equal(r.content_id, P.c1); assert.equal(r.wanted, 5);
  assert.match(r.title, /^자료짐 실사 5장/); assert.match(r.detail, /단색 바탕 표지/); assert.match(r.detail, /얼굴이 정면으로 보이지 않게/);
  assert.equal(r.assignee_id, ctx.ownerId, '마케팅 알림 받는 사람이 없으면 글 만든 사람');
  const [due] = await sql`select due_on::text as d from mkt_material_requests where id = ${r.id}`;
  assert.equal(due.d, addDays(seoulToday(), 7), '기한 7일');
  const [n] = await sql`select title, link from notifications where entity_id = ${r.id}`;
  assert.match(n?.title ?? '', /^자료 요청: 자료짐 실사 5장/); assert.equal(n.link, `/s/marketing/materials?r=${r.id}`);
  P.c2 = await produce(P.gym, '자료짐 주말 운영 안내');
  assert.equal((await cur(P.c2)).quality.visual.plain, true);
  assert.equal((await sql`select count(*)::int as n from mkt_material_requests where brand_id = ${P.gym}`)[0].n, 1, '열린 AI 요청이 있으면 새로 만들지 않음');
  await produce(P.app, '자료앱 새 기능 소식');
  const [a] = await sql`select kind, title, detail from mkt_material_requests where brand_id = ${P.app}`;
  assert.equal(a?.kind, 'screen', JSON.stringify(a)); assert.match(a.title, /앱 화면 캡처 5장 \+ 화면 녹화 30초/); assert.match(a.detail, /개인정보는 가리거나/);
});

test('297차 ② 목록·권한: 마케팅 사람 누구나 보기(막힌 글 수) · 공간 밖 못 봄 · 만들기는 관리자만 · 취소는 관리자·담당만', async () => {
  const st = await rowsOf(ctx.staffA.client, 'requested');
  assert.equal(st.canEdit, false);
  const g = st.rows.find((x) => x.id === P.r1);
  assert.ok(g, JSON.stringify(st.rows.map((x) => x.title)));
  assert.equal(g.brand, '자료짐'); assert.equal(g.blocked, 2, '표지 사진이 필요한 글 2개'); assert.equal(g.assignee, (await sql`select name from users where id = ${ctx.ownerId}`)[0].name);
  assert.equal(g.content_title, '자료짐 아침 운동 소식');
  assert.equal(st.counts.requested, 2);
  assert.ok(st.brands.some((b) => b.name === '자료짐'));
  assert.ok([403, 404].includes((await ctx.staffB.client.req('GET', '/api/marketing/materials')).status), '마케팅 공간 밖');
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/materials', { brandId: P.gym, title: '입구 사진' })).status, 403);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/materials/${P.r1}`, { status: 'canceled' })).status, 403, '담당 아님');
  // 관리자가 사람 요청을 만들고 직원에게 맡김 → 알림 · 담당 직원은 취소·다시 요청 가능
  const m = await ctx.owner.ok('POST', '/api/marketing/materials', { brandId: P.gym, kind: 'video', title: '자료짐 운동 장면 영상 3개', detail: '15초 안, 세로', wanted: 3, assigneeId: ctx.staffA.id });
  P.m = m.id;
  const [n] = await sql`select user_id, title from notifications where entity_id = ${m.id}`;
  assert.equal(n.user_id, ctx.staffA.id); assert.match(n.title, /^자료 요청: 자료짐 운동 장면 영상/);
  const [mr] = await sql`select source, created_by, due_on::text as d from mkt_material_requests where id = ${m.id}`;
  assert.equal(mr.source, 'manual'); assert.equal(mr.created_by, ctx.ownerId); assert.equal(mr.d, addDays(seoulToday(), 7));
  await ctx.staffA.client.ok('PATCH', `/api/marketing/materials/${m.id}`, { status: 'canceled' });
  assert.equal((await rowsOf(ctx.owner, 'canceled')).rows[0]?.id, m.id);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/materials/${m.id}/receive`, { fileIds: [P.r1] })).status, 400, '취소된 요청');
  await ctx.owner.ok('PATCH', `/api/marketing/materials/${m.id}`, { status: 'requested' });
  assert.equal((await ctx.owner.req('POST', '/api/marketing/materials', { brandId: '00000000-0000-4000-8000-000000000000', title: '없는 브랜드' })).status, 404);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/materials', { brandId: P.gym, title: 'x' })).status, 400, '제목 2자 이상');
});

test('297차 ③ 올림 → 브랜드 폴더·태그 → 받음 → 사진 설명 → 그 브랜드 단색 표지 글 다시 그림(승인 대기) → 사용함', async () => {
  const f1 = await upload(ctx.owner, '입구.jpg', await photo(), '자료짐');
  // 다른 폴더에 올렸어도 받음 때 브랜드 폴더로 맞춤
  const f2init = await ctx.owner.ok('POST', '/api/library', { fileName: '운동 공간.jpg', mimeType: 'image/jpeg', size: (await photo()).length, space: 'marketing', folder: '마케팅/사진' });
  const buf = await photo();
  await fetch(BASE + f2init.upload.url, { method: 'PUT', headers: f2init.upload.headers, body: buf });
  await ctx.owner.ok('POST', `/api/library/${f2init.id}/complete`);
  // 올리기 끝에 자료실이 사진 설명을 시작함(가짜 AI 기본 설명) — 끝나길 기다렸다가 시험용 설명으로 바꿔 둠(받음은 설명 있는 사진을 다시 설명하지 않음)
  for (let i = 0; i < 40; i++) { if ((await sql`select count(*)::int as n from library_files where id = any(${[f1, f2init.id]}::uuid[]) and vision ? 'caption'`)[0].n === 2) break; await new Promise((s) => setTimeout(s, 500)); }
  const V = (caption, tags) => ({ v: 1, at: new Date().toISOString(), caption, scene: caption, tags, kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', pose: 'none', facing: 'none', light: 'bright' });
  await sql`update library_files set vision = ${sql.json(V('밝은 매장 입구', ['입구', '매장']))} where id = ${f1}`;
  await sql`update library_files set vision = ${sql.json(V('운동 기구가 놓인 넓은 공간', ['기구', '공간']))} where id = ${f2init.id}`;
  assert.ok([403, 404].includes((await ctx.staffB.client.req('POST', `/api/marketing/materials/${P.r1}/receive`, { fileIds: [f1] })).status), '마케팅 공간 밖');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/materials/${P.r1}/receive`, { fileIds: ['00000000-0000-4000-8000-000000000000'] })).status, 400, '없는 파일');
  const r = await ctx.staffA.client.ok('POST', `/api/marketing/materials/${P.r1}/receive`, { fileIds: [f1, f2init.id] });
  assert.equal(r.files, 2);
  const files = await sql`select id, folder, tags, space from library_files where id = any(${[f1, f2init.id]}::uuid[]) order by created_at`;
  for (const f of files) { assert.equal(f.folder, '마케팅/브랜드 자료/자료짐'); assert.equal(f.space, 'marketing'); assert.ok(f.tags.includes('자료짐') && f.tags.includes('자료 요청'), JSON.stringify(f.tags)); }
  const [rq] = await sql`select status, file_ids, received_at from mkt_material_requests where id = ${P.r1}`;
  assert.ok(['received', 'used'].includes(rq.status)); assert.equal(rq.file_ids.length, 2); assert.ok(rq.received_at);
  // 응답 뒤: 사진 설명 → 단색 표지 글 2개 다시 그림
  let c1;
  for (let i = 0; i < 60; i++) { c1 = await cur(P.c1); if (c1.current_version > 1 && (await cur(P.c2)).current_version > 1) break; await new Promise((s) => setTimeout(s, 500)); }
  assert.equal(c1.current_version, 2, JSON.stringify(c1.quality.visual));
  assert.equal(c1.quality.visual.plain, undefined); assert.ok([f1, f2init.id].includes(c1.quality.visual.photoId), JSON.stringify(c1.quality.visual));
  assert.equal(c1.status, 'pending', JSON.stringify(c1.quality.issues));
  const [n] = await sql`select title from notifications where entity_id = ${P.c1} and title like '받은 자료로 표지를 다시 그렸습니다%'`;
  assert.ok(n, '다시 그림 알림');
  const used = await rowsOf(ctx.owner, 'used');
  const u = used.rows.find((x) => x.id === P.r1);
  assert.ok(u, `시안에 쓰였으면 사용함 — ${JSON.stringify(used.counts)}`);
  assert.equal(u.files.length, 2); assert.equal(u.blocked, 0, '막힌 글 없음');
  // 더 올리기: 사용함 상태는 그대로, 파일만 붙음
  // 더 올리기(설명 없는 새 사진) → 그 사진만 설명 · 사용함 상태는 그대로, 파일만 붙음
  const f3 = await upload(ctx.owner, '샤워실.jpg', await photo(), '자료짐');
  const runs0 = (await sql`select count(*)::int as n from job_runs where job = 'mktMaterial'`)[0].n;
  await ctx.owner.ok('POST', `/api/marketing/materials/${P.r1}/receive`, { fileIds: [f3] });
  const [rq2] = await sql`select status, cardinality(file_ids) as n from mkt_material_requests where id = ${P.r1}`;
  assert.equal(rq2.status, 'used'); assert.equal(rq2.n, 3);
  let run;
  for (let i = 0; i < 40; i++) { [run] = await sql`select detail from job_runs where job = 'mktMaterial' order by started_at desc offset 0 limit 1`; if ((await sql`select count(*)::int as n from job_runs where job = 'mktMaterial'`)[0].n > runs0) break; await new Promise((s) => setTimeout(s, 500)); }
  [run] = await sql`select detail from job_runs where job = 'mktMaterial' order by started_at desc limit 1`;
  assert.equal(run.detail.described?.done ?? 0, 0, `올리기 때 이미 설명한 사진은 다시 설명하지 않음 ${JSON.stringify(run.detail)}`);
  const [v3] = await sql`select vision ? 'caption' as ok from library_files where id = ${f3}`;
  assert.equal(v3.ok, true);
});
