// 329차(대표 11/02 결정 ⓑ·2 — "글마다 확인하게 하고, 최종 검수가 끝나야만 승인 대기실에" · "모든 문구와 사진이 어느 정도 매칭 — 수업 이름·장면까지 장마다"):
// ① 자동 제작 → 사진이 붙은 글은 바로 AI 사진·글 대조(글만, 빠른 모델) → 모두 맞으면 승인 대기(승인할 시안에 들어감) · 기록(quality.photoAudit 칸마다 판정) · 규칙: 요가 장엔 스피닝 사진 안 씀
// ② 안 맞음이 있으면 승인 대기 대신 수정 요청(사유 줄) + 자료 요청, 승인할 시안 수에 안 들어감
// ③ 새 판을 붙이면 '대조 중' → 승인할 시안에서 빠지고 [승인] 400 → 정기 실행이 대조 → 통과하면 다시 승인할 시안 · 대조 표시 없는 승인 대기 글도 정기 실행이 한 번 대조
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const V = (o) => ({ caption: '매장 안 사진', scene: '매장 안 모습입니다.', tags: ['매장'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
const describe = async (id, answer) => { await ctl({ visionQueue: [answer] }); return ctx.owner.ok('POST', '/api/marketing/photos/describe', { ids: [id], redo: true }); };
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
let nth = 0;
const photo = () => { nth++; return sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 60 + (nth * 37) % 150, g: 110 + (nth * 23) % 100, b: 140 } } }).jpeg().toBuffer(); };
async function libFile(name, vision, tags = []) {
  const data = await photo();
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags)
    values ('default', 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${tags}) returning id`;
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
const run = async (queue, audits = []) => { await ctl({ anthropicReset: true, anthropicQueue: queue, auditQueue: audits }); return ctx.owner.ok('POST', '/api/marketing/auto/run', {}); };
const inbox = async () => (await ctx.owner.ok('GET', '/api/marketing/inbox')).counts.contents;
const feed = (t) => say({ title: t, body: `${t}\n요가 수업실과 스피닝 수업을 새로 엽니다.`, brief: '실사', why: '', hooks: [], keyword: '수업', card: CARD,
  slides: [{ role: 'cover', title: t, body: '' }, { role: 'problem', title: '요가 수업실 소개', body: '매트와 거울이 있는 조용한 방' }, { role: 'solution', title: '스피닝 수업도 함께', body: '자전거 20대, 음악과 함께' }, { role: 'cta', title: '상담해 보세요', body: '전화 주세요' }] });
const FEED = { style: 'trust', templates: ['photo_fade'], palette: { bg: '#152037', accent: '#f0b038' }, header: '수업짐 소식', contact: '상담 1234-5678', kicker: '운영 기록' };

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ MKT_PHOTO_AUDIT: 'on' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  P.b = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '수업짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.b}`, { intro: '요가·스피닝 수업이 있는 피트니스', products: '헬스장·요가·스피닝', feed: FEED });
  P.yoga = []; for (let k = 1; k <= 2; k++) P.yoga.push(await libFile(`수업짐 요가 수업실 ${k}.jpg`, { caption: `수업짐 요가 매트가 깔린 수업실 ${k}`, tags: ['요가', '수업실'] }, ['요가']));
  P.spin = await libFile('수업짐 스피닝룸.jpg', { caption: '수업짐 스피닝 자전거가 줄지어 있는 수업실', tags: ['스피닝', '자전거'] }, ['스피닝']);
  P.gym = []; for (let k = 1; k <= 3; k++) P.gym.push(await libFile(`수업짐 헬스장 ${k}.jpg`, { caption: `수업짐 헬스장 기구 ${k}`, tags: ['헬스장', '기구'] }));
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('① 자동 제작 → 바로 AI 대조(모두 맞음) → 승인 대기·승인할 시안 1 · 칸마다 기록 · 요가 장엔 요가 사진(스피닝 사진은 그 장에 안 씀)', async () => {
  const t = '요가 수업, 이번 달 새로 시작합니다';
  P.c1 = await slot(P.b, t);
  await run([feed(t)]);
  const c = await cur(P.c1);
  assert.equal(c.status, 'pending', JSON.stringify(c.quality?.issues));
  const a = c.quality.photoAudit;
  assert.ok(a && a.passed === true && a.pending === undefined && a.version === 1, JSON.stringify(a));
  assert.ok(a.rows.length >= 2, JSON.stringify(a.rows)); assert.ok(a.rows.every((r) => r.verdict === 'ok' && r.photoId && r.where));
  assert.ok(a.rows.some((r) => r.where === '표지' || r.where.startsWith('표지 사진')), '표지 칸');
  assert.equal(await inbox(), 1, '승인할 시안에 들어감');
  const pages = c.quality.pages ?? [];
  const yogaPage = pages.find((p) => p.title === '요가 수업실 소개'); const spinPage = pages.find((p) => p.title === '스피닝 수업도 함께');
  assert.ok(yogaPage?.photoId && P.yoga.includes(yogaPage.photoId), `요가 장 사진 ${yogaPage?.photoId}`);
  assert.ok(!spinPage || spinPage.photoId !== P.yoga[0] && spinPage.photoId !== P.yoga[1], '스피닝 장에 요가 사진 없음');
  const audits = (await (await fetch(`${FAKE}/__state`)).json()).audits;
  assert.equal(audits.length, 1, '대조 호출 1번(모든 칸 한 번에)');
  const input = JSON.parse(audits[0].messages[0].content);
  assert.ok(input.slots.length === a.rows.length && input.slots.every((s) => s.photo.includes('이름 ') && s.text.length > 0));
  const rec = await ctx.owner.ok('GET', `/api/marketing/contents/${P.c1}`);
  assert.ok((rec.photoRecord ?? rec.photos ?? []).length === 0 || JSON.stringify(rec).includes('AI 대조: 맞음'), '시안 기록에 AI 대조 결과');
});

test('② 안 맞음이 있으면 승인 대기 대신 수정 요청(사유 줄) + 자료 요청 · 승인할 시안 수 그대로', async () => {
  const t = '스피닝 수업 시간표가 바뀝니다';
  P.c2 = await slot(P.b, t);
  await run([feed(t)], [{ all: 'mismatch', why: '글과 다른 수업 사진' }]);
  const c = await cur(P.c2);
  assert.equal(c.status, 'changes');
  assert.ok(c.quality.passed === false && c.quality.issues.some((x) => x.startsWith('AI 사진·글 대조 미통과')), JSON.stringify(c.quality.issues));
  assert.ok(c.quality.photoAudit.passed === false && c.quality.photoAudit.rows.every((r) => r.verdict === 'mismatch'));
  assert.equal(await inbox(), 1, '승인할 시안은 ①만');
  assert.ok((await sql`select count(*)::int n from mkt_material_requests where content_id = ${P.c2}`)[0].n >= 1, '자료 요청');
  const [n] = await sql`select title from notifications where title like '사진·글 대조 미통과:%' or title like '품질 검사 미통과:%' order by created_at desc limit 1`;
  assert.ok(n, '승인자 알림');
});

test('③ 새 판을 붙이면 대조 중 → 승인할 시안에서 빠짐·[승인] 400 → 정기 실행이 대조 → 통과하면 다시 올라옴 · 대조 표시 없는 승인 대기 글도 정기 실행이 한 번 대조', async () => {
  await ctl({ anthropicReset: true });
  const v = await ctx.owner.ok('POST', `/api/marketing/contents/${P.c1}/versions`, { body: '요가 수업 안내 새 판', mediaIds: P.gym, note: '사진 바꿈' });
  let c = await cur(P.c1);
  assert.equal(c.status, 'pending'); assert.equal(c.quality.photoAudit.pending, true); assert.equal(c.quality.photoAudit.version, v.version);
  assert.equal(await inbox(), 0, '대조 중이라 승인할 시안에서 빠짐');
  const d = await ctx.owner.req('POST', `/api/marketing/contents/${P.c1}/decide`, { version: v.version, decision: 'approve' });
  assert.equal(d.status, 400); assert.match(d.body.error.message, /대조/);
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.equal((list.contents ?? list.items).find((x) => x.id === P.c1)?.audit_pending, true, '승인함 카드에 대조 중 표시');
  const r = await tick();
  assert.ok(r.mktPhotoAudit?.checked >= 1 && r.mktPhotoAudit.done >= 1, JSON.stringify(r.mktPhotoAudit));
  c = await cur(P.c1);
  assert.equal(c.quality.photoAudit.pending, undefined); assert.equal(c.quality.photoAudit.passed, true); assert.equal(c.quality.photoAudit.version, v.version);
  assert.ok(c.quality.photoAudit.rows.length === 3 && c.quality.photoAudit.rows[0].where === '시안 1', '사람이 붙인 시안은 이미지 자체로');
  assert.equal(await inbox(), 1, '다시 승인할 시안에');
  // 대조 표시가 없는 승인 대기 글(예전 글) → 정기 실행이 한 번 대조
  await sql`update mkt_contents set quality = quality - 'photoAudit' where id = ${P.c1}`;
  const r2 = await tick();
  assert.ok(r2.mktPhotoAudit?.checked >= 1, JSON.stringify(r2.mktPhotoAudit));
  c = await cur(P.c1); assert.equal(c.quality.photoAudit?.version, v.version);
  const r3 = await tick();
  assert.equal(r3.mktPhotoAudit?.checked ?? 0, 0, '이 판은 이미 대조했으니 다시 안 함');
});

// 333차(로컬 11/02 329차 운영 확인 후속): ⓐ 사진이 없어 대조를 건너뛴 글도 기록에 '건너뜀(영상 글/사진 없음)' 한 줄 + 승인함 카드 칸(audit_skipped·audit_ok) ⓑ 대조 호출은 사용량에 '사진·글 AI 대조' 줄로 따로 + 기능별 오늘 호출 수·비용
test('④ 333차 ⓐ 영상만 붙은 글(영상형)은 정기 실행이 "영상 글 — 대조할 사진 없음" 으로 기록 · 파일 없는 새 판은 "사진 없음" · 승인함 목록에 audit_skipped / 통과한 글은 audit_ok', async () => {
  // (a) 영상 파일만 붙은 승인 대기 글(대조 표시 없음) → 정기 실행 → 건너뜀 기록(AI 호출 없음)
  const [vf] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, storage_key)
    values ('default', 'marketing', '마케팅/영상', '수업짐 소개 영상', 'intro.mp4', 'video/mp4', 1000, ${ctx.ownerId}, 'ready', 'upload', 'lib/default/x/intro.mp4') returning id`;
  const [cv] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, is_test, cross_channels, mode)
    values ('default', ${P.b}, '수업짐 소개 릴스', 'instagram', now() + interval '2 days', 'pending', 1, ${ctx.ownerId}, 'reels', true, false, ${[]}, 'content') returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${cv.id}, 1, '수업짐 소개 릴스 대본', ${[vf.id]}, ${ctx.ownerId})`;
  const before = (await (await fetch(`${FAKE}/__state`)).json()).audits.length;
  const r = await tick();
  assert.ok(r.mktPhotoAudit?.checked >= 1, JSON.stringify(r.mktPhotoAudit));
  let c = await cur(cv.id);
  assert.equal(c.status, 'pending', '건너뜀은 승인 대기 그대로');
  assert.ok(c.quality?.photoAudit && c.quality.photoAudit.passed === true && c.quality.photoAudit.pending === undefined && c.quality.photoAudit.version === 1, JSON.stringify(c.quality?.photoAudit));
  assert.match(c.quality.photoAudit.skipped, /^영상 글 — 대조할 사진 없음/);
  assert.equal((await (await fetch(`${FAKE}/__state`)).json()).audits.length, before, '영상 글은 AI 대조 호출 없음(비용 0)');
  // (b) 파일 없는 새 판(사람이 글만 고침) → '사진 없음' 기록(대조 중 아님 → [승인] 막히지 않음)
  const v = await ctx.owner.ok('POST', `/api/marketing/contents/${P.c2}/versions`, { body: '스피닝 시간표 글만 고침', mediaIds: [], note: '글만' });
  c = await cur(P.c2);
  assert.equal(c.status, 'pending'); assert.equal(c.quality.photoAudit.pending, undefined); assert.equal(c.quality.photoAudit.version, v.version);
  assert.match(c.quality.photoAudit.skipped, /^사진 없음/);
  // (c) 승인함 목록 칸: 영상 글·사진 없는 글 = audit_skipped, ③에서 통과한 글 = audit_ok
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  const rows = list.contents ?? list.items; const by = (id) => rows.find((x) => x.id === id);
  assert.match(by(cv.id)?.audit_skipped ?? '', /^영상 글/); assert.equal(by(cv.id)?.audit_ok, false); assert.equal(by(cv.id)?.audit_pending, false);
  assert.match(by(P.c2)?.audit_skipped ?? '', /^사진 없음/);
  assert.equal(by(P.c1)?.audit_ok, true, '③에서 대조 통과한 글'); assert.equal(by(P.c1)?.audit_skipped, null);
  // 기록이 이 판 것이 아니면(예전 판) 칸은 비움
  await sql`update mkt_contents set quality = quality || ${sql.json({ photoAudit: { ...c.quality.photoAudit, version: 0 } })} where id = ${P.c2}`;
  const again = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals'));
  assert.equal((again.contents ?? again.items).find((x) => x.id === P.c2)?.audit_skipped, null, '예전 판 기록은 안 보임');
  await sql`update mkt_contents set quality = quality || ${sql.json({ photoAudit: c.quality.photoAudit })} where id = ${P.c2}`;
});

test('⑤ 333차 ⓑ 대조 호출은 ai_usage 에 purpose=marketing_photo_audit(글 id 포함) · /api/usage 기능별 줄에 오늘 호출 수·비용(todayRequests·todayCost)', async () => {
  const rows = await sql`select purpose, count(*)::int n, count(*) filter (where mkt_content_id is not null)::int withc from ai_usage where tenant = 'default' group by purpose`;
  const audit = rows.find((x) => x.purpose === 'marketing_photo_audit'); const produce = rows.find((x) => x.purpose === 'marketing_produce');
  assert.ok(audit && audit.n >= 2 && audit.withc === audit.n, `대조 호출은 따로 기록 ${JSON.stringify(rows)}`);
  assert.ok(produce && produce.n >= 1, '원고 호출은 그대로 marketing_produce');
  const u = await ctx.owner.ok('GET', '/api/usage');
  const bp = u.ai.byPurpose; const a = bp.find((x) => x.purpose === 'marketing_photo_audit');
  assert.ok(a, JSON.stringify(bp));
  assert.equal(a.requests, audit.n); assert.equal(a.todayRequests, audit.n, '오늘 호출 수 = 이번 달(시험은 오늘만)');
  assert.ok(typeof a.todayCost === 'number' && a.todayCost >= 0 && typeof a.cost === 'number' && Math.abs(a.todayCost - a.cost) < 1e-6, JSON.stringify(a));
  assert.ok(bp.every((x) => typeof x.todayRequests === 'number' && typeof x.todayCost === 'number'), '모든 줄에 오늘 칸');
});
