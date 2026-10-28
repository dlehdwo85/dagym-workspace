// 251차 #783·#784 + 로컬 10/28 23:50 249·250 운영 확인: AI 판단 기대 효과(받는 것·예상 금액·자부담·준비 시간·사업별·확인할 것) · AI 에 1차 규칙 결과 함께
// · 규칙 '해당 없음'이 AI '확인 필요'보다 앞섬 · AI 해당 + 규칙 해당 없음 = '규칙과 다름' · 규칙을 못 본 예전 판단은 자동으로 한 번 다시
// · 이번 주 신청 목록(담기·빼기·표·엑셀·담당에게 업무로 → 신청하면 빠짐) · '보유 인증 없음' · 종류 '돈'은 현금·융자·바우처만 · 제목 낱말 앞 다른 시·도 = 확인 필요 · 시험 조직은 자동 판단 안 함
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, FAKE, bootstrap, resetDb, startServer, testDb, tick, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fg;
const today = seoulToday(); const d = (n) => addDays(today, n);
const EFFECT = { receive: '청년 채용 인건비 지원', amount: '최대 720만 원(청년 1명 기준)', selfPay: '없음', prepHours: 3.3, perBusiness: [{ brand: '다짐', line: '트레이너 채용 인건비' }, { brand: '없는브랜드', line: '빠져야 함' }], confirm: ['고용보험 피보험자 5명 이상인지', '작년 매출'] };
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify({ reasons: ['경기 소재 중소기업 — 해당'], brands: [], docs: ['신청서'], summary: '요약', amount: null, use: [], schedule: null, effect: EFFECT, ...o }) }], stop_reason: 'end_turn' });
const ctl = (o) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
const queue = (items) => ctl({ anthropicReset: true, anthropicQueue: items });
const lastAsk = async () => (await (await fetch(`${FAKE}/__state`)).json()).anthropic.at(-1).body;
const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: ['경기'], nationwide: false, hashtags: [], attachments: sql.json([]), apply_end: d(20), target: '중소기업', agency: '경기도', ...o })} returning id`.then((r) => r[0].id);
const PROFILE = { regionSido: '경기', regionSigungu: '용인시', founded: d(-1735), size: '소기업', employees: 8, industries: ['소프트웨어'], keywords: [], certs: [], brands: ['다짐', '워크인'], interests: ['마케팅', '고용'], excludes: [], memo: '시험 회사' };
const all = async () => Object.fromEntries((await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200&sort=new&dd=all&kind=all')).items.map((x) => [x.id, x]));

before(async () => {
  await resetDb(); fg = await startFakeGoogle(); srv = await startServer({ SUPPORT_WEEKLY: 'off' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, autoAi: false });
});
after(async () => { srv?.proc.kill(); fg?.server.close(); await sql?.end(); });

test('#783 기대 효과 저장(사업별은 우리 브랜드만·준비 시간 반올림) · AI 에 1차 규칙 결과 · 규칙 해당 없음 > AI 확인 필요 · AI 해당 + 규칙 해당 없음 = 규칙과 다름', async () => {
  const a = await ins({ source_id: 'L1', title: '[경기] 용인시 청년 고용 마케팅 지원' });
  await queue([say({ verdict: 'fit' })]);
  const r = await ctx.owner.ok('POST', `/api/sales/support/${a}/analyze`, {});
  assert.deepEqual(r.ai.effect, { ...EFFECT, prepHours: 3.5, perBusiness: [{ brand: '다짐', line: '트레이너 채용 인건비' }] });
  assert.match((await lastAsk()).messages[0].content[0].text, /\[1차 규칙\] (해당|확인 필요)\n[\s\S]*\[공고\]\n공고명: /);
  const dt = await ctx.owner.ok('GET', `/api/sales/support/${a}`);
  assert.deepEqual([dt.item.ai.effect.receive, dt.item.ai.ruleAt, dt.item.final.by], ['청년 채용 인건비 지원', dt.item.rule.verdict, 'ai']);
  // 규칙 '해당 없음'(울산 기관) — AI 확인 필요 → 해당 없음(규칙) · AI 해당 → 규칙과 다름(맞춤에 남되 아래로)
  const b = await ins({ source_id: 'L2', title: '2026 스타트업 법률상담회', regions: [], nationwide: true, agency: '울산경제일자리진흥원' });
  const c = await ins({ source_id: 'L3', title: '2026 스타트업 마케팅 IR', regions: [], nationwide: true, agency: '울산경제일자리진흥원' });
  await sql`insert into support_matches (tenant, program_id, ai_verdict, ai_at) values ('default', ${b}, 'maybe', now()), ('default', ${c}, 'fit', now())`; // 로컬 일괄 판단(규칙 못 봄)처럼
  let L = await all();
  assert.deepEqual(L[b].final, { verdict: 'no', by: 'rule', conflict: false }, JSON.stringify(L[b].rule.flags));
  assert.deepEqual(L[c].final, { verdict: 'fit', by: 'ai', conflict: true });
  const fit = (await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all')).items.map((x) => x.id);
  assert.ok(!fit.includes(b) && fit.includes(c), '규칙 해당 없음 + AI 확인 필요는 맞춤에서 빠짐, 규칙과 다름은 남음');
  assert.ok(fit.indexOf(a) < fit.indexOf(c), '규칙과 다름은 확인 필요 자리로');
  // 자동 판단 켬 → 규칙을 못 본 예전 판단(b·c)은 한 번 다시(규칙 결과를 함께) → 다음엔 차례 아님
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, autoAi: true });
  L = await all(); assert.deepEqual([L[a].queued, L[b].queued, L[c].queued], [false, true, true]);
  await queue([0, 1].map(() => say({ verdict: 'fit', reasons: ['전국 기업 참가 가능 — 규칙이 틀림'] }))); // 5건씩 함께 보내므로 답 순서는 정해지지 않음 — 둘 다 같은 답
  assert.deepEqual((await tick()).detail.supportAuto.out.default, { done: 2, failed: 0, left: 0, stopped: null });
  assert.match((await lastAsk()).messages[0].content[0].text, /\[1차 규칙\] 해당 없음\n- 해당 없음: 울산 기관 공고\(우리 경기\)/, 'AI 에 규칙의 해당 없음 근거를 함께');
  L = await all();
  assert.deepEqual([L[b].queued, L[c].queued, L[b].ai.ruleAt, L[c].ai.ruleAt, L[b].final.conflict, L[c].final.conflict], [false, false, 'no', 'no', true, true], '규칙을 보고도 해당이면 규칙과 다름으로 남고 다시 안 함');
  // 시험·체험 조직은 자동 판단 안 함
  await sql`update tenants set is_test = true where id = 'default'`;
  assert.equal((await tick()).detail.supportAuto.tenants, 0);
  await sql`update tenants set is_test = false where id = 'default'`;
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, autoAi: false });
  await sql`delete from support_programs where source_id like 'L%'`;
});

test('#784 이번 주 신청 목록: 담기(누구나) → 신청 목록 탭(마감 순) → 엑셀(CSV·수식 막기) → 담당 골라 업무로(신청 준비) → 신청 완료면 빠짐 · 빼기', async () => {
  const a = await ins({ source_id: 'M1', title: '=CMD 마케팅 지원 "따옴표", 쉼표', apply_end: d(9) });
  const b = await ins({ source_id: 'M2', title: '[경기] 용인시 고용 지원', apply_end: d(3) });
  await queue([say({ verdict: 'fit' })]); await ctx.owner.ok('POST', `/api/sales/support/${b}/analyze`, {});
  await ctx.staffA.client.ok('POST', `/api/sales/support/${a}/list`, { on: true });
  await ctx.owner.ok('POST', `/api/sales/support/${b}/list`, { on: true });
  await ctx.owner.ok('POST', `/api/sales/support/${b}/list`, { on: true }); // 다시 눌러도 그대로
  const v = await ctx.owner.ok('GET', '/api/sales/support?tab=list');
  assert.deepEqual([v.counts.list, v.items.map((x) => x.id), v.sortUsed], [2, [b, a], 'deadline']);
  const [m] = await sql`select listed_by from support_matches where program_id = ${a}`; assert.equal(m.listed_by, ctx.staffA.id);
  const csv = await ctx.owner.req('GET', '/api/sales/support/export');
  assert.equal(csv.status, 200); const body = typeof csv.body === 'string' ? csv.body : JSON.stringify(csv.body);
  const raw = new Uint8Array(await (await fetch(`${BASE}/api/sales/support/export`, { headers: { cookie: ctx.owner.cookie, origin: BASE } })).arrayBuffer());
  assert.deepEqual([...raw.slice(0, 3)], [0xef, 0xbb, 0xbf], '엑셀이 한글을 바로 읽도록 BOM'); // fetch().text() 는 BOM 을 떼고 읽음
  assert.ok(body.replace(/^\uFEFF/, '').startsWith('공고명,기관,마감,D-day,판단,받는 것,예상 금액,자부담,준비 시간(시간),사업별 효과,신청 전 확인,담당,진행,담은 날,공고 원문'), body.slice(0, 120));
  assert.ok(body.includes(`"'=CMD 마케팅 지원 ""따옴표"", 쉼표"`), '수식 문자 막기·따옴표');
  assert.ok(body.includes('청년 채용 인건비 지원,최대 720만 원(청년 1명 기준),없음,3.5,다짐: 트레이너 채용 인건비,고용보험 피보험자 5명 이상인지 / 작년 매출'), body);
  // 담당 골라 업무로 = 신청 준비 업무(담당 staffA)
  await ctx.owner.ok('POST', `/api/sales/support/${b}/work`, { status: 'preparing', ownerId: ctx.staffA.id });
  let L = await ctx.owner.ok('GET', '/api/sales/support?tab=list');
  const row = L.items.find((x) => x.id === b); assert.deepEqual([row.work.status, row.work.ownerId], ['preparing', ctx.staffA.id]);
  assert.equal((await sql`select assignee_id from tasks where id = ${row.work.taskId}`)[0].assignee_id, ctx.staffA.id);
  await ctx.owner.ok('POST', `/api/sales/support/${b}/work`, { status: 'applied' });
  L = await ctx.owner.ok('GET', '/api/sales/support?tab=list'); assert.deepEqual(L.items.map((x) => x.id), [a], '신청 완료로 넘어가면 목록에서 빠짐');
  await ctx.owner.ok('POST', `/api/sales/support/${a}/list`, { on: false });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/support?tab=list')).items.length, 0);
  assert.equal((await ctx.owner.req('POST', '/api/sales/support/00000000-0000-0000-0000-000000000000/list', { on: true })).status, 404);
  await sql`delete from support_programs where source_id like 'M%'`;
});

test('로컬 10/28 23:50: 보유 인증 없음(빈칸과 구분) · 종류 돈은 현금·융자·바우처·인건비만 · 제목 낱말 앞 다른 시·도 = 확인 필요(해당 없음 아님)', async () => {
  const lab = await ins({ source_id: 'N1', title: '[경기] 용인시 중소기업 마케팅 R&D', summary: '기업부설연구소 보유 기업 대상' });
  let v = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  assert.ok(v.blanks.fields.some((f) => f.key === 'certs'), JSON.stringify(v.blanks));
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, certsNone: true });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/support/profile')).profile.certs_none, true);
  v = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  assert.ok(!v.blanks.fields.some((f) => f.key === 'certs'), '인증 없음을 고르면 빈칸 아님');
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, certs: ['벤처기업'], certsNone: true });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/support/profile')).profile.certs_none, false, '인증을 고르면 없음은 꺼짐');
  const k = {
    edu: await ins({ source_id: 'N2', title: '기술금융과 기술가치평가 입문과정' }),
    train: await ins({ source_id: 'N3', title: '중소기업 AI 도입 AI훈련(컨설팅 100%)', amount: '기업당 최대 783만 원' }),
    youth: await ins({ source_id: 'N4', title: '청년일자리도약장려금', amount: '최대 720만 원' }),
    open: await ins({ source_id: 'N5', title: '상시매칭 오픈이노베이션 플랫폼 참여기업 모집' }),
    ir: await ins({ source_id: 'N6', title: '2026 대구리더스포럼 IR 마케팅', regions: [], nationwide: true, agency: '중소벤처기업부' }),
  };
  const L = await all();
  assert.deepEqual([L[k.edu].kinds, L[k.train].kinds, L[k.youth].kinds, L[k.open].kinds], [['event'], ['free'], ['money'], []]);
  assert.equal(L[k.ir].rule.verdict, 'maybe', JSON.stringify(L[k.ir].rule.flags));
  assert.ok(L[k.ir].rule.flags.some((f) => f.level === 'warn' && f.text === '대구 지역 행사·기관일 수 있음 — 참가 지역 확인'));
  assert.ok(L[lab]);
  await sql`delete from support_programs where source_id like 'N%'`;
});
