// 로컬 마케팅 시안 60건 검수(10/24) 수정 요청 ②~⑥: 올리기 전 자동 검사(걸리면 승인함 대신 수정 요청) · 틀 문구 금지 · 브랜드 사실 카드(연락처를 글 안에)
// · 릴스·쇼츠 대본/캡션 분리 · 브랜드별 주제 풀(회사 공통 테마는 맨 뒤) (가짜 Anthropic)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake, ga, nu, se, ba;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const say = (o) => reply({ title: '', brief: '', why: '', hooks: [], keyword: '', script: [], ...o });
const PHONE = '041-555-1234';
const COMPANY = '월말 정리와 다음 달 준비';
const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
/** 자동 제작 칸 하나(규칙 없이) — day 일 뒤 한국 시각 hour 시, ago 분 전에 만들 차례 */
async function slot(brandId, { channel = 'instagram', kind = 'feed', day = 3, hour = 10, ago = 1 } = {}) {
  const at = new Date(Date.now() + day * 864e5); at.setUTCHours(hour - 9, 0, 0, 0);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produce_at)
    values ('default', ${brandId}, '자동 칸', ${channel}, ${kind}, ${at}, 'draft', 0, ${ctx.ownerId}, true, now() - ${`${ago} minutes`}::interval) returning id`;
  return c.id;
}
const run = () => ctx.owner.ok('POST', '/api/marketing/auto/run', {});
const latest = async (id) => (await sql`select body from mkt_versions where content_id = ${id} order by version desc limit 1`)[0]?.body;
const row = async (id) => (await sql`select status, quality, rationale from mkt_contents where id = ${id}`)[0];
/** 가짜 Anthropic 이 받은 요청 수(reset 은 응답 줄만 비움) — 이 뒤에 받은 원고 지시문만 보려고 */
const seen = async () => (await (await fetch(FAKE + '/__state')).json()).anthropic.length;
const promptsAfter = async (n) => (await (await fetch(FAKE + '/__state')).json()).anthropic.slice(n).map((x) => JSON.stringify(x.body));

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: false });
  ga = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '가온짐' });
  nu = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '누리링크' });
  se = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '세움공방' });
  // 사실 카드(빈 칸은 저장 안 함) + 소개
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${ga.id}`, { intro: '동네 헬스장', products: '1개월 회원권', facts: { phone: PHONE, link: '', hours: '평일 06~23시', avoidNames: ['옛이름짐'] } });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${se.id}`, { intro: '목공 공방', products: '원데이 클래스' });
  // 회사 공통 월 목표(승인) — 주간 주제가 모든 브랜드에 같은 주제로 내려가던 문제(QA 18건)를 재현하는 바탕
  const days = [...new Set([0, 10, 11, 20, 30, 40].map((d) => kst(new Date(Date.now() + d * 864e5)).slice(0, 7)))];
  for (const m of days) await sql`insert into mkt_goals (tenant, brand_id, month, status, goals, weekly) values ('default', null, ${m}, 'approved', ${sql.json({ objectives: ['문의 늘리기'] })},
    ${sql.json([{ week: 1, from: kst(new Date()), to: kst(new Date(Date.now() + 45 * 864e5)), topic: COMPANY }])})`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('⑤ 브랜드 키트: 사실 카드는 빈 칸을 빼고 저장 · 주제 풀은 중복 없이 · 자동 제작 화면에 보임', async () => {
  const [b] = await sql`select facts, topic_pool from mkt_brands where id = ${ga.id}`;
  assert.deepEqual(b.facts, { phone: PHONE, hours: '평일 06~23시', avoidNames: ['옛이름짐'] });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${ga.id}`, { topicPool: ['처음 오는 날 준비물', '운동 기록 앱 쓰는 법', '샤워실 이용 시간', '운동 기록 앱 쓰는 법'] });
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  const g = v.brands.find((x) => x.id === ga.id);
  assert.deepEqual([g.facts.phone, g.topic_pool], [PHONE, ['처음 오는 날 준비물', '운동 기록 앱 쓰는 법', '샤워실 이용 시간']]);
  assert.ok((await ctx.staffA.client.patch(`/api/marketing/auto/brands/${ga.id}`, { topicPool: ['x'] })).status >= 400, '관리자만');
});

test('② 품질 검사 API — 올리기 전 검사가 걸린 줄을 돌려줌(한 줄·해시태그·권유·이미지 참조·연락처·끊김·틀 문구·다른 브랜드·블로그·스토리·릴스)', async () => {
  const pf = async (b) => (await ctx.owner.ok('POST', '/api/marketing/quality/check', { channel: 'instagram', kind: 'feed', title: '가을 안내', brandId: ga.id, ...b })).preflight;
  const has = (list, re) => assert.ok(list.some((x) => re.test(x)), `${re} ${JSON.stringify(list)}`);
  has(await pf({ body: '가을 안내입니다' }), /한 줄짜리 글/);
  has(await pf({ body: '첫 문장입니다. 둘째 문장입니다.\n#가 #나 #다 #라 #마 #바 #사' }), /해시태그 7개 — 5개까지/);
  has(await pf({ body: '첫 문장입니다. 지금 신청하세요. 이 글을 저장해 두세요.' }), /권유 2가지\(신청·방문·저장\)/);
  has(await pf({ body: '가을 행사를 엽니다. 자세한 연락처는 이미지 참조 부탁드립니다.' }), /이미지 참조/);
  has(await pf({ body: '가을 행사를 엽니다. 이번 주 토요일까지 이어집니다.' }), /연락처 없음 — 사실 카드의 전화/);
  has(await pf({ body: '가을 행사를 엽니다. 이번 주까지 운동하는 분이라면 꼭' }), /끝 문장이 끊김/);
  has(await pf({ body: '아직도 장부를 손으로 쓰고 계신가요? 이번 주에 바꿔 볼 때입니다.' }), /틀 문구 그대로: '아직도 ~ 계신가요\?'/);
  has(await pf({ body: '누리링크 회원도 함께할 수 있습니다. 이번 주 토요일입니다.' }), /다른 브랜드·회사 이름\('누리링크'\)/);
  has(await pf({ body: '옛이름짐 시절부터 오신 분들께. 이번 주 토요일입니다.' }), /'옛이름짐'/); // 사실 카드 '섞으면 안 되는 이름'
  has(await pf({ channel: 'blog', kind: 'blog', body: '짧은 블로그입니다. 두 문장입니다.' }), /블로그 본문 \d+자 — 1,800자 이상/);
  const st = await pf({ kind: 'story', body: '첫 줄\n둘째 줄\n셋째 줄' });
  has(st, /스토리 문구 3줄/); has(st, /스티커 제안/);
  const rl = await pf({ kind: 'reels', body: '캡션 첫 문장입니다. 둘째 문장입니다.\n[컷1] 첫 장면\n[컷2] 둘째 장면' });
  has(rl, /캡션에 컷 대본이 섞임/); has(rl, /대본\(컷\) 없음/);
  has(await pf({ kind: 'reels', body: '캡션입니다. 둘째 문장입니다.', script: ['처음 오시는 분들이 가장 많이 물어보시는 세 가지를 한 번에 정리해 드리겠습니다', '둘째 컷'] }), /첫 컷 대사 [\d.]+초 — 3초/);
  // 깨끗한 글 = 걸린 것 없음 · 릴스 캡션의 그냥 번호 목록은 대본이 아님
  assert.deepEqual(await pf({ body: `가을 행사를 엽니다. 이번 주 토요일까지 이어집니다.\n문의 ${PHONE}` }), []);
  assert.deepEqual(await pf({ kind: 'reels', body: `오늘 정리한 세 가지입니다.\n1. 첫째 준비물\n2. 둘째 준비물\n문의 ${PHONE}`, script: ['첫 컷 한 줄', '둘째 컷 한 줄'] }), []);
});

test('②⑤ 자동 제작: 사실 카드 연락처를 글 끝에 붙이고 통과하면 승인 대기 · 틀 문구·다른 브랜드가 섞이면 승인함 대신 수정 요청(이유와 함께)', async () => {
  const ok = await slot(ga.id, { day: 40, ago: 3 });
  const bad = await slot(ga.id, { day: 40, hour: 18, ago: 2 });
  await ctl({ anthropicReset: true, anthropicQueue: [
    say({ title: '가을 행사', body: '가을 행사를 엽니다. 이번 주 토요일까지 이어집니다.' }),
    say({ title: '운동 기록', body: '아직도 운동 기록을 종이에 쓰고 계신가요? 누리링크 회원도 함께 쓰는 방법을 정리했습니다.' }),
  ] });
  const r = await run();
  assert.deepEqual(r.produced.filter((p) => [ok, bad].includes(p.id)).map((p) => p.error ?? null), [null, null], JSON.stringify(r.produced));
  const a = await row(ok);
  assert.match(await latest(ok), new RegExp(`이번 주 토요일까지 이어집니다\\.\\n문의 ${PHONE}`));
  assert.equal(a.status, 'pending', JSON.stringify(a.quality));
  assert.deepEqual(a.quality.report.preflight, []);
  assert.ok(a.quality.report.notes.some((n) => n.includes(`연락처 줄을 붙임(사실 카드: 문의 ${PHONE})`)), JSON.stringify(a.quality.report.notes));
  const b = await row(bad);
  assert.equal(b.status, 'changes');
  assert.ok(b.quality.issues.some((x) => /틀 문구 그대로/.test(x)) && b.quality.issues.some((x) => /'누리링크'/.test(x)), JSON.stringify(b.quality.issues));
  assert.deepEqual(b.quality.preflight, b.quality.report.preflight);
  const n = await sql`select title, body from notifications where entity_id = ${bad} order by created_at desc limit 1`;
  assert.match(n[0]?.title ?? '', /품질 검사 미통과/);
  // 상세: 글 품질 칸에 올리기 전 검사 결과, 위 노란 칸에는 그 밖의 문제만
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${bad}`);
  assert.deepEqual(d.qualityReport.preflight, b.quality.preflight);
  // 사람이 고친 수정본 = 승인 대기 · 이전 본문의 검사 결과는 지움 · 상세는 새 본문으로 다시 검사(보여 주기만)
  await ctx.owner.ok('POST', `/api/marketing/contents/${bad}/versions`, { body: `운동 기록을 남기는 쉬운 방법을 정리했습니다. 자세한 연락처는 이미지 참조해 주세요.`, mediaIds: [] });
  const h = await row(bad);
  assert.equal(h.status, 'pending');
  assert.equal(h.quality?.preflight, undefined);
  assert.ok(!(h.quality?.issues ?? []).some((x) => /틀 문구|누리링크/.test(x)), JSON.stringify(h.quality));
  const d2 = await ctx.owner.ok('GET', `/api/marketing/contents/${bad}`);
  assert.ok(d2.qualityReport.preflight.some((x) => /이미지 참조/.test(x)), JSON.stringify(d2.qualityReport));
  assert.equal(d2.content.status, 'pending', '사람이 올린 글은 막지 않음');
});

test('⑥ 릴스: 캡션에 섞인 컷 대본은 대본 칸(quality.script)으로 — 게시 글(캡션)에는 안 남음 · 스토리는 스티커 제안 줄 모양을 맞춤', async () => {
  const reels = await slot(ga.id, { kind: 'reels', day: 30, ago: 3 });
  const story = await slot(ga.id, { kind: 'story', day: 30, hour: 20, ago: 2 });
  await ctl({ anthropicReset: true, anthropicQueue: [
    say({ title: '운동 기록', body: '운동 기록을 남기는 가장 쉬운 방법입니다. 오늘 바로 써 볼 수 있습니다.\n[컷1] 앱을 여는 손\n[컷2] 기록 버튼을 누름\n[컷3] 그래프가 쌓임' }),
    say({ title: '토요일 체험', body: '이번 주 토요일 오전 무료 체험\n[질문 스티커] 가장 궁금한 운동은?' }),
  ] });
  await run();
  const body = await latest(reels);
  assert.doesNotMatch(body, /컷\d|앱을 여는 손/);
  const r = await row(reels);
  assert.deepEqual(r.quality.script, ['앱을 여는 손', '기록 버튼을 누름', '그래프가 쌓임']);
  assert.ok(r.quality.report.notes.some((n) => /컷 대본 3줄을 캡션에서 대본 칸으로 옮김/.test(n)), JSON.stringify(r.quality.report.notes));
  assert.ok(!(r.quality.report.preflight ?? []).some((x) => /대본/.test(x)), JSON.stringify(r.quality.report.preflight));
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${reels}`);
  assert.deepEqual(d.content.quality.script, r.quality.script);
  const s = await latest(story);
  assert.match(s, /^이번 주 토요일 오전 무료 체험\n스티커 제안: 가장 궁금한 운동은\?/);
  assert.doesNotMatch(s, new RegExp(PHONE), '스토리는 연락처 줄을 붙이지 않음');
  assert.ok(!((await row(story)).quality.report.preflight ?? []).length, JSON.stringify((await row(story)).quality.report.preflight));
});

test('③ 주제 풀: 회사 공통 테마보다 먼저 · 가장 오래 안 쓴 주제 · 같은 날 묶음은 같은 주제 · 다른 브랜드가 앞뒤 3일에 쓴 주제는 건너뜀', async () => {
  // 앞 시험에서 쓴 주제가 없는 새 브랜드로(가온짐은 앞 시험에서 풀 주제를 이미 씀)
  ba = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '바름짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${ba.id}`, { intro: '동네 필라테스', topicPool: ['처음 오는 날 준비물', '운동 기록 앱 쓰는 법', '샤워실 이용 시간'] });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${nu.id}`, { intro: '아파트 커뮤니티 앱', topicPool: ['처음 오는 날 준비물', '주차 안내'] });
  const n10 = await slot(nu.id, { day: 10, ago: 9 });
  const a10 = await slot(ba.id, { day: 10, ago: 8 });
  const b10 = await slot(ba.id, { kind: 'reels', day: 10, hour: 18, ago: 7 });
  const a11 = await slot(ba.id, { day: 11, ago: 6 });
  const a20 = await slot(ba.id, { day: 20, ago: 5 });
  await ctl({ anthropicReset: true });
  const n0 = await seen();
  const made = await run();
  assert.equal(made.produced.filter((p) => [n10, a10, b10, a11, a20].includes(p.id) && !p.error).length, 5, JSON.stringify(made.produced));
  const topic = async (id) => { const r = (await row(id)).rationale; return [r?.topic, r?.topicFrom]; };
  assert.deepEqual(await topic(n10), ['처음 오는 날 준비물', 'pool']);
  assert.deepEqual(await topic(a10), ['운동 기록 앱 쓰는 법', 'pool'], '누리링크가 같은 날 쓴 주제는 건너뜀');
  assert.deepEqual(await topic(b10), ['운동 기록 앱 쓰는 법', 'pool'], '같은 날 묶음 = 같은 주제');
  assert.deepEqual(await topic(a11), ['샤워실 이용 시간', 'pool'], '가장 오래 안 쓴 주제');
  assert.deepEqual(await topic(a20), ['처음 오는 날 준비물', 'pool'], '3일 밖이면 다시 씀');
  // 원고 지시문: 주제 풀 주제를 그대로 · 회사 공통 테마 안내는 없음
  const prompts = await promptsAfter(n0);
  assert.ok(prompts.some((p) => p.includes('이번 글 주제: 샤워실 이용 시간')));
  assert.ok(!prompts.some((p) => p.includes('회사 공통 테마')), '주제 풀이 있는 브랜드에는 회사 공통 테마 안내가 없음');
  // 상세 '왜 이 글인가'에 주제와 어디서 골랐는지
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${a11}`);
  assert.deepEqual([d.content.rationale.topic, d.content.rationale.topicFrom], ['샤워실 이용 시간', 'pool']);
});

test('③ 주제가 따로 없는 브랜드만 회사 공통 테마 — 그대로 쓰지 말고 이 브랜드에 맞게 바꾸라고 안내 · 예전 글을 다시 만들면 주제를 새로 고름', async () => {
  const c = await slot(se.id, { day: 11, ago: 1 });
  await ctl({ anthropicReset: true });
  const n0 = await seen();
  await run();
  const r = await row(c);
  assert.deepEqual([r.rationale.topic, r.rationale.topicFrom], [COMPANY, 'company']);
  const p = (await promptsAfter(n0)).find((x) => x.includes("브랜드 이름은 '세움공방' 그대로"));
  assert.ok(p?.includes(`이번 주 회사 공통 테마: ${COMPANY} — 그대로 쓰지 말고`), p?.slice(0, 400));
  // 예전(이 규칙 전) 글: 근거에 topicFrom 이 없음 → [AI 다시 만들기]는 브랜드 주제 풀에서 새로 고름 / 이 규칙으로 고른 글은 그 주제를 그대로
  const [old] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, rationale)
    values ('default', ${ga.id}, '예전 글', 'instagram', 'feed', now() + interval '25 days', 'pending', 1, ${ctx.ownerId}, true, now(), ${sql.json({ topic: COMPANY, source: 'goal', week: 1 })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${old.id}, 1, '예전 본문입니다. 두 문장입니다.', '{}', ${ctx.ownerId})`;
  await ctl({ anthropicReset: true });
  await ctx.owner.ok('POST', `/api/marketing/auto/contents/${old.id}`, { action: 'regen' });
  const o = (await row(old.id)).rationale;
  assert.equal(o.topicFrom, 'pool', JSON.stringify(o));
  assert.ok(['처음 오는 날 준비물', '운동 기록 앱 쓰는 법', '샤워실 이용 시간'].includes(o.topic), o.topic);
  await ctx.owner.ok('POST', `/api/marketing/auto/contents/${old.id}`, { action: 'regen' });
  assert.equal((await row(old.id)).rationale.topic, o.topic, '이 규칙으로 고른 주제는 다시 만들어도 그대로');
});

test('③ [AI로 주제 20개 제안]: 저장 안 함 · 이미 있는 주제·다른 브랜드 이름이 든 주제·중복은 뺌 · 소개가 없으면 먼저 적어 달라고', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [reply({ topics: ['처음 오는 날 준비물', '누리링크와 함께하는 운동', '퇴근 뒤 20분 운동 순서', '퇴근 뒤 20분 운동 순서', '비 오는 날 실내 운동'] })] });
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${ga.id}/topic-draft`, {});
  assert.deepEqual(r.topics, ['퇴근 뒤 20분 운동 순서', '비 오는 날 실내 운동']);
  const [b] = await sql`select topic_pool from mkt_brands where id = ${ga.id}`;
  assert.equal(b.topic_pool.length, 3, '저장 안 함');
  const empty = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '빈브랜드' });
  const e = await ctx.owner.post(`/api/marketing/auto/brands/${empty.id}/topic-draft`, {});
  assert.equal(e.status, 400);
  assert.match(e.body.error?.message ?? '', /브랜드 소개·주력 상품/);
});

test("137차 다른 브랜드 영문·다른 이름: 사실 카드 '다른 이름'·피드 머리줄 영문·홈페이지 주소 이름도 거름 · 낱말 일부·자기 브랜드 표기는 그대로 · 주제 제안에서도 뺌", async () => {
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${nu.id}`, { facts: { website: 'https://www.nuri-link.test/about', aliases: ['NURI LINK'] } });
  assert.deepEqual((await sql`select facts from mkt_brands where id = ${nu.id}`)[0].facts.aliases, ['NURI LINK']);
  await sql`update mkt_brands set feed = coalesce(feed, '{}'::jsonb) || ${sql.json({ header: 'SEUM WORKS' })} where id = ${se.id}`;
  const pf = async (body, brandId = ga.id) => (await ctx.owner.ok('POST', '/api/marketing/quality/check', { channel: 'instagram', kind: 'feed', title: '가을 안내', brandId, body })).preflight;
  const brandIssue = (list) => list.find((x) => /다른 브랜드·회사 이름/.test(x)) ?? null;
  const tail = `이번 주 토요일입니다.\n문의 ${PHONE}`;
  assert.match(brandIssue(await pf(`NURI LINK 회원도 함께할 수 있습니다. ${tail}`)) ?? '', /'NURI LINK'/, '사실 카드 다른 이름');
  assert.match(brandIssue(await pf(`Nurilink 앱으로 확인하세요. ${tail}`)) ?? '', /'nurilink'/, '홈페이지 주소 이름(nuri-link → nurilink)');
  assert.match(brandIssue(await pf(`SEUM WORKS 클래스와 함께합니다. ${tail}`)) ?? '', /'SEUM WORKS'/, '피드 머리줄 영문');
  assert.equal(brandIssue(await pf(`nurilinked 같은 낱말은 괜찮습니다. ${tail}`)), null, '낱말 일부는 걸지 않음');
  assert.equal(brandIssue(await pf('NURI LINK 가을 행사를 엽니다. 이번 주 토요일입니다.\n자세히 www.nuri-link.test/about', nu.id)), null, '자기 브랜드 글의 자기 영문 이름·주소는 그대로');
  await ctl({ anthropicReset: true, anthropicQueue: [reply({ topics: ['NURI LINK 앱 안내', '아침 운동 루틴 짜기'] })] });
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${ga.id}/topic-draft`, {});
  assert.deepEqual(r.topics, ['아침 운동 루틴 짜기'], '다른 브랜드 영문 이름이 든 주제는 뺌');
});
