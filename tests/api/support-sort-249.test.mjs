// 249차 #781~#784(대표 10/28 22:45 "디데이 순서·필터 · AI 확인 중이 왜? · 참여할 수 있는지"): 정렬(맞춤·마감 임박·새로·금액)·D-day·종류 칩(사람별 기억)
// · '규칙상 맞음 · AI 판단 전'(pending 수·건당 예상 비용) · 여러 건 판단은 관리자가 고른 수만 · 주간 자동 판단 기본 꺼짐
// · 1차 규칙 거짓 맞춤: [전남광주]·통합특별시·기관 이름 앞 시·도·서울 구·'○○ 소재 기업'·비수도권·1인 창조기업·예비창업자만·대기 배출시설·발전 분야 · 청년일자리도약장려금 '1인 이상도 가능' 구절 · 프로필 빈칸 안내
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fg;
const today = seoulToday(); const d = (n) => addDays(today, n);
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn', usage: { input_tokens: 5000, output_tokens: 800 } });
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: [], nationwide: true, hashtags: [], attachments: sql.json([]), apply_end: d(20), target: '중소기업', ...o })} returning id`.then((r) => r[0].id);
// 로컬 10/28 분석의 회사 기준(본점 경기 용인시·업력 약 4.7년·업종 3개) — 규모·상시근로자·인증은 빈칸
const PROFILE = { regionSido: '경기', regionSigungu: '용인시', founded: d(-1735), size: null, employees: null, industries: ['운동·피트니스', '공동주택 커뮤니티시설 위탁운영', '소프트웨어·SaaS'], keywords: ['출입'], certs: [], brands: ['다짐', '하이링크', '워크인'], interests: ['IP', '마케팅'], excludes: [], memo: '시험 회사 소개' };

before(async () => {
  await resetDb(); fg = await startFakeGoogle(); srv = await startServer({ SUPPORT_WEEKLY_AI_MAX: '0', SUPPORT_AUTO_AI: 'off' }); sql = testDb(); ctx = await bootstrap(); // 250차부터 주간 채우기 기본 5·새 공고 자동 판단 켬 — 여기서는 끈 상태(사람이 누르는 판단)
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', PROFILE);
});
after(async () => { srv?.proc.kill(); fg?.server.close(); await sql?.end(); });

test('1차 규칙 거짓 맞춤(로컬 10/28 C절) → 해당 없음 · 전국·행사 장소·우리 지역은 그대로', async () => {
  const id = {
    tag: await ins({ source_id: 'R1', title: '[전남광주] 2026 AI 스타트업 육성 지원사업', summary: '마케팅·IP 지원' }),
    merged: await ins({ source_id: 'R2', title: '2026 창업기업 성장 지원', agency: '전남광주통합특별시' }),
    agency: await ins({ source_id: 'R3', title: '2026년 스타트업 법률상담회 참가기업 모집', agency: '울산경제일자리진흥원' }),
    exec: await ins({ source_id: 'R4', title: '2026 창업-BuS 참가기업 모집', agency: '중소벤처기업부', executor: '강원창조경제혁신센터' }),
    gu: await ins({ source_id: 'R5', title: '2026 강동구 청년 스타트업 네트워킹 데이', target: '강동구 소재 청년 창업기업' }),
    seoul: await ins({ source_id: 'R13', title: '2026 스타트업 성장 지원', agency: '서울특별시 서초구' }),
    capital: await ins({ source_id: 'R17', title: '2026 판로 개척 지원', target: '비수도권 소재 중소기업' }),
    body: await ins({ source_id: 'R18', title: '2026 중소기업 마케팅 바우처', target: '중소기업', summary: '지원 대상: 대구·경북 소재 중소기업\n마케팅 비용 지원' }),
    pre: await ins({ source_id: 'R7', title: '2026 예비창업패키지 아카데미 교육생 모집', target: '예비창업자' }),
    iot: await ins({ source_id: 'R8', title: '경기 소규모 대기 배출시설 IoT 측정기기 부착 지원사업', agency: '경기도', target: '소규모 사업장' }),
    power: await ins({ source_id: 'R9', title: '2026 남동발전 상생형 동반성장 지원', agency: '한국남동발전', summary: '발전·에너지 분야 중소기업을 대상으로 기술개발 지원' }),
    youth: await ins({ source_id: 'R10', title: '2026 청년일자리도약장려금 수도권형(수원·용인·화성)', agency: '경기경영자총협회', apply_end: null, apply_text: '예산 소진 시까지',
      target: '용인시 소재 고용보험 피보험자 5인 이상 기업 (청년창업기업·지식서비스산업·문화콘텐츠산업·신재생에너지산업 등은 1인 이상)', amount: '청년 1인당 최대 720만 원' }),
    ours: await ins({ source_id: 'R11', title: '[경기] 용인시 중소기업 마케팅 지원', regions: ['경기'], nationwide: false, agency: '경기도', target: '용인시 소재 중소기업' }),
    national: await ins({ source_id: 'R12', title: '2026 전국 스타트업 IR 데모데이', executor: '부산창조경제혁신센터' }),
    venue: await ins({ source_id: 'R15', title: '2026 코리아 스포츠산업 박람회(서울 코엑스) 참가 지원', summary: '스포츠산업 기업 참가비 지원' }),
    sejong: await ins({ source_id: 'R14', title: '2026 콘텐츠 마케팅 교육', executor: '세종대학교 산학협력단' }),
    one: await ins({ source_id: 'R6', title: '용인시 1인 창조기업 지원센터 입주기업 모집', agency: '용인시산업진흥원', target: '1인 창조기업' }),
  };
  const all = Object.fromEntries((await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200&sort=new&dd=all&kind=all')).items.map((x) => [x.id, x]));
  const no = (k, re) => { const x = all[id[k]]; assert.equal(x.rule.verdict, 'no', `${k} ${JSON.stringify(x.rule.flags)}`); assert.ok(x.rule.flags.some((f) => f.level === 'no' && re.test(f.text)), `${k} ${JSON.stringify(x.rule.flags)}`); };
  no('tag', /^광주·전남 기업 대상\(우리 경기\)$/);
  no('merged', /광주·전남 기업 대상/);
  no('agency', /^울산 기관 공고\(우리 경기\)$/);
  no('exec', /^강원 기관 공고\(우리 경기\)$/);
  no('gu', /^서울 기업 대상\(우리 경기\)$/);
  no('seoul', /^서울 기관 공고\(우리 경기\)$/);
  no('capital', /^비수도권 기업 대상\(우리 경기\)$/);
  no('body', /^대구·경북 기업 대상\(우리 경기\)$/);
  no('pre', /^예비창업자 대상$/);
  no('iot', /에너지환경 업종 대상/);
  no('power', /에너지환경 업종 대상/);
  const ok = (k) => assert.ok(!all[id[k]].rule.flags.some((f) => f.level === 'no'), `${k} ${JSON.stringify(all[id[k]].rule.flags)}`);
  ok('youth'); assert.ok(all[id.youth].rule.flags.some((f) => f.level === 'ok' && f.text === '경기 기관 공고'), JSON.stringify(all[id.youth].rule.flags));
  ok('ours'); assert.equal(all[id.ours].rule.verdict, 'fit');
  ok('national'); assert.ok(all[id.national].rule.flags.some((f) => f.level === 'warn' && /부산 기관 공고 — 지역 제한 확인/.test(f.text)));
  ok('venue'); ok('sejong');
  // 1인 창조기업: 상시근로자 수가 비면 '확인 필요'(빈칸 안내) → 채우면(12명) 해당 없음
  ok('one'); assert.ok(all[id.one].rule.flags.some((f) => f.level === 'warn' && f.need === 'employees' && /1인 창조기업 대상 — 상시근로자 수를 넣으면 판단/.test(f.text)));
  const v0 = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  const emp = v0.blanks.fields.find((f) => f.key === 'employees');
  assert.ok(emp && emp.items >= 1 && v0.blanks.items >= emp.items, `#784 빈칸 안내 ${JSON.stringify(v0.blanks)}`); assert.equal(emp.label, '상시근로자 수');
  for (const k of ['tag', 'agency', 'gu', 'pre', 'iot', 'power']) assert.ok(!v0.items.some((x) => x.id === id[k]), `맞춤 탭에서 빠짐: ${k}`);
  assert.ok(v0.items.some((x) => x.id === id.youth), '청년일자리도약장려금은 맞춤에 남음');
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...PROFILE, employees: 12 });
  const v1 = Object.fromEntries((await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200&sort=new&dd=all&kind=all')).items.map((x) => [x.id, x]));
  assert.ok(v1[id.one].rule.flags.some((f) => f.level === 'no' && f.text === '1인 창조기업 대상(우리 상시근로자 12명)'), JSON.stringify(v1[id.one].rule.flags));
  await ctx.owner.ok('PUT', '/api/sales/support/profile', PROFILE);
  await sql`delete from support_programs where source_id like 'R%'`;
});

test('#781 정렬(마감 임박 — 상시는 맨 뒤 · 지원 금액 큰 순 · 새로 올라온 순) · D-day·종류 칩 숫자 · 고른 것은 사람별로 기억(다른 사람은 그대로)', async () => {
  const at = (n) => new Date(Date.now() - n * 36e5).toISOString();
  const id = {
    s1: await ins({ source_id: 'S1', title: '[정렬시험] 마케팅 바우처 지원', apply_end: d(2), amount: '최대 300만원', first_seen_at: at(5) }),
    s2: await ins({ source_id: 'S2', title: '[정렬시험] R&D 기술개발 자금', apply_end: d(10), amount: '기업당 최대 1억 5천만원', first_seen_at: at(4) }),
    s3: await ins({ source_id: 'S3', title: '[정렬시험] 무료 법률 자문', apply_end: null, apply_text: '예산 소진 시까지', first_seen_at: at(3) }),
    s4: await ins({ source_id: 'S4', title: '[정렬시험] 창업 아카데미 교육생 모집', apply_end: d(25), first_seen_at: at(1) }),
    s5: await ins({ source_id: 'S5', title: '[정렬시험] 창업보육센터 입주기업 모집', apply_end: d(40), first_seen_at: at(2) }),
    s6: await ins({ source_id: 'S6', title: '[정렬시험] IR 데모데이 참가기업 모집', apply_end: d(6), first_seen_at: at(6) }),
  };
  const name = Object.fromEntries(Object.entries(id).map(([k, v]) => [v, k]));
  const get = (c, p) => c.ok('GET', `/api/sales/support?tab=all&q=${encodeURIComponent('정렬시험')}&${p}`);
  const order = (v) => v.items.map((x) => name[x.id]);
  const dl = await get(ctx.owner, 'sort=deadline&dd=all&kind=all');
  assert.deepEqual(order(dl), ['s1', 's6', 's2', 's4', 's5', 's3'], '마감 임박 순 — 상시·예산 소진은 맨 뒤');
  assert.equal(dl.sortUsed, 'deadline');
  const am = await get(ctx.owner, 'sort=amount&dd=all&kind=all');
  assert.deepEqual(order(am).slice(0, 2), ['s2', 's1'], '지원 금액 큰 순(1억 5천만원 > 300만원), 모르는 금액은 뒤');
  assert.deepEqual([am.items[0].amountKrw, am.items[1].amountKrw], [150000000, 3000000]);
  assert.deepEqual(order(await get(ctx.owner, 'sort=new&dd=all&kind=all')), ['s4', 's5', 's3', 's2', 's1', 's6'], '새로 올라온 순');
  assert.deepEqual(dl.chips.dd, { all: 6, d3: 1, d7: 2, d14: 3, d30: 4, open: 1 });
  assert.deepEqual(dl.chips.kind, { all: 6, money: 2, free: 1, space: 1, invest: 1, event: 1 }, JSON.stringify(dl.items.map((x) => [name[x.id], x.kinds])));
  assert.deepEqual(order(await get(ctx.owner, 'sort=deadline&dd=d7&kind=all')), ['s1', 's6']);
  assert.deepEqual(order(await get(ctx.owner, 'sort=deadline&dd=open&kind=all')), ['s3']);
  const mk = await get(ctx.owner, 'sort=deadline&dd=d7&kind=money');
  assert.deepEqual(order(mk), ['s1']); assert.equal(mk.chips.dd.d14, 2, 'D-day 칩 숫자는 고른 종류 안에서'); assert.equal(mk.chips.kind.invest, 1, '종류 칩 숫자는 고른 D-day 안에서');
  // 사람별 기억 — staffA 가 고른 것은 staffA 에게만
  const saved = await ctx.staffA.client.ok('PUT', '/api/sales/support/view', { sort: 'amount', dd: 'd30', kind: 'money' });
  assert.deepEqual(saved, { sort: 'amount', dd: 'd30', kind: 'money', aud: 'all' }); // 254차 대상 칩(aud) 추가
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/support/view', { sort: 'cheap' })).status, 400);
  const sa = await ctx.staffA.client.ok('GET', `/api/sales/support?tab=all&q=${encodeURIComponent('정렬시험')}`);
  assert.deepEqual([sa.view, sa.sortUsed, order(sa)], [{ sort: 'amount', dd: 'd30', kind: 'money', aud: 'all' }, 'amount', ['s2', 's1']]);
  const ow = await ctx.owner.ok('GET', `/api/sales/support?tab=all&q=${encodeURIComponent('정렬시험')}`);
  assert.deepEqual([ow.view, ow.sortUsed, ow.items.length], [{ sort: null, dd: 'all', kind: 'all', aud: 'all' }, 'new', 6], '다른 사람은 그대로(탭 기본 정렬)');
  await ctx.staffA.client.ok('PUT', '/api/sales/support/view', { sort: null });
  const sb = await ctx.staffA.client.ok('GET', `/api/sales/support?tab=all&q=${encodeURIComponent('정렬시험')}`);
  assert.deepEqual([sb.view, sb.sortUsed], [{ sort: null, dd: 'd30', kind: 'money', aud: 'all' }, 'new'], '정렬만 풀면 칩은 그대로');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/support?tab=results')).chips, null, '신청·결과 탭은 칩 없음');
  await ctx.staffA.client.ok('PUT', '/api/sales/support/view', { dd: 'all', kind: 'all' });
  await sql`delete from support_programs where source_id like 'S%'`;
});

test('#782 규칙상 맞음 · AI 판단 전: pending 수·건당 예상 비용 · 여러 건 판단은 관리자가 고른 수만(맞춤 순 위부터) · 주간 묶음은 자동 판단 안 함(기본)', async () => {
  const ids = [];
  for (let i = 1; i <= 4; i++) ids.push(await ins({ source_id: `P${i}`, title: `[경기] 용인시 중소기업 마케팅 지원 ${i}차`, regions: ['경기'], nationwide: false, agency: '경기도', target: '용인시 소재 중소기업', apply_end: d(5 + i) }));
  const v = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  assert.equal(v.pendingCount, 4, JSON.stringify(v.items.map((x) => [x.title, x.rule.verdict, x.pending])));
  assert.ok(v.items.filter((x) => ids.includes(x.id)).every((x) => x.pending && !x.ai));
  assert.ok(v.aiCostKrw >= 1, `건당 예상 비용 ${v.aiCostKrw}`); assert.equal(v.weeklyAiMax, 0, '주간 자동 판단 끔(SUPPORT_WEEKLY_AI_MAX=0)'); assert.equal(v.auto.on, false, '새 공고 자동 판단 끔(SUPPORT_AUTO_AI=off)');
  // 주간 묶음 — 자동 판단 안 함(가짜 AI 줄은 그대로)
  await queue([]);
  const w = await ctx.owner.ok('POST', '/api/sales/support/weekly', {});
  assert.deepEqual([w.aiCount, w.aiFailed, w.items], [0, 0, 0], JSON.stringify(w));
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_support'`)[0].n, 0);
  // 여러 건 판단: 직원 403 · 관리자 2건 → 맞춤 순 위 2건만
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/support/analyze-top', { n: 2 })).status, 403);
  assert.equal((await ctx.owner.req('POST', '/api/sales/support/analyze-top', { n: 50 })).status, 400, '한 번에 20건까지');
  await queue([0, 1].map((i) => say({ verdict: 'fit', reasons: ['용인시 소재 중소기업 대상 — 해당'], brands: ['워크인'], docs: ['신청서'], summary: `요약 ${i}`, amount: '최대 500만원', use: ['온라인 광고비'], schedule: null })));
  const r = await ctx.owner.ok('POST', '/api/sales/support/analyze-top', { n: 2 });
  assert.deepEqual([r.asked, r.done, r.failed], [2, 2, 0], JSON.stringify(r));
  const top2 = v.items.filter((x) => x.pending).slice(0, 2).map((x) => x.id);
  const judged = (await sql`select program_id from support_matches where ai_verdict is not null`).map((x) => x.program_id);
  assert.deepEqual(judged.sort(), [...top2].sort(), '맞춤 순 위 2건');
  const v2 = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
  assert.equal(v2.pendingCount, 2);
  const [{ a }] = await sql`select avg(cost_usd)::float8 a from ai_usage where purpose = 'sales_support'`;
  assert.ok(v2.aiCostKrw >= 1 && Math.abs(v2.aiCostKrw - a * 1400) <= 10, `최근 판단 평균으로 예상(${v2.aiCostKrw} ≈ ${a * 1400})`);
  await sql`delete from support_programs where source_id like 'P%'`;
});
