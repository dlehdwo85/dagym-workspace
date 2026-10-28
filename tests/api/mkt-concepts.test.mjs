// #499-4 상황 매트릭스 소재 생성기(테크트리 EP.12 '경우의 수 쪼개기'): [AI로 채우기] · 역할 × 상황 → AI 컨셉(광고형 점수·금지어·자리표시) → 승인 대기(승인함 '광고 컨셉'·알림)
// → 대표 1~4개 채택 → 광고형 제작 의뢰(릴스/피드·문의·컨셉 재료) + 응답 뒤 프롬프트 → 브랜드 기억(다음 매트릭스 재료) · 반려 사유 → AI 고친 안(3판까지) · AI 실패 → 기본 조합 · 취소 · 새 각도
// 가짜 AI 응답 = 구조 시험(실제 컨셉 품질은 확인 못함)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const lastAi = () => JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
const S1 = { name: '신축 입주 3~6개월 전', pain: '운영사·인력이 아직 미정', offer: '입주 준비 체크리스트' };
const S2 = { name: '재계약 시점', pain: '업체 교체를 고민', offer: '위탁 vs 직영 비교표' };
const GOOD = '입주 앞둔 단지 관리소장님, 입주 준비 체크리스트 무료로 드려요';
const concept = (o = {}) => ({ role: '관리사무소장', situation: S1.name, pain: S1.pain, offer: S1.offer, hook: GOOD, headline: '입주 준비 체크리스트 무료',
  primary: '입주 앞둔 단지 관리소장님께.\n체크리스트를 무료로 드립니다.\n양식에 단지명만 남겨 주세요.', angle: '입주 준비 압박을 첫 줄에서 지목', format: 'image', ...o });
const input = (o = {}) => ({ brandId: P.brand, product: '아파트 커뮤니티 위탁 운영', roles: ['입주자대표회의', '관리사무소장'], situations: [S1, S2], ...o });
async function settled(ids) {
  for (let i = 0; i < 60; i++) { const r = await sql`select id, status from mkt_briefs where id = any(${ids}::uuid[])`; if (r.length === ids.length && r.every((x) => x.status === 'ready')) return r; await new Promise((ok) => setTimeout(ok, 200)); }
  throw new Error('제작 의뢰 프롬프트가 준비되지 않음');
}
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  P.other = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하이링크' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '아파트 커뮤니티 위탁 운영', products: '커뮤니티 운영·피트니스·GX' });
  await sql`update mkt_brands set banned_words = '{최고}' where id = ${P.brand}`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('[AI로 채우기] · [컨셉 만들기](직원도) → 정리(아이디·광고형 점수·자리표시·금지어) → 승인 대기 · 승인함 탭·알림 · 공간 밖 404', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ product: '아파트 커뮤니티 위탁 운영', roles: ['입주자대표회의', '관리사무소장', '입주자대표회의'], situations: [S1, S2] })] });
  const sg = await ctx.staffA.client.ok('POST', '/api/marketing/concepts/suggest', { brandId: P.brand });
  assert.deepEqual({ source: sg.source, roles: sg.roles, n: sg.situations.length, product: sg.product }, { source: 'ai', roles: ['입주자대표회의', '관리사무소장'], n: 2, product: '아파트 커뮤니티 위탁 운영' }, '같은 역할은 한 번');
  assert.match(lastAi(), /상황 매트릭스/); assert.match(lastAi(), /브랜드: 다짐/);
  assert.equal((await ctx.staffB.client.post('/api/marketing/concepts/suggest', { brandId: P.brand })).status, 404, '마케팅 공간 밖은 404');
  assert.equal((await ctx.staffB.client.get('/api/marketing/concepts')).status, 404);
  assert.equal((await ctx.staffA.client.post('/api/marketing/concepts', input({ roles: [] }))).status, 400, '역할 1개 이상');
  assert.equal((await ctx.staffA.client.post('/api/marketing/concepts', input({ brandId: '00000000-0000-0000-0000-00000000dead' }))).status, 404, '다른 회사·없는 브랜드');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ changes: '', concepts: [
    concept({ format: 'image' }),
    concept({ role: '입주자대표회의', situation: S2.name, pain: S2.pain, offer: S2.offer, hook: '재계약 앞둔 입대의, {{운영 단지 수}}곳 비교표 무료', format: 'video' }),
    concept({ role: '입주자대표회의', hook: '입주 앞둔 단지 입대의께 최고의 운영 제안서 드려요', format: 'image' }),
  ] })] });
  const { set } = await ctx.staffA.client.ok('POST', '/api/marketing/concepts', input({ note: '이번 달은 신축 단지 위주', count: 8 }));
  P.set = set.id; P.c3hook = set.concepts[2].hook;
  assert.deepEqual({ status: set.status, source: set.source, ids: set.concepts.map((c) => c.id), formats: set.concepts.map((c) => c.format), brand: set.brand }, { status: 'pending', source: 'ai', ids: ['c1', 'c2', 'c3'], formats: ['image', 'video', 'image'], brand: '다짐' });
  const [c1, c2, c3] = set.concepts;
  assert.ok(c1.score.pass && c1.score.score >= 60 && c1.decision === null, JSON.stringify(c1.score));
  assert.ok(!c2.score.pass && c2.score.fails.includes('채우지 않은 자리표시'), '지어내지 않고 비워 둔 숫자는 채워야 통과');
  assert.ok(!c3.score.pass && c3.score.fails.includes("금지어 '최고'"), '브랜드 금지어');
  assert.equal(c1.primary.split('\n').length, 3, '본문 줄바꿈 유지');
  const sent = lastAi();
  assert.match(sent, /컨셉 8개/); assert.match(sent, /\[역할\] 입주자대표회의 \/ 관리사무소장/); assert.match(sent, /메모: 이번 달은 신축 단지 위주/); assert.match(sent, /광고형\(전환\)/);
  assert.doesNotMatch(sent, /브랜드 기억/, '처음엔 이전 결정 없음');
  const [row] = await sql`select created_by, input from mkt_concept_sets where id = ${set.id}`;
  assert.equal(row.created_by, ctx.staffA.id); assert.deepEqual(row.input.roles, ['입주자대표회의', '관리사무소장']);
  const n = await sql`select user_id, link from notifications where dedupe_key = ${`mktconcept:${set.id}`}`;
  assert.ok(n.length >= 1 && n.every((x) => x.link === '/s/marketing/approvals?tab=concepts'), JSON.stringify(n));
  const inbox = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.equal(inbox.counts.concepts, 1); assert.equal(inbox.concepts[0].id, set.id);
  const sp = await ctx.owner.ok('GET', '/api/spaces');
  assert.equal(sp.summary.marketing.badge, 1, '사이드바·하단 탭 승인 대기 배지에도'); assert.match(sp.summary.marketing.text, /승인할 것 1건\(시안 0 · 운영 1\)/);
  const v = await ctx.staffA.client.ok('GET', '/api/marketing/concepts');
  assert.equal(v.canDecide, false); assert.equal(v.sets[0].id, set.id); assert.deepEqual(v.brands.map((b) => b.name).sort(), ['다짐', '하이링크']);
});

test('채택: 직원 403 · 0개·5개·없는 컨셉 400 → 2개 채택 → 광고형 제작 의뢰(이미지 = 피드·영상 = 릴스·문의·컨셉 재료) · 응답 뒤 프롬프트(컨셉 재료) · 다시 채택 409', async () => {
  const url = `/api/marketing/concepts/${P.set}`;
  assert.equal((await ctx.staffA.client.req('PATCH', url, { action: 'adopt', conceptIds: ['c1'] })).status, 403, '채택은 대표·관리자');
  assert.equal((await ctx.owner.req('PATCH', url, { action: 'adopt', conceptIds: [] })).status, 400);
  assert.equal((await ctx.owner.req('PATCH', url, { action: 'adopt', conceptIds: ['c1', 'c2', 'c3', 'c4', 'c5'] })).status, 400, '4개까지');
  assert.equal((await ctx.owner.req('PATCH', url, { action: 'adopt', conceptIds: ['c9'] })).status, 400, '없는 컨셉');
  const prompt = say({ promptEn: 'A photorealistic photo of a Korean apartment community lounge', negativeEn: 'text', summaryKo: '입주 준비 장면', caption: GOOD, refMediaIds: [] });
  await ctl({ anthropicReset: true, anthropicQueue: [prompt, prompt] });
  const n0 = fake.state.anthropic.length;
  const r = await ctx.owner.ok('PATCH', url, { action: 'adopt', conceptIds: ['c1', 'c2'], note: '관리소장 호명이 좋음' });
  assert.equal(r.status, 'decided'); assert.equal(r.briefs.length, 2);
  await settled(r.briefs.map((b) => b.briefId));
  const briefs = await sql`select kind, channel, purpose, mode, status, brand_id, created_by, refs, message from mkt_briefs where id = any(${r.briefs.map((b) => b.briefId)}::uuid[]) order by kind`;
  assert.deepEqual(briefs.map((b) => [b.kind, b.channel, b.purpose, b.mode, b.status]), [['feed', 'instagram', 'inquiry', 'ad', 'ready'], ['reels', 'instagram', 'inquiry', 'ad', 'ready']]);
  assert.ok(briefs.every((b) => b.brand_id === P.brand && b.created_by === ctx.ownerId && b.refs.conceptSetId === P.set));
  const feed = briefs.find((b) => b.kind === 'feed');
  assert.equal(feed.refs.concept.hook, GOOD); assert.equal(feed.refs.concept.offer, S1.offer); assert.ok(feed.message.startsWith(GOOD));
  const promptReqs = fake.state.anthropic.slice(n0).map((x) => JSON.stringify(x.body));
  assert.ok(promptReqs.some((t) => t.includes('광고 컨셉(상황 매트릭스에서 채택') && t.includes(GOOD) && t.includes('광고형(전환)')), '프롬프트에 채택한 컨셉 재료');
  const [row] = await sql`select status, concepts, executed, decision_note, decided_by from mkt_concept_sets where id = ${P.set}`;
  assert.deepEqual(row.concepts.map((c) => c.decision), ['adopted', 'adopted', 'rejected']);
  assert.deepEqual({ status: row.status, n: row.executed.briefs.length, note: row.decision_note, by: row.decided_by }, { status: 'decided', n: 2, note: '관리소장 호명이 좋음', by: ctx.ownerId });
  const again = await ctx.owner.req('PATCH', url, { action: 'adopt', conceptIds: ['c3'] });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'concept_decided');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/inbox')).counts.concepts, 0);
  const v = await ctx.owner.ok('GET', '/api/marketing/concepts');
  assert.deepEqual(v.sets.find((s) => s.id === P.set).briefs.map((b) => b.status), ['프롬프트 준비', '프롬프트 준비']);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.concepts_adopt' and target_id = ${P.set}`).length);
});

test('브랜드 기억: 다음 매트릭스 재료에 채택·반려·메모(다른 브랜드엔 안 섞음) · 반려 사유 → AI 고친 안 v2·v3(반영한 점·같은 줄기) → 3판이면 반려로 끝', async () => {
  const fresh = (hook) => say({ changes: '', concepts: [concept({ hook })] });
  await ctl({ anthropicReset: true, anthropicQueue: [fresh('관리소장님, 입주 준비 체크리스트 받아 가세요')] });
  const { set } = await ctx.owner.ok('POST', '/api/marketing/concepts', input());
  const mem = lastAi();
  assert.match(mem, /이전 결정 — 브랜드 기억/); assert.ok(mem.includes(GOOD), '채택한 첫 줄'); assert.ok(mem.includes(`반려: «${P.c3hook}»`), '반려한 첫 줄'); assert.match(mem, /대표 메모: 관리소장 호명이 좋음/);
  await ctl({ anthropicReset: true, anthropicQueue: [fresh('예약 오픈 앞둔 관리사무소, 예약 규칙 예시 드려요')] });
  await ctx.owner.ok('POST', '/api/marketing/concepts', input({ brandId: P.other, product: '커뮤니티 예약 시스템' }));
  assert.doesNotMatch(lastAi(), /브랜드 기억/, '다른 브랜드의 결정은 섞지 않음');
  // 반려 → v2(같은 줄기) → 반려 → v3 → 반려 → 끝
  await ctl({ anthropicReset: true, anthropicQueue: [say({ changes: '대상이 넓음 → 관리소장 한 역할로 좁힘', concepts: [concept({ hook: '관리소장님, 입주 3개월 전 체크리스트 무료' })] })] });
  const r1 = await ctx.owner.ok('PATCH', `/api/marketing/concepts/${set.id}`, { action: 'reject', note: '대상이 너무 넓음 — 관리소장 위주로' });
  assert.equal(r1.status, 'rejected'); assert.equal(r1.revised.version, 2); assert.equal(r1.revised.changes, '대상이 넓음 → 관리소장 한 역할로 좁힘');
  assert.match(lastAi(), /\[반려 사유\] 대상이 너무 넓음/); assert.match(lastAi(), /\[이전 안 v1\]/);
  const [v2] = await sql`select version, thread_id, revised_from, revision_note, status from mkt_concept_sets where id = ${r1.revised.id}`;
  assert.deepEqual({ ...v2 }, { version: 2, thread_id: set.id, revised_from: set.id, revision_note: '대상이 넓음 → 관리소장 한 역할로 좁힘', status: 'pending' });
  const [v1] = await sql`select status, concepts from mkt_concept_sets where id = ${set.id}`;
  assert.equal(v1.status, 'rejected'); assert.ok(v1.concepts.every((c) => c.decision === 'rejected'));
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/concepts/${set.id}`, { action: 'reject', note: '또 반려' })).status, 409, '이미 결정');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/concepts/${r1.revised.id}`, { action: 'reject', note: '' })).status, 400, '반려 사유 필수');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ changes: '제안을 비교표로', concepts: [concept({ hook: '관리소장님, 운영비 비교표 무료로 드려요' })] })] });
  const r2 = await ctx.owner.ok('PATCH', `/api/marketing/concepts/${r1.revised.id}`, { action: 'reject', note: '제안을 바꿔 주세요' });
  assert.equal(r2.revised.version, 3);
  assert.equal((await sql`select thread_id from mkt_concept_sets where id = ${r2.revised.id}`)[0].thread_id, set.id, '같은 줄기');
  const n0 = fake.state.anthropic.length;
  const r3 = await ctx.owner.ok('PATCH', `/api/marketing/concepts/${r2.revised.id}`, { action: 'reject', note: '이번 달은 보류' });
  assert.deepEqual([r3.status, r3.revised], ['rejected', null], '3판이면 더 고치지 않음');
  assert.equal(fake.state.anthropic.length, n0, 'AI 를 부르지 않음');
  const inbox = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.equal(inbox.counts.concepts, 1, '하이링크 매트릭스만 대기');
});

test('AI 실패 → 역할×상황 기본 조합(상황을 돌아가며) · 고친 안은 기본 조합으로 만들지 않음 · 취소(만든 사람·관리자) · 새 각도(채택한 컨셉만 · 대상·상황 그대로)', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 500, message: 'overloaded' }] });
  const { set } = await ctx.owner.ok('POST', '/api/marketing/concepts', input({ count: 8 }));
  assert.equal(set.source, 'template');
  assert.deepEqual(set.concepts.map((c) => `${c.situation}|${c.role}`), [`${S1.name}|입주자대표회의`, `${S2.name}|입주자대표회의`, `${S1.name}|관리사무소장`, `${S2.name}|관리사무소장`], '역할 2 × 상황 2 = 4개(상황을 돌아가며)');
  assert.equal(set.concepts[0].hook, `${S1.name}, 입주자대표회의께 ${S1.offer}`); assert.equal(set.concepts[0].offer, S1.offer);
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 500, message: 'overloaded' }] });
  const rj = await ctx.owner.ok('PATCH', `/api/marketing/concepts/${set.id}`, { action: 'reject', note: '다시' });
  assert.deepEqual([rj.status, rj.revised], ['rejected', null], 'AI 가 없으면 고친 안 없이 반려');
  // 취소: 만든 사람(관리자)·관리자만, 대기 중일 때만
  await ctl({ anthropicReset: true, anthropicQueue: [say({ changes: '', concepts: [concept()] })] });
  const mine = (await ctx.staffA.client.ok('POST', '/api/marketing/concepts', input())).set;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ changes: '', concepts: [concept()] })] });
  const owners = (await ctx.owner.ok('POST', '/api/marketing/concepts', input())).set;
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/concepts/${owners.id}`, { action: 'cancel' })).status, 403, '남이 만든 것');
  assert.equal((await ctx.staffA.client.ok('PATCH', `/api/marketing/concepts/${mine.id}`, { action: 'cancel' })).status, 'canceled');
  assert.equal((await ctx.owner.ok('PATCH', `/api/marketing/concepts/${owners.id}`, { action: 'cancel' })).status, 'canceled');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/concepts/${owners.id}`, { action: 'cancel' })).status, 400);
  assert.ok(!(await ctx.owner.ok('GET', '/api/marketing/concepts')).sets.some((s) => [mine.id, owners.id].includes(s.id)), '취소한 것은 목록에서 빠짐');
  // 새 각도: 채택한 c1 → 같은 대상·상황, 형식·각도만 바꾼 컨셉
  await ctl({ anthropicReset: true, anthropicQueue: [say({ changes: '', concepts: [concept({ hook: '관리소장님, 입주 준비 실수 5가지 체크리스트', format: 'video' }), concept({ hook: '입주 3개월 전 관리소장님이 묻는 질문 3가지 답변서', format: 'image' })] })] });
  const vr = await ctx.owner.ok('POST', `/api/marketing/concepts/${P.set}/variant`, { conceptId: 'c1' });
  assert.equal(vr.set.status, 'pending'); assert.equal(vr.set.concepts.length, 2);
  assert.deepEqual([vr.set.input.roles, vr.set.input.situations.map((x) => x.name), vr.set.input.variantOf.hook], [['관리사무소장'], [S1.name], GOOD]);
  assert.match(lastAi(), /\[새 각도\]/); assert.match(lastAi(), /이긴 컨셉/); assert.match(lastAi(), /컨셉 5개/);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/concepts/${P.set}/variant`, { conceptId: 'c3' })).status, 400, '반려한 컨셉은 안 됨');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/concepts/${P.set}/variant`, { conceptId: 'c7' })).status, 404);
});
