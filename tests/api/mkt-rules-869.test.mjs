// 303차 #869(로컬 11/01 11/3분 승인 대기 12건 중 11건 대표 요청 미충족): 사진이 모자라면 단색 장으로 채우지 않고 그 장을 빼고 자료 요청 ·
// 영상은 이 브랜드 사진만(없으면 보류 + 자료 요청) · 회사 설정 plainFill(예전 방식)이면 그대로 채움 / #874 기간 시안 다시 만들기(휴지통 + 같은 자리 새 칸)
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
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const photo = (k) => sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 40 + k * 30, g: 120, b: 160 - k * 20 } } }).jpeg().toBuffer();
async function libFile(name, folder = '마케팅/사진') {
  const data = await photo(name.length % 5);
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source)
    values ('default', 'marketing', ${folder}, ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload') returning id`;
  const key = `lib/default/${f.id}/${f.id}.jpg`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
async function slot(brand, title, { channel = 'instagram', kind = 'feed', days = 3 } = {}) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${brand}, ${title}, ${channel}, now() + make_interval(days => ${days}), 'draft', 0, ${ctx.ownerId}, ${kind}, true, now(), false, ${[]}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const feedDraft = (t) => say({ title: t, body: '아침 운동 이야기입니다.\n가볍게 시작해 보세요.', brief: '실사', why: '', hooks: [], keyword: '운동', card: CARD,
  slides: [{ role: 'cover', title: t, body: '' }, { role: 'problem', title: '운동을 미루게 되죠', body: '아침엔 춥고' }, { role: 'solution', title: '30분부터', body: '가볍게' }, { role: 'proof', title: '넓은 공간', body: '기구가 넉넉' }, { role: 'cta', title: '문의', body: '전화 주세요' }] });

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, videoPause: false });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '규칙짐' })).id;
  P.other = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다른짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '동네 헬스장', products: '회원권', video: { method: 'photos' } });
  P.cover = await libFile('규칙짐 입구 전경.jpg'); // 이 브랜드 사진은 1장뿐(표지가 가져감)
  for (let k = 0; k < 4; k++) await libFile(`다른짐 현장 ${k + 1}.jpg`); // 남의 브랜드 사진 4장
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('피드: 이 브랜드 사진이 모자라면 사진 없는 장(단색 바탕)을 빼고 판 메모에 남김 · 브랜드에 AI 자료 요청 카드 · 장 수 미달이라 승인 대기 대신 수정 요청', async () => {
  const id = await slot(P.brand, '규칙짐 아침 운동');
  // 305차(로컬 11/01 운영): '실사 참고 생성'(photoGen)을 켜 둬도 생성이 준비 안 됐으면(운영사 설정 없음) 빈 장을 남기지 않고 뺌
  await ctx.owner.ok('PUT', '/api/marketing/auto', { photoGen: true });
  await ctl({ anthropicReset: true, anthropicQueue: [feedDraft('아침 운동 시작'), feedDraft('아침 운동 시작')] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === id && !p.error), JSON.stringify(run.produced));
  const c = await cur(id);
  const pages = c.quality.pages ?? [];
  assert.ok(pages.every((p) => p.photoId || p.role === 'cta'), `사진 없는 본문 장 없음: ${JSON.stringify(pages.map((p) => [p.role, !!p.photoId]))}`);
  assert.equal(c.media_ids.length, 1 + pages.length, '표지 + 남은 장');
  assert.match(c.note, /사진 없는 장 \d장 뺌/);
  assert.notEqual(c.status, 'pending', '장 수 미달이면 승인함에 안 올림');
  const [m] = await sql`select title, detail, source from mkt_material_requests where brand_id = ${P.brand} and status = 'requested'`;
  assert.ok(m && m.source === 'ai', '자료 요청 카드'); assert.match(m.detail, /실사가 모자라 그 장을 뺐습니다/);
  await ctx.owner.ok('PUT', '/api/marketing/auto', { photoGen: false });
});

test('회사 설정 plainFill(예전 방식) 켜면 사진이 없어도 장을 그대로 둠(색 바탕)', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { plainFill: true });
  const id = await slot(P.brand, '규칙짐 저녁 운동', { days: 4 });
  await ctl({ anthropicReset: true, anthropicQueue: [feedDraft('저녁 운동'), feedDraft('저녁 운동')] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  assert.equal((c.quality.pages ?? []).length, 4, '장 4개 그대로'); assert.doesNotMatch(c.note, /사진 없는 장/);
  await ctx.owner.ok('PUT', '/api/marketing/auto', { plainFill: false });
});

test('영상(사진 영상): 이 브랜드 사진만 씀 — 남의 브랜드 사진뿐이면 실사 없이 그래픽 카드로 만듦(398차 #1024: 사진이 모자라도 보류하지 않음 · 남의 사진은 안 씀)', async () => {
  const id = await slot(P.brand, '규칙짐 릴스', { kind: 'reels', days: 5 });
  const d = say({ title: '규칙짐 아침', body: '아침 7시에 문을 엽니다.', brief: '실사', why: '', hooks: [], keyword: '운동', script: ['아침 7시 문 여는 곳', '기구가 넉넉합니다', '샤워실은 매일 청소합니다', '처음이면 둘러보기부터', '상담은 전화로'] });
  await ctl({ anthropicReset: true, anthropicQueue: [d, d] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  const [b] = await sql`select status, result from mkt_briefs where content_id = ${id}`;
  assert.equal(b?.status, 'review', JSON.stringify(b?.result?.errors ?? c.note));
  // 이 브랜드 사진은 1장(P.cover)뿐 — 남의 브랜드 사진 4장은 장면에 안 들어가고 나머지 장면은 그래픽 카드
  assert.deepEqual(b.result.reuse.photos, [P.cover], '이 브랜드 사진만(남의 브랜드 사진은 장면에 없음)');
  assert.equal(b.result.variants[0].scenes.filter((x) => x.key).length, 1); assert.equal(b.result.variants[0].scenes.filter((x) => x.mode === 'card').length, 4, '나머지는 그래픽 카드');
  assert.equal(c.media_ids.length, 1, c.note);
  assert.match(c.note, /그래픽·사진 영상\(장면 5개 — 그래픽 카드 4 · 화면 캡처 0 · 품질 통과 실사 1 · 생성 비용 0\)/);
});

test('#874 기간 시안 다시 만들기: 관리자만 · 먼저 대상 수(dryRun) → 휴지통(규칙 칸 연결 풀림) + 같은 자리 새 칸(지금 제작) · 게시·승인된 글은 그대로', async () => {
  const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
  const from = kst(new Date()); const to = kst(new Date(Date.now() + 7 * 864e5));
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '11:00' });
  const [rs] = await sql`select id, scheduled_at from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 1`;
  await sql`update mkt_contents set status = 'pending', current_version = 1, produced_at = now() where id = ${rs.id}`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${rs.id}, 1, '예전 원고', ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  const [ap] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, is_test, cross_channels, mode)
    values ('default', ${P.brand}, '승인된 글', 'instagram', now() + interval '2 days', 'approved', 1, ${ctx.ownerId}, 'feed', true, false, ${[]}, 'content') returning id`;
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/auto/remake', { from, to, dryRun: true })).status, 403, '관리자만');
  const pre = await ctx.owner.ok('POST', '/api/marketing/auto/remake', { from, to, dryRun: true });
  assert.ok(pre.count >= 1 && pre.items.some((x) => x.id === rs.id) && !pre.items.some((x) => x.id === ap.id), JSON.stringify(pre));
  const done = await ctx.owner.ok('POST', '/api/marketing/auto/remake', { from, to });
  assert.equal(done.trashed, pre.count);
  const [old] = await sql`select deleted_at, rule_id, quality, status, deleted_from, deleted_by from mkt_contents where id = ${rs.id}`;
  assert.ok(old.deleted_at && old.rule_id === null && old.quality.remade?.ruleId === r.id, '휴지통 · 규칙 칸 연결 풀림');
  // 305차(로컬 11/01 운영: 옛 글이 승인함에 새 글과 짝으로 남음): 일반 휴지통과 같은 값 — 상태 취소·원래 상태·누가
  assert.deepEqual([old.status, old.deleted_from, old.deleted_by], ['canceled', 'pending', ctx.ownerId]);
  const appr = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.ok(!appr.contents.some((x) => x.id === rs.id), '승인함에 옛 글 없음');
  const [nw] = await sql`select id, status, current_version, rule_id, scheduled_at, produce_at <= now() as due, quality from mkt_contents where rule_id = ${r.id} and scheduled_at = ${rs.scheduled_at} and deleted_at is null`;
  assert.ok(nw && nw.status === 'draft' && nw.current_version === 0 && nw.due && nw.quality.remadeFrom === rs.id, JSON.stringify(nw));
  assert.equal((await sql`select status, deleted_at from mkt_contents where id = ${ap.id}`)[0].deleted_at, null, '승인된 글은 그대로');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/auto/remake', { from: to, to: from })).status, 400, '거꾸로 기간');
  await sql`update mkt_rules set active = false where id = ${r.id}`;
});
