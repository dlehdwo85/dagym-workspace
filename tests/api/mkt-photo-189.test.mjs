// 189차(대표 #685 '실사가 모자라면 같은 브랜드 실사를 참고해 실사풍으로 생성 — 크레딧 한도 안' · #621 '품질 검수 → 보정/AI 재생성'):
// ① 빈 칸 채우기 — 서버 시안에서 실사가 모자라 색 바탕으로 남은 칸을 같은 브랜드 실사(얼굴 없음)를 참고 사진으로 생성 → 그 칸만 다시 그려 새 버전
//    (참고 사진 올리기 → 생성 제출(참고 사진 칸·비율·멱등 키) → 상태 확인 → 자료실 '마케팅/AI 생성(실사 참고)' → 원장 · 사진 기록 '생성')
// ② 주간 크레딧 한도(진행 중 생성도 셈) · 그사이 글이 바뀌면 붙이지 않음 ③ 참고 실사 없음 · 생성 연동 꺼짐 · 모델 표 '참고 사진 칸' 검사
// ④ 회사 설정(기본 꺼짐) → 정기 실행 ⑤ [AI로 다시 만들기](관리자·얼굴 없는 사진만) ⑥ 고객사 응답에 서비스 이름·모델·요청 주소 없음(#602)
// 가짜 생성 서버(tests/fake-google.mjs /hf)로만 시험 — 실제 생성·과금 없음. 실제 사진 품질·운영 모델의 참고 사진 칸 이름은 운영에서
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { Client, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';
import { forbidden } from '../customerWords.mjs';

let srv, ctx, sql, fake, cust, custTenant, custUser; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const st = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = { kicker: '소식', kickerAlts: [], points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '', scene: '', tags: [], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', pose: 'none', facing: 'none', light: 'bright', ...o });
const bands = (w, h, top, bottom) => sharp({ create: { width: w, height: h, channels: 3, background: { r: bottom, g: bottom, b: bottom } } })
  .composite([{ input: { create: { width: w, height: Math.floor(h / 2), channels: 3, background: { r: top, g: top, b: top } } }, left: 0, top: 0 }]).jpeg({ quality: 95 }).toBuffer();
const normal = () => bands(1200, 1500, 80, 200);
async function lib(name, data, { tenant = 'default', space = 'marketing', folder = '마케팅/사진', vision = null, source = 'upload', by = null, mime = 'image/jpeg', tags = [], meta = {} } = {}) {
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision, meta)
    values (${tenant}, ${space}, ${folder}, ${name}, ${name}, ${mime}, ${data.length}, ${by ?? ctx.ownerId}, 'ready', ${source}, ${tags}, ${vision ? sql.json(vision) : null}, ${sql.json(meta)}) returning id`;
  const key = `lib/${tenant}/${f.id}/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
async function slot(brand, title, { kind = 'feed', at }) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${brand}, ${title}, 'instagram', ${at}, 'draft', 0, ${ctx.ownerId}, ${kind}, true, now(), false, ${[]}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const day = (n, h = 0) => new Date(Date.now() + n * 864e5 + h * 3600e3);
async function produce(id, title, slides) {
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where tenant = 'default' and status = 'draft' and produced_at is null and id <> ${id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title, body: `${title}\n가볍게 들러 보세요.\n문의 032-111-2222`, brief: '', why: '', hooks: [], keyword: '', card: CARD, slides })] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === id && !p.error), JSON.stringify(run.produced));
  return cur(id);
}
const SLIDES = (cover) => [{ role: 'cover', title: cover, body: '' }, { role: 'problem', title: '새 기구 들어옴', body: '근력 기구가 늘었어요' }, { role: 'solution', title: '쓰는 법 안내', body: '처음이면 직원에게 물어보세요' },
  { role: 'proof', title: '넓어진 운동 공간', body: '기구 사이가 넓어졌어요' }, { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }];
const fill = (id, body = {}) => ctx.owner.req('POST', `/api/marketing/contents/${id}/fill`, body);
const gensOf = (c) => (c.quality.pages ?? []).filter((p) => p.gen).map((p) => p.photoId);

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, autoHold: false });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '참고브랜드' })).id;
  P.bare = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '빈브랜드' })).id;
  for (const b of [P.brand, P.bare]) await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b}`, { intro: '동네 운동 공간', products: '1개월 회원권', facts: { phone: '032-111-2222' } });
  // 생성 연동(가짜 서버): 이미지 모델 표의 '참고 사진 칸' = image_url
  const s0 = await ctx.owner.ok('GET', '/api/platform/higgsfield');
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf`, models: s0.models.map((m) => (m.id === 'higgsfield-ai/soul/v2/standard' ? { ...m, ref: 'image_url' } : m)) });
  assert.equal((await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true })).enabled, true);
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('189차 ① 빈 칸 채우기(관리자 버튼): 참고 실사 한 번 올림 → 2칸 생성 제출(참고 사진 칸·비율·멱등 키) → 확인 → 그 칸만 사진으로 다시 그려 새 버전 · 원장 · 사진 기록 · 목록 응답', async () => {
  const hf = await ctx.owner.ok('GET', '/api/platform/higgsfield');
  assert.equal(hf.models.find((m) => m.id === 'higgsfield-ai/soul/v2/standard').ref, 'image_url', '모델 표에 참고 사진 칸 저장');
  P.ref = await lib('참고브랜드 매장 전경.jpg', await normal(), { vision: V({ caption: '밝은 매장 전경', tags: ['매장', '전경'] }) });
  P.face = await lib('참고브랜드 회원 인터뷰.jpg', await normal(), { vision: V({ caption: '회원 인터뷰', tags: ['회원'], faces: true, people: 1 }) }); // 얼굴 보임 — 참고로도 안 보냄
  const id = await slot(P.brand, '참고브랜드 새 기구 소식', { at: day(3) });
  const c1 = await produce(id, '새 기구 소식', SLIDES('새 기구 소식'));
  P.a = id;
  assert.equal(c1.status, 'pending', JSON.stringify(c1.quality.issues));
  assert.equal(c1.quality.visual.photoId, P.ref);
  assert.deepEqual(c1.quality.pages.map((p) => p.photoId ?? null), [null, null, null, null], '실사 1장 = 표지 — 장은 색 바탕');
  const d0 = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.deepEqual([d0.fill.status, d0.fill.empty, d0.fill.canStart], [null, 3, true], JSON.stringify(d0.fill));
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/contents/${id}/fill`, {})).status, 403, '관리자만');
  assert.equal((await ctx.staffA.client.ok('GET', `/api/marketing/contents/${id}`)).fill.canStart, false);

  await ctl({ hfReset: true, hfPolls: 1, hfMode: null });
  const f1 = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/fill`, {});
  assert.deepEqual([f1.status, f1.total, f1.made], ['generating', 2, 0], JSON.stringify(f1));
  const s1 = await st();
  assert.equal(s1.hfUploads.length, 1, '같은 참고 사진은 한 번만 올림');
  assert.deepEqual([s1.hfUploads[0].contentType, s1.hfUploads[0].signed, s1.hfUploads[0].auth], ['image/jpeg', true, null], '받은 머리글 그대로 · 생성 서비스 키는 올리기 주소에 안 보냄');
  assert.equal(s1.hf.length, 2);
  for (const h of s1.hf) {
    assert.equal(h.path, 'higgsfield-ai/soul/v2/standard');
    assert.equal(h.body.image_url, `${FAKE}/hf-files/${s1.hfUploads[0].id}.jpg`, '참고 사진 칸 = 올린 사진 주소');
    assert.equal(h.body.aspect_ratio, '3:4', '피드 4:5 → 모델 허용값 중 가까운 3:4');
    assert.match(h.body.prompt, /^Photorealistic photograph/); assert.match(h.body.prompt, /\nNo people\.\n/); assert.match(h.body.prompt, /No text, letters/);
    assert.match(h.idem, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
  assert.notEqual(s1.hf[0].idem, s1.hf[1].idem, '칸마다 다른 멱등 키');
  assert.equal((await fill(id)).status, 400, '생성 중에는 다시 시작 못 함');
  const f2 = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/fill`, { action: 'check' });
  assert.deepEqual([f2.status, f2.made], ['generating', 0], '첫 확인은 아직 생성 중');
  assert.equal((await cur(id)).current_version, 1);
  const f3 = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/fill`, { action: 'check' });
  assert.deepEqual([f3.status, f3.made, f3.total, f3.credits, f3.empty, f3.by], ['done', 2, 2, 13, 1, 'manual'], JSON.stringify(f3));

  const c2 = await cur(id);
  assert.deepEqual([c2.current_version, c2.status, c2.media_ids.length, c2.media_ids[0]], [2, 'pending', 5, c1.media_ids[0]], '표지는 그대로 · 장 4개 다시 그림');
  assert.deepEqual(c2.quality.pages.map((p) => [!!p.photoId, !!p.gen, p.ref ?? null]), [[true, true, P.ref], [true, true, P.ref], [false, false, null], [false, false, null]], JSON.stringify(c2.quality.pages));
  assert.deepEqual(c2.quality.visual.bodyIds, c2.media_ids.slice(1));
  assert.match(c2.note, /^실사 참고 생성 2장으로 빈 사진 칸을 채웠습니다\(서버 그리기\) \(실사 0장 · 생성 2장/, c2.note);
  const gens = gensOf(c2); P.gens = gens;
  const files = await sql`select id, source, folder, space, tags, meta, mime_type, description from library_files where id = any(${gens}::uuid[])`;
  assert.equal(files.length, 2);
  for (const f of files) {
    assert.deepEqual([f.source, f.folder, f.space, f.mime_type], ['ai_ref', '마케팅/AI 생성(실사 참고)', 'marketing', 'image/jpeg']);
    for (const t of ['AI 생성', '실사 참고', '글자없음', '참고브랜드']) assert.ok(f.tags.includes(t), `태그 ${t}: ${f.tags}`);
    assert.deepEqual([f.meta.gen.kind, f.meta.gen.ref, f.meta.gen.contentId], ['fill', P.ref, id]);
    assert.match(f.description, /참고: 참고브랜드 매장 전경\.jpg/);
  }
  const [slide] = await sql`select description from library_files where id = ${c2.media_ids[1]}`;
  assert.match(slide.description, /\(AI 생성·실사 참고\)/, '그린 장 설명에 생성 사진 표시');
  const led = await sql`select kind, credits::float8 as credits, version, note, created_by from mkt_credit_ledger where content_id = ${id} and credits > 0 order by id`;
  assert.deepEqual(led.map((l) => [l.kind, l.credits, l.version, l.note]), [['generate_image', 6.5, 1, '실사 참고 생성(2장)'], ['generate_image', 6.5, 1, '실사 참고 생성(3장)']]);
  const [au] = await sql`select actor_id, detail from audit_logs where action = 'mkt.photo_fill' and target_id = ${id}`;
  assert.equal(au?.actor_id, ctx.ownerId, '수동 시작은 누가 눌렀는지 감사 기록');

  const d1 = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.equal(d1.content.quality.fill, undefined, '생성 기록 원문(요청 id·모델)은 상세 응답에서 뺌');
  assert.ok(d1.fill.detail && d1.fill.detail.model === 'higgsfield-ai/soul/v2/standard', '우리 회사(내부 테넌트)는 운영 정보까지');
  assert.deepEqual(d1.photoRecord.map((r) => [r.where, !!r.gen]), [['표지', false], ['2장', true], ['3장', true], ['4장', false], ['5장', false]], JSON.stringify(d1.photoRecord));
  assert.match(d1.photoRecord[1].why, /실사가 모자라 생성 — 참고 실사: 참고브랜드 매장 전경\.jpg/);
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  const row = list.contents.find((x) => x.id === id);
  assert.deepEqual([row.quality.fill, row.fill_status], [undefined, 'done'], '목록에는 상태만');
  const view = await ctx.owner.ok('GET', '/api/marketing/photos');
  assert.equal(view.gens, 2); assert.deepEqual(view.regen, { ready: true, credits: 6.5 });
  assert.ok(view.items.filter((x) => gens.includes(x.id)).every((x) => x.gen), '사진 AI 설명 목록에 AI 생성 표시');
});

test('189차 ② 주간 크레딧 한도(진행 중 생성도 셈) · 표지 칸도 채움 · 그사이 글이 바뀌면 붙이지 않음(사진은 자료실에 남음)', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { weeklyCredits: 26 }); // 이번 주 13 썼음 → 2장 더
  await ctl({ hfReset: true, hfPolls: 0 });
  const b = await slot(P.brand, '참고브랜드 주말 운영 안내', { at: day(5) });
  const cb = await produce(b, '주말 운영 안내', SLIDES('주말 운영 안내'));
  assert.equal(cb.quality.visual.photoId ?? null, null, '가까운 같은 브랜드 글이 쓴 실사·생성 사진은 표지에도 안 씀 → 색 바탕');
  const fb = await ctx.owner.ok('POST', `/api/marketing/contents/${b}/fill`, {});
  assert.deepEqual([fb.status, fb.total, fb.empty], ['generating', 2, 4], JSON.stringify(fb));
  const c = await slot(P.brand, '참고브랜드 새벽 운영 안내', { at: day(8) });
  await produce(c, '새벽 운영 안내', SLIDES('새벽 운영 안내'));
  const lim = await fill(c);
  assert.equal(lim.status, 400); assert.match(lim.body.error.message, /크레딧 한도/, '진행 중인 2장(13)까지 세면 한도 26 꽉 참');
  assert.equal((await cur(c)).quality.fill, undefined, '한도로 건너뛴 것은 기록하지 않음(한도가 늘면 다시)');
  const sb = await st(); assert.equal(sb.hf.length, 2, '한도 넘는 제출 없음');
  assert.equal(sb.hf[0].body.aspect_ratio, '3:4');
  const fb2 = await ctx.owner.ok('POST', `/api/marketing/contents/${b}/fill`, { action: 'check' });
  assert.equal(fb2.status, 'done', JSON.stringify(fb2));
  const cb2 = await cur(b);
  assert.equal(cb2.current_version, 2);
  assert.notEqual(cb2.media_ids[0], cb.media_ids[0], '표지를 생성 사진으로 다시 그림');
  assert.deepEqual([cb2.quality.visual.gen, cb2.quality.visual.ref], [true, P.ref]);
  assert.ok(cb2.quality.visual.photoId && !P.gens.includes(cb2.quality.visual.photoId));
  assert.deepEqual(cb2.quality.pages.map((p) => !!p.gen), [true, false, false, false], '2장까지 — 표지 + 첫 장');
  const rec = (await ctx.owner.ok('GET', `/api/marketing/contents/${b}`)).photoRecord;
  assert.deepEqual([rec[0].where, !!rec[0].gen, !!rec[1].gen], ['표지', true, true]);

  // 그사이 사람이 수정본을 올리면(현재 버전이 바뀜) 생성 사진을 붙이지 않음 — 생성 사진은 자료실에 남고 원장에도 남음
  await ctx.owner.ok('PUT', '/api/marketing/auto', { weeklyCredits: null });
  await ctl({ hfReset: true, hfPolls: 1 });
  const fc = await ctx.owner.ok('POST', `/api/marketing/contents/${c}/fill`, {});
  assert.equal(fc.status, 'generating');
  const v = await cur(c);
  await ctx.owner.ok('POST', `/api/marketing/contents/${c}/versions`, { body: '사람이 고친 글\n문의 032-111-2222', mediaIds: v.media_ids, note: '직접 수정' });
  await ctx.owner.ok('POST', `/api/marketing/contents/${c}/fill`, { action: 'check' });
  const fc2 = await ctx.owner.ok('POST', `/api/marketing/contents/${c}/fill`, { action: 'check' });
  assert.equal(fc2.status, 'stale', JSON.stringify(fc2)); assert.match(fc2.reason, /그사이 글이 바뀌어/);
  const c3 = await cur(c);
  assert.deepEqual([c3.current_version, c3.note], [2, '직접 수정'], '사람이 올린 버전 그대로');
  const left = await sql`select id from library_files where source = 'ai_ref' and meta->'gen'->>'contentId' = ${c}`;
  assert.equal(left.length, 3, '만든 사진은 자료실에 남음 — 296차: 5장 중 절반(3장)이 되게 표지 + 장 2');
});

test('189차 ③ 참고 실사 없음(얼굴 사진만) · 생성 연동 꺼짐 · 모델 표 참고 사진 칸 형식 검사', async () => {
  await lib('빈브랜드 단체 사진.jpg', await normal(), { vision: V({ caption: '회원 단체 사진', tags: ['단체'], faces: true, people: 4 }) });
  const e = await slot(P.bare, '빈브랜드 가을 이벤트', { at: day(14) });
  const ce = await produce(e, '가을 이벤트', SLIDES('가을 이벤트'));
  assert.equal(ce.quality.visual.photoId ?? null, null);
  await ctl({ hfReset: true });
  const r = await fill(e);
  assert.equal(r.status, 400); assert.match(r.body.error.message, /참고할 실사가 없습니다/);
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${e}`);
  assert.deepEqual([d.fill.status, d.fill.canStart], ['skipped', true]); assert.match(d.fill.reason, /얼굴이 보이지 않는 실사가 필요합니다/);
  assert.equal((await st()).hf.length, 0, '제출 없음');
  // 생성 연동을 끄면 버튼은 '준비 안 됨'(운영사 설정)
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: false });
  const off = await fill(P.a);
  assert.equal(off.status, 400); assert.match(off.body.error.message, /사진 생성이 아직 준비되지 않았습니다\(운영사 설정\)/);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/photos/${P.ref}/regen`, {})).status, 400);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/photos')).regen.ready, false);
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
  const s0 = await ctx.owner.ok('GET', '/api/platform/higgsfield');
  const bad = await ctx.owner.req('PUT', '/api/platform/higgsfield', { models: s0.models.map((m) => (m.kind === 'image' ? { ...m, ref: 'image url!' } : m)) });
  assert.equal(bad.status, 400, '참고 사진 칸은 영문 칸 이름만');
});

test('189차 ④ 회사 설정 \'사진이 모자라면 실사 참고로 생성\'(기본 꺼짐) → 켜면 정기 실행이 시작·이어받기 · 끄면 안 함', async () => {
  const s = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(s.settings.photo_gen, false, '기본 꺼짐');
  await ctl({ hfReset: true, hfPolls: 0 });
  // 296차: 사진 장이 이미 절반이면 생성하지 않음 — 앞 시험에서 안 붙인 생성 사진(다시 쓰면 절반이 됨)은 치워 두고 '정기 실행이 생성을 시작하는지'를 봄
  await sql`update library_files f set deleted_at = now() where f.source = 'ai_ref' and f.deleted_at is null and f.meta->'gen'->>'contentId' in (select id::text from mkt_contents where quality->'fill'->>'status' = 'stale')`;
  await ctx.owner.ok('PUT', '/api/marketing/auto', { weeklyCredits: 500 }); // 296차: 한 글 최대 4장 + 앞 글 더 채우기로 이번 주 기본 한도(약 58)에 닿지 않게
  const g = await slot(P.brand, '참고브랜드 다음 달 일정', { at: day(20) });
  await produce(g, '다음 달 일정', SLIDES('다음 달 일정'));
  await tick();
  assert.equal((await cur(g)).quality.fill, undefined, '꺼져 있으면 정기 실행이 손대지 않음');
  assert.equal((await st()).hf.length, 0);
  await ctx.owner.ok('PUT', '/api/marketing/auto', { photoGen: true });
  const [au] = await sql`select action from audit_logs where action = 'mkt.photo_gen_on'`; assert.ok(au, '켜기 감사 기록');
  await tick();
  const g1 = await cur(g);
  assert.equal(g1.quality.fill?.status, 'generating', JSON.stringify(g1.quality.fill));
  assert.equal(g1.quality.fill.by, 'auto');
  await tick();
  const g2 = await cur(g);
  assert.deepEqual([g2.quality.fill.status, g2.current_version], ['done', 2], JSON.stringify(g2.quality.fill));
  assert.equal(g2.quality.fill.jobs.length, 3, '296차: 5장 중 절반(3장)이 되게 — 표지 + 장 2');
  const mine = await sql`select id from library_files where source = 'ai_ref' and meta->'gen'->>'contentId' = ${g}`;
  assert.equal(mine.length, 3, '이 글을 위해 만든 사진 3장');
  // 앞서 만들고 안 붙인(그사이 글이 바뀐) 생성 사진은 실사가 모자랄 때 다시 씀(새로 만들기 전에) — 사진 기록에 '생성'으로
  const reused = gensOf(g2).filter((x) => !mine.some((m) => m.id === x));
  if (reused.length) { const rs = await sql`select meta->'gen'->>'contentId' as c from library_files where id = any(${reused}::uuid[])`; assert.ok(rs.every((r) => r.c && r.c !== g), JSON.stringify(rs)); }
  await ctx.owner.ok('PUT', '/api/marketing/auto', { photoGen: false });
  const h = await slot(P.brand, '참고브랜드 연말 안내', { at: day(26) });
  await produce(h, '연말 안내', SLIDES('연말 안내'));
  await tick();
  assert.equal((await cur(h)).quality.fill, undefined);
});

test('189차 ⑤ #621 [AI로 다시 만들기]: 관리자 · 얼굴 없는 사진만 · 생성 사진은 안 됨 · 정기 실행이 결과 저장(원본 그대로) · 원장', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { weeklyCredits: 500 }); // 앞 시험들이 이번 주 기본 한도를 거의 다 씀
  P.dim = await lib('참고브랜드 복도.jpg', await bands(1200, 1500, 20, 60), { vision: V({ caption: '어두운 복도', tags: ['복도'], quality: 'poor', light: 'dark' }), tags: ['복도'] });
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/photos/${P.dim}/regen`, {})).status, 403, '관리자만');
  const face = await ctx.owner.req('POST', `/api/marketing/photos/${P.face}/regen`, {});
  assert.equal(face.status, 400); assert.match(face.body.error.message, /얼굴/);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/photos/${P.gens[0]}/regen`, {})).status, 400, '생성 사진은 다시 만들지 않음');
  await ctl({ hfReset: true, hfPolls: 0 });
  assert.equal((await ctx.owner.ok('POST', `/api/marketing/photos/${P.dim}/regen`, {})).status, 'generating');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/photos/${P.dim}/regen`, {})).status, 400, '이미 다시 만드는 중');
  const s = await st();
  assert.deepEqual([s.hf.length, s.hfUploads.length], [1, 1]);
  assert.match(s.hf[0].body.prompt, /^Recreate the reference photo/); assert.equal(s.hf[0].body.image_url, `${FAKE}/hf-files/${s.hfUploads[0].id}.jpg`);
  let it = (await ctx.owner.ok('GET', '/api/marketing/photos')).items.find((x) => x.id === P.dim);
  assert.deepEqual(it.regen, { status: 'generating', fileId: null });
  await tick();
  const [o] = await sql`select meta from library_files where id = ${P.dim}`;
  assert.equal(o.meta.regen.status, 'done', JSON.stringify(o.meta.regen));
  const [n] = await sql`select source, folder, tags, meta, title, mime_type from library_files where id = ${o.meta.regen.fileId}`;
  assert.deepEqual([n.source, n.folder, n.mime_type, n.meta.gen.kind, n.meta.gen.ref], ['ai_ref', '마케팅/AI 생성(실사 참고)', 'image/jpeg', 'regen', P.dim]);
  assert.deepEqual(n.tags, ['복도', 'AI 생성', '실사 참고', '글자없음']);
  assert.equal(n.title, '참고브랜드 복도 — AI로 다시 만든 사진');
  const led = await sql`select credits::float8 as credits, content_id from mkt_credit_ledger where note = 'AI로 다시 만들기(사진)'`;
  assert.deepEqual(led.map((l) => [l.credits, l.content_id]), [[6.5, null]]);
  it = (await ctx.owner.ok('GET', '/api/marketing/photos')).items.find((x) => x.id === P.dim);
  assert.deepEqual(it.regen, { status: 'done', fileId: o.meta.regen.fileId });
});

test('189차 ⑥ #602 고객사: 상세·목록·자료실 상세에 생성 서비스 이름·모델·요청 주소·오류 원문 없음 / 우리 회사는 그대로', async () => {
  cust = new Client('cust-189');
  const form = { password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, email: 'boss@gen-test.test', name: '생성대표', mode: 'team', company: '생성회사' };
  const r = await cust.ok('POST', '/api/auth/signup', form);
  await cust.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = (await cust.ok('GET', '/api/auth/me')).user; custTenant = me.tenant; custUser = me.id;
  await cust.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await cust.ok('POST', '/api/marketing/brands', { name: '생성브랜드' })).id;
  const err = 'Higgsfield HTTP 403 Not enough credits (higgsfield-ai/soul/v2/standard)';
  const quality = { visual: { by: 'server', fileId: null, at: new Date().toISOString() }, pages: [{ role: 'problem', title: '첫 장', body: '내용' }, { role: 'cta', title: '문의', body: '전화' }],
    fill: { v: 1, status: 'failed', reason: '사진을 만들지 못했습니다 — 잠시 뒤 다시 눌러 주세요', model: 'higgsfield-ai/soul/v2/standard', error: err, at: new Date().toISOString(), by: 'manual',
      jobs: [{ slot: 0, requestId: 'req-1', statusUrl: 'https://api.higgsfield.ai/requests/req-1/status', status: 'failed', ref: '00000000-0000-0000-0000-000000000000', error: err }] } };
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, is_test, cross_channels, mode, quality)
    values (${custTenant}, ${brand}, '생성브랜드 소식', 'instagram', ${day(4)}, 'pending', 1, ${custUser}, 'feed', true, false, ${[]}, 'content', ${sql.json(quality)}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, '생성브랜드 소식', ${[]}, '시험', ${custUser})`;
  const d = await cust.ok('GET', `/api/marketing/contents/${c.id}`);
  assert.equal(d.content.quality.fill, undefined); assert.equal(d.fill.detail, undefined);
  assert.deepEqual([d.fill.status, d.fill.reason, d.fill.empty], ['failed', '사진을 만들지 못했습니다 — 잠시 뒤 다시 눌러 주세요', 2], '빈 칸 = 표지 + 첫 장(행동 장 빼고)');
  assert.deepEqual(forbidden(JSON.stringify({ content: d.content, fill: d.fill })), [], '상세: 금지 낱말');
  assert.ok(!JSON.stringify(d).includes('soul'), '모델 경로 없음');
  const l = await cust.ok('GET', '/api/marketing/contents?view=approvals');
  const row = l.contents.find((x) => x.id === c.id);
  assert.deepEqual([row.quality.fill, row.fill_status], [undefined, 'failed']);
  assert.deepEqual(forbidden(JSON.stringify(row)), []);
  // 자료실 상세: 다시 만들기 기록은 상태만
  const f = await lib('생성브랜드 입구.jpg', await normal(), { tenant: custTenant, by: custUser, vision: V({ caption: '입구' }),
    meta: { regen: { status: 'failed', requestId: 'req-2', statusUrl: 'https://api.higgsfield.ai/requests/req-2/status', model: 'higgsfield-ai/soul/v2/standard', error: err, at: new Date().toISOString() } } });
  const lf = await cust.ok('GET', `/api/library/${f}`);
  assert.deepEqual(Object.keys(lf.file.meta.regen).sort(), ['at', 'fileId', 'status']);
  assert.deepEqual(forbidden(JSON.stringify(lf.file.meta)), []);
  // 우리 회사(내부 테넌트)는 그대로
  await sql`update library_files set meta = meta || ${sql.json({ regen: { status: 'failed', statusUrl: 'https://api.higgsfield.ai/requests/req-3/status', model: 'higgsfield-ai/soul/v2/standard', error: err } })} where id = ${P.face}`;
  const own = await ctx.owner.ok('GET', `/api/library/${P.face}`);
  assert.match(own.file.meta.regen.statusUrl, /requests\/req-3/);
});
