// 250차 #785(대표 10/28 23:00 "항상 지원사업 올릴 때 AI 비서 돌리세요"): 정기 실행마다 새 공고(1차 규칙 '해당 없음' 아님)를 AI 판단(자동 판단 켠 회사·회사 AI 예산 안)
// · 판단 차례인 것만 'AI 확인 중'(queued) · 그대로면 다시 안 읽음 · 새 공고만 · 판단 기준 칸이 바뀌면 '예전 프로필 기준' → 다시 판단 · 예산 다 쓰면 멈춤 안내 → 채워지면 이어서
// · 실패는 공고마다 3번까지 · 회사가 끄면 안 함 · 사용량 화면 이름 '지원사업 AI 판단'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb, tick, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fg;
const today = seoulToday(); const d = (n) => addDays(today, n);
const EFFECT = { receive: '마케팅 비용 지원', amount: null, selfPay: '공고문 확인', prepHours: 4, perBusiness: [], confirm: [] }; // 251차부터 기대 효과가 없는 판단은 자동으로 한 번 다시 — 시험 답에는 늘 넣음
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify({ reasons: ['경기 소재 중소기업 — 해당'], brands: [], docs: [], summary: '요약', amount: null, use: [], schedule: null, effect: EFFECT, ...o }) }], stop_reason: 'end_turn' });
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: ['경기'], nationwide: false, hashtags: [], attachments: sql.json([]), apply_end: d(20), target: '중소기업', agency: '경기도', ...o })} returning id`.then((r) => r[0].id);
const PROFILE = { regionSido: '경기', regionSigungu: '용인시', founded: d(-1735), size: '소기업', employees: 8, industries: ['소프트웨어'], keywords: [], certs: [], brands: ['워크인'], interests: ['마케팅'], excludes: [], memo: '시험 회사' };
const list = async () => Object.fromEntries((await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200&sort=new&dd=all&kind=all')).items.map((x) => [x.id, x]));
const auto = async () => (await tick()).detail?.supportAuto;
const ai = async (id) => (await sql`select ai_verdict, ai_auto, auto_fail from support_matches where program_id = ${id}`)[0] ?? null;

before(async () => {
  await resetDb(); fg = await startFakeGoogle(); srv = await startServer({ SUPPORT_WEEKLY: 'off' }); sql = testDb(); ctx = await bootstrap(); // SUPPORT_AUTO_AI 없음 = 켬(기본)
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
});
after(async () => { srv?.proc.kill(); fg?.server.close(); await sql?.end(); });

test('프로필 저장 전에는 안 함 → 저장(자동 판단 기본 켬) → 해당 없음 아닌 새 공고만 판단 차례 → 정기 실행 = AI 판단(자동 표시) → 그대로면 다시 안 읽음 → 새 공고 1건만', async () => {
  const a = await ins({ source_id: 'A1', title: '[경기] 용인시 중소기업 마케팅 지원' });
  const b = await ins({ source_id: 'A2', title: '2026 무료 법률 자문', regions: [], nationwide: true, agency: '중소벤처기업부' });
  const c = await ins({ source_id: 'A3', title: '[부산] 부산 수출기업 지원', regions: ['부산'], agency: '부산광역시' });
  await queue([]);
  assert.equal((await auto()).tenants, 0, '프로필이 없으면 자동 판단 안 함');
  await ctx.owner.ok('PUT', '/api/sales/support/profile', PROFILE);
  const p = await ctx.owner.ok('GET', '/api/sales/support/profile'); assert.equal(p.autoAi, true, '기본 켬');
  let v = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  assert.deepEqual([v.auto.on, v.auto.queue, v.auto.stopped], [true, 2, null], JSON.stringify(v.auto));
  let L = await list();
  assert.deepEqual([L[a].queued, L[b].queued, L[c].queued], [true, true, false], '1차 규칙 해당 없음(부산)은 판단 안 함');
  await queue([say({ verdict: 'fit' }), say({ verdict: 'maybe' })]);
  const r1 = await auto();
  assert.deepEqual(r1.out.default, { done: 2, failed: 0, left: 0, stopped: null }, JSON.stringify(r1));
  assert.deepEqual([(await ai(a)).ai_auto, (await ai(b)).ai_auto, await ai(c)], [true, true, null]);
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_support' and user_id = ${ctx.ownerId}`)[0].n, 2, '사용량은 회사 대표 이름으로');
  L = await list(); assert.deepEqual([L[a].queued, L[b].queued, [L[a].ai.verdict, L[b].ai.verdict].sort()], [false, false, ['fit', 'maybe']]); // 5건씩 함께 보내 답 순서는 정해지지 않음
  v = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all'); assert.deepEqual([v.auto.queue, v.auto.done], [0, 2]);
  // 다음 실행: 남은 것 없음 → 한 번 확인하고(지문 저장) → 그다음부터는 공고를 다시 읽지 않음
  await queue([]);
  assert.deepEqual((await auto()).out.default, { done: 0, failed: 0, left: 0, stopped: null });
  assert.deepEqual((await auto()).out.default, { skipped: 'same' }, '새 공고·프로필이 그대로면 건너뜀');
  // 수집기가 새 공고를 넣으면 그것만
  const e = await ins({ source_id: 'A4', title: '[경기] 용인시 중소기업 판로 마케팅 바우처' });
  await queue([say({ verdict: 'fit' })]);
  assert.deepEqual((await auto()).out.default, { done: 1, failed: 0, left: 0, stopped: null });
  assert.equal((await ai(e)).ai_verdict, 'fit');
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_support'`)[0].n, 3);
});

test('판단 기준 칸(상시근로자)이 바뀌면 그 전 판단은 예전 프로필 기준 → 다시 판단 차례 → 다시 판단 · 회사 소개만 바꾸면 그대로', async () => {
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, memo: '소개만 바꿈' });
  let L = await list();
  assert.ok(Object.values(L).every((x) => !x.ai?.stale), '소개만 바꾸면 예전 판단 그대로');
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, employees: 30 });
  L = await list();
  const stale = Object.values(L).filter((x) => x.ai?.stale);
  assert.equal(stale.length, 3, JSON.stringify(Object.values(L).map((x) => [x.title, x.ai?.stale, x.queued])));
  assert.ok(stale.every((x) => x.queued), '예전 프로필 기준 = 다시 판단 차례');
  await queue([0, 1, 2].map(() => say({ verdict: 'fit', reasons: ['상시근로자 30명 — 해당'] })));
  assert.deepEqual((await auto()).out.default, { done: 3, failed: 0, left: 0, stopped: null });
  L = await list(); assert.ok(Object.values(L).every((x) => !x.ai?.stale && !x.queued));
});

test('회사 AI 예산을 다 쓰면 멈춤(공고 실패로 안 셈·AI 부르지 않음) → 화면 안내·AI 확인 중 아님 → 예산이 채워지면 이어서 · 실패는 공고마다 3번까지 · 회사가 끄면 안 함 · 사용량 이름', async () => {
  const f = await ins({ source_id: 'A5', title: '[경기] 용인시 중소기업 온라인 마케팅 지원' });
  const [big] = await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose) values ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'test', 0, 0, 100000, 'test_fill') returning id`;
  await queue([]);
  const r = await auto();
  assert.equal(r.out.default.done, 0); assert.match(String(r.out.default.stopped), /ai_budget|ai_quota|limit|budget/, JSON.stringify(r));
  assert.equal((await ai(f))?.auto_fail ?? 0, 0, '예산 멈춤은 공고 실패가 아님');
  const v = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  assert.ok(v.auto.stopped && v.auto.left >= 1, JSON.stringify(v.auto));
  assert.equal(v.items.find((x) => x.id === f).queued, false, '멈췄으면 AI 확인 중이 아님(규칙상 맞음 · AI 판단 전)');
  await sql`delete from ai_usage where id = ${big.id}`;
  await queue([say({ verdict: 'fit' })]);
  assert.deepEqual((await auto()).out.default, { done: 1, failed: 0, left: 0, stopped: null }, '예산이 채워지면 이어서');
  // 실패(응답을 못 읽음)는 공고마다 세고 3번 실패하면 차례에서 뺌
  const g = await ins({ source_id: 'A6', title: '[경기] 용인시 중소기업 마케팅 교육' });
  for (let i = 1; i <= 3; i++) {
    await queue([{ content: [{ type: 'text', text: 'JSON 아님' }], stop_reason: 'end_turn' }]);
    const x = await auto(); assert.equal(x.out.default.failed, 1, JSON.stringify(x));
    assert.equal((await ai(g)).auto_fail, i);
  }
  await queue([]);
  assert.deepEqual((await auto()).out.default, { done: 0, failed: 0, left: 0, stopped: null }, '3번 실패한 공고는 자동으로 다시 안 함');
  assert.equal((await list())[g].queued, false);
  // 회사가 끄면 안 함
  const h = await ins({ source_id: 'A7', title: '[경기] 용인시 중소기업 마케팅 자금' });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, employees: 30, autoAi: false });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/support/profile')).autoAi, false);
  assert.equal((await auto()).tenants, 0); assert.equal(await ai(h), null);
  const v2 = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  assert.deepEqual([v2.auto.on, v2.auto.enabled, v2.items.find((x) => x.id === h).queued, v2.items.find((x) => x.id === h).pending], [false, false, false, true]);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/support/profile', { ...PROFILE, autoAi: true })).status, 403, '켜고 끄기는 관리자만');
  // 관리 › 사용량 '기능별' 이름
  const { aiPurposeLabel } = await import('../../src/components/aiPurpose.ts');
  assert.equal(aiPurposeLabel('sales_support'), '지원사업 AI 판단');
});

test('270차 #810: 밀린 공고가 보통 수(10건)보다 많으면 응답 뒤 작업으로 끝까지(4건씩) — 정기 실행은 바로 끝나고 판단은 뒤에서 이어짐', async () => {
  await sql`delete from support_programs where source_id like 'B%'`;
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, autoAi: true });
  const ids = []; for (let i = 1; i <= 13; i++) ids.push(await ins({ source_id: `B${i}`, title: `[경기] 용인시 중소기업 판로 지원 ${i}차` }));
  const before = new Set((await sql`select program_id from support_matches where ai_verdict is not null`).map((x) => x.program_id));
  const todo = ids.filter((x) => !before.has(x));
  await queue(Array.from({ length: 20 }, () => say({ verdict: 'fit' })));
  const r = await auto();
  assert.ok(r.out.default.background >= todo.length, `뒤에서 판단(앞 시험에서 남은 공고 포함): ${JSON.stringify(r.out.default)}`);
  let left = ids.length;
  for (let k = 0; k < 80 && left; k++) { await new Promise((ok) => setTimeout(ok, 250)); left = 0; for (const id of ids) if (!(await ai(id))?.ai_verdict) left++; }
  assert.equal(left, 0, '13건 모두 판단(버튼 없이)');
  let runs = [];
  for (let k = 0; k < 40 && !runs.length; k++) { runs = await sql`select status, detail from job_runs where job = 'supportAuto:default' order by id desc limit 1`; if (!runs.length) await new Promise((ok) => setTimeout(ok, 250)); }
  assert.equal(runs[0]?.status, 'ok', '응답 뒤 작업 기록(job_runs)');
  const [st] = await sql`select auto_state from support_profiles where tenant = 'default'`;
  assert.deepEqual([st.auto_state.left, st.auto_state.stopped], [0, null]);
});
