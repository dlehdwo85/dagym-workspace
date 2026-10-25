// #235(로컬 10/24 저녁 6 — 마케팅 시안 품질 ⓐ~ⓔ) 중 ⓓ 올리기 전 검사 남은 3가지(채널별 같은 글·다른 회사 깎아내림·깨진 글자)
// · ⓐ 이번 달 실제 소식 · ⓔ 잘 된 예시 글(가짜 Anthropic)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake, ga, bd, se;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const say = (o) => reply({ title: '', brief: '', why: '', hooks: [], keyword: '', script: [], ...o });
const PHONE = '041-555-1234';
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const dayOf = (n) => kst(new Date(Date.now() + n * 864e5));
/** 자동 제작 칸 하나(규칙 없이) — day 일 뒤 한국 시각 hour 시, ago 분 전에 만들 차례 */
async function slot(brandId, { channel = 'instagram', kind = 'feed', day = 3, hour = 10, ago = 1 } = {}) {
  const at = new Date(Date.now() + day * 864e5); at.setUTCHours(hour - 9, 0, 0, 0);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produce_at)
    values ('default', ${brandId}, '자동 칸', ${channel}, ${kind}, ${at}, 'draft', 0, ${ctx.ownerId}, true, now() - ${`${ago} minutes`}::interval) returning id`;
  return c.id;
}
const run = () => ctx.owner.ok('POST', '/api/marketing/auto/run', {});
const row = async (id) => (await sql`select status, quality, rationale, current_version from mkt_contents where id = ${id}`)[0];
const seen = async () => (await (await fetch(FAKE + '/__state')).json()).anthropic.length;
const promptsAfter = async (n) => (await (await fetch(FAKE + '/__state')).json()).anthropic.slice(n).map((x) => JSON.stringify(x.body));
const has = (list, re) => assert.ok(list.some((x) => re.test(x)), `${re} ${JSON.stringify(list)}`);
const none = (list, re) => assert.ok(!list.some((x) => re.test(x)), `${re} ${JSON.stringify(list)}`);

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: false });
  ga = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '가온짐' });
  bd = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '바디랩' });
  se = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '세움공방' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${ga.id}`, { intro: '동네 헬스장', products: '1개월 회원권', facts: { phone: PHONE } });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${se.id}`, { intro: '목공 공방', products: '원데이 클래스' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('ⓓ 품질 검사 API — 깨진 글자·다른 회사 깎아내림을 잡음(웃음 표시·바른 브랜드 이름·비교 문장은 그대로)', async () => {
  const pf = async (b) => (await ctx.owner.ok('POST', '/api/marketing/quality/check', { channel: 'instagram', kind: 'feed', title: '가을 안내', brandId: se.id, ...b })).preflight;
  has(await pf({ brandId: bd.id, body: '바DL 회원님께 알려 드립니다. 이번 주 토요일에 문을 엽니다.' }), /깨진 글자\('바DL/);
  has(await pf({ body: '가을 행사를 엽니다. 이번 주 토요일�까지 이어집니다.' }), /깨진 글자/);
  has(await pf({ body: 'ì•ˆë…•í•˜ì„¸ìš” 이번 주 공방 소식입니다. 토요일에 엽니다.' }), /깨진 글자/);
  has(await pf({ body: '가을 행사ㄹ 엽니다. 이번 주 토요일까지 이어집니다.' }), /깨진 글자\('.*사ㄹ/);
  none(await pf({ body: '가을 행사를 엽니다ㅎㅎ 이번 주 토요일까지 이어집니다.' }), /깨진 글자/);
  none(await pf({ brandId: bd.id, body: '바디랩 회원님께 알려 드립니다. 이번 주 토요일에 문을 엽니다.' }), /깨진 글자/);
  has(await pf({ body: '대행사에 맡기면 매달 수수료만 나갑니다. 공방 수업은 직접 예약하세요.' }), /다른 회사를 깎아내림\('대행사에 맡기면 매달 수수료만'\)/);
  has(await pf({ body: '비싼 대행사 대신 직접 만들어 보세요. 이번 주 토요일 수업입니다.' }), /다른 회사를 깎아내림/);
  has(await pf({ body: '다른 곳은 재료를 대충 씁니다. 우리는 원목만 씁니다.' }), /다른 회사를 깎아내림/);
  none(await pf({ body: '다른 곳보다 작업대가 넓습니다. 이번 주 토요일 수업입니다.' }), /깎아내림/);
});

test('ⓓ 채널별 같은 글: 같은 브랜드·같은 날 인스타·페이스북 글이 거의 같으면 뒤에 만든 글은 승인함 대신 수정 요청 · 원고 지시에 가까운 날 다른 글 첫 줄 · 고친 수정본은 통과', async () => {
  const ig = await slot(ga.id, { channel: 'instagram', day: 5, hour: 10, ago: 3 });
  const fb = await slot(ga.id, { channel: 'facebook', day: 5, hour: 13, ago: 2 });
  const same = '가을 맞이 회원권 안내를 정리했습니다. 이번 주 토요일까지 상담을 받습니다. 처음 오시는 분은 운동복만 챙기시면 됩니다.';
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 회원권', body: same }), say({ title: '가을 회원권 안내', body: same })] });
  const n0 = await seen();
  const r = await run();
  assert.deepEqual(r.produced.filter((p) => [ig, fb].includes(p.id)).map((p) => p.error ?? null), [null, null], JSON.stringify(r.produced));
  const a = await row(ig), b = await row(fb);
  assert.equal(a.status, 'pending', JSON.stringify(a.quality));
  assert.equal(b.status, 'changes', JSON.stringify(b.quality));
  has(b.quality.issues, /^인스타그램 \d+\/\d+ 글과 거의 같음 — 채널마다 다르게$/);
  const prompts = await promptsAfter(n0);
  assert.ok(prompts.some((p) => p.includes('이 브랜드 가까운 날 다른 글의 첫 줄') && p.includes('가을 맞이 회원권 안내를 정리했습니다')), '뒤에 만든 글의 원고 지시에 앞 글 첫 줄');
  // 사람이 다르게 고친 수정본 = 상세 검사에서 걸리지 않음
  await ctx.owner.ok('POST', `/api/marketing/contents/${fb}/versions`, { body: `페이스북 친구분들께 가을 회원권 상담 일정을 알려 드립니다. 토요일 오후에는 운동 순서도 함께 봐 드립니다.\n문의 ${PHONE}`, mediaIds: [] });
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${fb}`);
  none(d.qualityReport.preflight, /거의 같음/);
});

test('ⓐ 이번 달 소식: 끝나는 날 없으면 30일 뒤 · 시작이 끝보다 늦으면 400 · 기간 안 소식이 주제 풀보다 먼저(같은 날 묶음은 같은 소식·한 소식은 이틀까지·덜 쓴 소식 먼저) · 지난 소식은 안 씀', async () => {
  const bad = await ctx.owner.patch(`/api/marketing/auto/brands/${se.id}`, { facts: { news: [{ text: '거꾸로 된 소식', from: dayOf(5), to: dayOf(1) }] } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error?.message ?? '', /시작 날짜가 끝 날짜보다 늦습니다/);
  const HALLOWEEN = '할로윈 주간 — 원데이 클래스 친구 1명 무료';
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${se.id}`, { topicPool: ['처음 오는 날 준비물'], facts: { news: [
    { text: HALLOWEEN, from: dayOf(0), to: dayOf(20) }, { text: '지난 여름 특강', from: dayOf(-60), to: dayOf(-40) }, { text: '새 작업대가 들어왔습니다' }] } });
  const [b] = await sql`select facts from mkt_brands where id = ${se.id}`;
  assert.equal(b.facts.news[2].to, dayOf(30), '끝나는 날이 없으면 오늘부터 30일 뒤');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).brands.find((x) => x.id === se.id).facts.news.length, 3);
  const ids = { a3: await slot(se.id, { day: 3, ago: 9 }), b3: await slot(se.id, { kind: 'reels', day: 3, hour: 18, ago: 8 }), a5: await slot(se.id, { day: 5, ago: 7 }),
    a7: await slot(se.id, { day: 7, ago: 6 }), a9: await slot(se.id, { day: 9, ago: 5 }), a11: await slot(se.id, { day: 11, ago: 4 }) };
  await ctl({ anthropicReset: true });
  const n0 = await seen();
  await run(); await run(); // 한 번에 5건까지
  const topic = async (id) => { const r = (await row(id)).rationale; return [r?.topic, r?.topicFrom]; };
  assert.deepEqual(await topic(ids.a3), [HALLOWEEN, 'news']);
  assert.deepEqual(await topic(ids.b3), [HALLOWEEN, 'news'], '같은 날 묶음 = 같은 소식');
  assert.deepEqual(await topic(ids.a5), ['새 작업대가 들어왔습니다', 'news'], '덜 쓴 소식 먼저');
  assert.deepEqual(await topic(ids.a7), [HALLOWEEN, 'news']);
  assert.deepEqual(await topic(ids.a9), ['새 작업대가 들어왔습니다', 'news']);
  assert.deepEqual(await topic(ids.a11), ['처음 오는 날 준비물', 'pool'], '소식마다 이틀 쓴 뒤에는 주제 풀');
  const prompts = await promptsAfter(n0);
  assert.ok(prompts.some((p) => p.includes('[이번 달 실제 소식') && p.includes(HALLOWEEN)), '원고 재료에 소식');
  assert.ok(!prompts.some((p) => p.includes('지난 여름 특강')), '지난 소식은 재료에도 없음');
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${ids.a3}`);
  assert.deepEqual([d.content.rationale.topic, d.content.rationale.topicFrom], [HALLOWEEN, 'news']);
});

test('ⓔ 잘 된 예시 글: 형식마다 3개까지 · 같은 형식 원고 지시에만 · 예시 문장을 그대로 쓰면 수정 요청 · 승인 글 [좋은 예시로 저장]·빼기 · 권한', async () => {
  const EX = '퇴근길에 들르는 20분 운동 순서를 정리했습니다. 먼저 러닝머신 5분으로 몸을 데웁니다. 이어서 기구 세 가지를 10번씩 돌립니다. 마지막 스트레칭 5분이면 충분합니다.';
  const over = await ctx.owner.patch(`/api/marketing/auto/brands/${ga.id}`, { examples: Array.from({ length: 4 }, (_, k) => ({ kind: 'feed', text: `${EX} (${k})` })) });
  assert.equal(over.status, 400);
  assert.match(over.body.error?.message ?? '', /예시는 3개까지/);
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${ga.id}`, { examples: [{ kind: 'feed', text: EX, note: '첫 줄이 장면' }, { kind: 'blog', text: '블로그 예시 글입니다. 소제목과 사진 설명이 잘 나뉘어 있습니다.' }] });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).brands.find((x) => x.id === ga.id).examples.length, 2);
  assert.ok((await ctx.staffA.client.patch(`/api/marketing/auto/brands/${ga.id}`, { examples: [] })).status >= 400, '관리자만');
  const ok = await slot(ga.id, { day: 15, ago: 3 });
  const copy = await slot(ga.id, { day: 18, ago: 2 });
  await ctl({ anthropicReset: true, anthropicQueue: [
    say({ title: '점심 운동', body: '점심시간 15분이면 굳은 어깨가 풀립니다. 사무실에서 바로 할 수 있는 동작 세 가지를 모았습니다.' }),
    say({ title: '퇴근길 운동', body: `${EX.slice(0, 70)} 이번 주도 같이 해 봐요.` }),
  ] });
  const n0 = await seen();
  await run();
  const prompts = await promptsAfter(n0);
  assert.ok(prompts.some((p) => p.includes('[잘 된 예시 글 — 피드') && p.includes('좋은 점: 첫 줄이 장면') && p.includes('퇴근길에 들르는 20분')), '같은 형식 예시가 원고 지시에');
  assert.ok(!prompts.some((p) => p.includes('블로그 예시 글입니다')), '다른 형식 예시는 안 넣음');
  const o = await row(ok);
  assert.equal(o.status, 'pending', JSON.stringify(o.quality));
  const c = await row(copy);
  assert.equal(c.status, 'changes');
  has(c.quality.issues, /예시 글 문장을 그대로 씀\('.+…'\) — 구성만 참고/);
  // 승인한 글 → [좋은 예시로 저장](승인 버전 본문, AI 표시 줄은 빼고) · 같은 글은 하나만 · 빼기
  assert.equal((await ctx.owner.post(`/api/marketing/contents/${ok}/example`, {})).status, 400, '승인 전 글은 안 됨');
  await ctx.owner.ok('POST', `/api/marketing/contents/${ok}/decide`, { version: o.current_version, decision: 'approve' });
  assert.ok((await ctx.staffA.client.post(`/api/marketing/contents/${ok}/example`, {})).status >= 400, '관리자만');
  const s1 = await ctx.owner.ok('POST', `/api/marketing/contents/${ok}/example`, { note: '어깨 장면으로 시작' });
  assert.deepEqual([s1.saved, s1.kind, s1.count], [true, 'feed', 2]);
  const label = (await ctx.owner.ok('GET', '/api/marketing/auto')).settings.ai_label;
  const saved = (await sql`select examples from mkt_brands where id = ${ga.id}`)[0].examples.find((e) => e.contentId === ok);
  assert.match(saved.text, /점심시간 15분이면 굳은 어깨가 풀립니다/);
  assert.ok(label && !saved.text.includes(label), 'AI 표시 줄은 뺌');
  assert.equal(saved.note, '어깨 장면으로 시작');
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/contents/${ok}`)).content.is_example, true);
  await ctx.owner.ok('POST', `/api/marketing/contents/${ok}/example`, {});
  assert.equal((await sql`select examples from mkt_brands where id = ${ga.id}`)[0].examples.filter((e) => e.contentId === ok).length, 1, '같은 글은 하나만');
  const rm = await ctx.owner.ok('POST', `/api/marketing/contents/${ok}/example`, { remove: true });
  assert.equal(rm.saved, false);
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/contents/${ok}`)).content.is_example, false);
  assert.equal((await ctx.owner.post('/api/marketing/contents/00000000-0000-0000-0000-000000000000/example', {})).status, 404);
});
