// #161 V25 매출 자료 자동 분석: 자료실 업로드 → 감지 → 숫자 읽기(확인 대기) → [확정] → 같은 달 10분 모아 1번 분석(서버 계산 + AI 해석) → 매출 권한자 알림. 직원 404.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, ensureTls, resetDb, startServer, testDb, tick, BASE, FAKE } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, sql, ctx, fake;
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ REVENUE_AUTO: '1' }); sql = testDb(); ctx = await bootstrap();
  // 지난 실적(서버 계산 검증용): 강남점 2025-09·2026-03~08, 판교 2025-09·2026-06~08 (만 원 단위 정수)
  const A = { '2025-09': 40e6, '2026-03': 50e6, '2026-04': 52e6, '2026-05': 54e6, '2026-06': 55e6, '2026-07': 56e6, '2026-08': 58e6, '2026-09': 59e6 };
  const B = { '2025-09': 10e6, '2026-06': 12e6, '2026-07': 12.5e6, '2026-08': 13e6 };
  for (const [unit, rows] of [[ctx.siteA, A], [ctx.siteB, B]]) {
    for (const [m, v] of Object.entries(rows)) await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, source) values (${unit}, ${m + '-01'}, ${v}, ${Math.round(v * 0.5)}, 'manual')`;
  }
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const org = (title) => reply({ folder: '', tags: [], title, summary: '', confidence: 0.9, security: 'internal' }); // 자료실 자동 정리(올리기 완료 때 먼저 부름)
const sent = async () => (await (await fetch(FAKE + '/__state')).json()).anthropic;
async function upload(c, name, text, folder = '', mimeType = 'text/csv') {
  const data = Buffer.from(text);
  const lf = await c.ok('POST', '/api/library', { fileName: name, mimeType, size: data.length, folder });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data });
  await c.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
const until = async (fn, what, ms = 20000) => { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`시간 초과: ${what}`); await new Promise((r) => setTimeout(r, 150)); } };
const importOf = async (fileId) => (await sql`select * from revenue_imports where file_id = ${fileId}`)[0];
const settled = (fileId) => until(async () => { const i = await importOf(fileId); return i && !['queued', 'extracting'].includes(i.status) && i; }, `읽기 끝 ${fileId}`);

test('감지: 매출 폴더·파일 이름·본문(매출+월+금액 3개)만 — 다른 자료·매출 화면 [자료로 입력]·글 파일은 그냥 자료', async () => {
  // 감지 안 됨: 이름·본문 모두 무관 / 텍스트 파일 / 매출 화면에서 올린 정산서(그 화면이 직접 읽음)
  const plain = await upload(ctx.owner, '회의록.csv', '참석자,안건\n김대표,가을 행사\n');
  const memo = await upload(ctx.owner, '정산 메모.txt', '9월 매출 메모', '', 'text/plain'); // 엑셀·CSV·PDF·사진·한글이 아니면 제외
  const data = Buffer.from('9월 정산');
  const rv = await ctx.owner.ok('POST', '/api/library', { fileName: '9월 정산.csv', mimeType: 'text/csv', size: data.length, purpose: 'revenue' });
  await fetch(BASE + rv.upload.url, { method: 'PUT', headers: rv.upload.headers, body: data });
  await ctx.owner.ok('POST', `/api/library/${rv.id}/complete`);
  await new Promise((r) => setTimeout(r, 800));
  for (const id of [plain, memo, rv.id]) assert.equal(await importOf(id), undefined, `감지 안 됨: ${id}`);
  // 감지: ① 매출 근거 폴더 ② 이름 ③ 본문 — 각각 읽기 결과가 비면 'empty'(알림 없음)
  const cases = [['자료.csv', 'a,b\n1,2\n', '매출 근거', '자료', 'folder'], ['2026-08 정산.csv', 'c,d\n3,4\n', '', '8월 자료', 'name'],
    ['월간 보고.csv', '2026년 8월 매출\n강남점,58,000,000\n판교,13,000,000\n합계,71,000,000\n', '', '월간 보고', 'content']];
  for (const [name, text, folder, title, by] of cases) {
    await ctl({ anthropicQueue: [org(title), reply({ rows: [], notes: '표가 없습니다' })] });
    const id = await upload(ctx.owner, name, text, folder);
    const imp = await settled(id);
    assert.equal(imp.detected_by, by, name); assert.equal(imp.status, 'empty', '읽은 숫자 없음 → 확인할 것 없음');
    assert.equal(imp.tenant, 'default'); assert.deepEqual(imp.rows, []);
  }
  const [n] = await sql`select count(*)::int as n from notifications where type = 'revenue'`;
  assert.equal(n.n, 0, '숫자가 없으면 알림 안 함');
  const [u] = await sql`select count(*)::int as n, count(*) filter (where user_id is null)::int as sys from ai_usage where purpose = 'revenue_auto_extract'`;
  assert.equal(u.n, 3); assert.equal(u.sys, 3, '올린 사람이 아니라 회사 시스템 작업으로 기록');
});

let fileA, fileB, reportId;
test('확인 대기 → 읽은 값 vs 지금 값 → (직원 404) → 고쳐서 [확정] = 실적 반영 · 같은 달 10분 모아 1번 분석 대기', async () => {
  const rows = [{ site: '다짐 강남점', month: '2026-09', item: '매출', amount: 60000000 }, { site: '다짐 강남점', month: '2026-09', item: '회원수', amount: 830 },
    { site: '하이링크 판교 위탁현장', month: '2026-09', item: '매출', amount: 9000000 }, { site: '없는 지점', month: '2026-09', item: '매출', amount: 1 }];
  await ctl({ anthropicQueue: [org('9월 정산'), reply({ rows, notes: '판교 지출 칸은 흐려서 못 읽었습니다' })] });
  fileA = await upload(ctx.staffA.client, '2026-09 정산.csv', '현장,매출\n강남,60000000\n'); // 매출 권한 없는 직원이 올려도 감지(본인 권한으로 읽음)
  const imp = await settled(fileA);
  assert.equal(imp.status, 'pending'); assert.equal(imp.created_by, ctx.staffA.id);
  // 알림: 매출 입력 권한자(대표)에게만, 숫자 없이
  const notes = await sql`select user_id, title, body, link from notifications where type = 'revenue'`;
  assert.deepEqual(notes.map((x) => x.user_id), [ctx.ownerId], '매출 권한자(대표)만 — 올린 직원·매니저는 아님');
  assert.match(notes[0].title, /숫자 확인: 2026-09 정산\.csv/); assert.equal(notes[0].link, '/revenue#imports');
  // 직원·매니저: 매출 화면처럼 404
  for (const c of [ctx.staffA.client, ctx.managerA.client]) {
    assert.equal((await c.get('/api/revenue/auto')).status, 404);
    assert.equal((await c.post(`/api/revenue/auto/imports/${imp.id}`, { action: 'confirm' })).status, 404);
    assert.equal((await c.post('/api/revenue/auto/analyze', { period: '2026-09' })).status, 404);
  }
  // 대표 화면: 지금 값과 비교(강남 59,000,000 → 60,000,000 = 바뀜, 회원수 새 값, 없는 지점 = 확인)
  const ov = await ctx.owner.ok('GET', '/api/revenue/auto');
  const card = ov.imports.find((x) => x.id === imp.id);
  assert.equal(card.status, 'pending'); assert.equal(card.notes, '판교 지출 칸은 흐려서 못 읽었습니다'); assert.equal(card.created_by_name, '이직원');
  assert.deepEqual(card.lines.map((l) => [l.site, l.item, l.current, l.state]), [['다짐 강남점', '매출', 59000000, 'changed'], ['다짐 강남점', '회원수', null, 'new'],
    ['하이링크 판교 위탁현장', '매출', null, 'new'], ['없는 지점', '매출', null, 'error']]);
  assert.match(card.lines[3].error, /없는 지점/);
  const [before0] = await sql`select revenue::float8 as revenue from revenue_entries where org_unit_id = ${ctx.siteA} and month = '2026-09-01'`;
  assert.equal(before0.revenue, 59000000, '확정 전에는 실적에 반영하지 않음');
  // 그대로 확정 → 없는 지점 때문에 아무것도 저장 안 됨(CSV 가져오기와 같은 규칙)
  const bad = await ctx.owner.ok('POST', `/api/revenue/auto/imports/${imp.id}`, { action: 'confirm' });
  assert.equal(bad.ok, false); assert.equal(bad.errors.length, 1);
  assert.equal((await importOf(fileA)).status, 'pending');
  // 매니저에게 매출 '조회'만 열면: 보기는 되고 확정은 403
  await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'revenue', role: 'site_manager', level: 'view' });
  assert.equal((await ctx.managerA.client.ok('GET', '/api/revenue/auto')).canEdit, false);
  assert.equal((await ctx.managerA.client.post(`/api/revenue/auto/imports/${imp.id}`, { action: 'confirm' })).status, 403);
  await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'revenue', role: 'site_manager', level: null });
  // 고쳐서 확정: 없는 지점 빼고, 판교 매출 9,000,000 → 9,100,000
  const fixed = [rows[0], rows[1], { ...rows[2], amount: 9100000 }];
  const ok = await ctx.owner.ok('POST', `/api/revenue/auto/imports/${imp.id}`, { action: 'confirm', rows: fixed });
  assert.equal(ok.ok, true); assert.equal(ok.count, 2); assert.equal(ok.period, '2026-09');
  const ent = await sql`select org_unit_id, revenue::float8 as revenue, members, source, source_file, source_file_ids from revenue_entries where month = '2026-09-01' order by revenue desc`;
  assert.deepEqual(ent.map((e) => [e.org_unit_id, e.revenue, e.source]), [[ctx.siteA, 60000000, 'ai'], [ctx.siteB, 9100000, 'ai']]);
  assert.equal(ent[0].members, 830); assert.deepEqual(ent[0].source_file_ids, [fileA], '숫자마다 근거 파일'); assert.equal(ent[0].source_file, '2026-09 정산.csv');
  const done = await importOf(fileA);
  assert.equal(done.status, 'confirmed'); assert.equal(done.decided_by, ctx.ownerId); assert.equal(done.applied.edited, true, '고쳐서 확정한 기록');
  assert.equal((await ctx.owner.post(`/api/revenue/auto/imports/${imp.id}`, { action: 'confirm' })).status, 409, '두 번 확정 안 됨');
  const [q] = await sql`select period, cardinality(import_ids)::int as n, extract(epoch from run_after - now())::int as wait from revenue_analysis_queue`;
  assert.equal(q.period, '2026-09'); assert.equal(q.n, 1); assert.ok(q.wait > 540 && q.wait <= 600, `10분 뒤 분석(${q.wait}초)`);
  assert.ok((await sql`select 1 from audit_logs where action = 'revenue.auto_confirm'`).length, '감사 기록');
});

test('같은 달 두 번째 자료 → 분석 대기 1건에 합침 · 10분 전 tick 은 분석 안 함 · 시간이 되면 1번만 분석(서버 계산값 그대로) · 알림', async () => {
  await ctl({ anthropicQueue: [org('9월 회원'), reply({ rows: [{ site: '하이링크 판교 위탁현장', month: '2026-09', item: '회원수', amount: 210 }], notes: '' })] });
  fileB = await upload(ctx.owner, '2026-09 판교 실적.csv', '판교,회원,210\n');
  const imp = await settled(fileB);
  assert.equal(imp.status, 'pending');
  assert.equal((await ctx.owner.ok('POST', `/api/revenue/auto/imports/${imp.id}`, { action: 'confirm' })).count, 1);
  const qs = await sql`select cardinality(import_ids)::int as n, cardinality(file_ids)::int as f from revenue_analysis_queue`;
  assert.equal(qs.length, 1, '같은 달은 대기 1건'); assert.equal(qs[0].n, 2); assert.equal(qs[0].f, 2);
  let t = await tick();
  assert.deepEqual(t.detail?.revenueAuto?.analyzed ?? [], [], '모으는 10분 동안은 분석하지 않음');
  assert.equal((await sql`select count(*)::int as n from revenue_ai_reports`)[0].n, 0);
  await sql`update revenue_analysis_queue set run_after = now() - interval '1 minute'`;
  // 정기 실행의 다른 단계도 가짜 AI 를 부를 수 있어 응답을 미리 넣지 않는다 → 가짜 서버 기본 답(입력 첫 현장·월 기준, 없는 현장 1개 섞임)
  const n0 = (await sent()).length;
  t = await tick();
  assert.equal(t.detail.revenueAuto.analyzed.length, 1, t.detail.revenueAuto.analyzed);
  reportId = t.detail.revenueAuto.analyzed[0].report;
  assert.ok(reportId);
  assert.equal((await sql`select count(*)::int as n from revenue_analysis_queue`)[0].n, 0, '분석 끝나면 대기열에서 빠짐');
  t = await tick();
  assert.deepEqual(t.detail.revenueAuto.analyzed, [], '같은 달 두 번 분석하지 않음');
  assert.equal((await sql`select count(*)::int as n from revenue_ai_reports`)[0].n, 1, '두 자료 → 분석 1번');
  // AI 에 보낸 것: Sonnet · 집계 숫자와 서버 계산값만(파일 이름·메모 없음)
  const req = (await sent()).slice(n0).filter((r) => r.body.output_config?.format?.schema?.required?.includes('forecast'));
  assert.equal(req.length, 1); assert.equal(req[0].body.model, 'claude-sonnet-5-5'); assert.equal(req[0].body.output_config.effort, 'medium');
  const payload = JSON.stringify(req[0].body.messages);
  for (const bad of ['정산.csv', '판교 실적', '흐려서', '@dagym.test', '이직원']) assert.ok(!payload.includes(bad), `보내면 안 되는 값: ${bad}`);
  const input = JSON.parse(req[0].body.messages[0].content);
  assert.equal(input.period, '2026-09'); assert.ok(input.rows.length >= 12); assert.ok(input.stats.sites.length === 2);
  // 보고서: 서버 계산값 = 손으로 계산한 값
  const { report } = await ctx.owner.ok('GET', `/api/revenue/ai?id=${reportId}`);
  assert.equal(report.kind, 'auto'); assert.equal(report.period, '2026-09');
  const A = report.stats.sites.find((s) => s.site === '다짐 강남점'), B = report.stats.sites.find((s) => s.site === '하이링크 판교 위탁현장');
  assert.equal(A.revenue, 60000000); assert.equal(A.prev, 58000000); assert.equal(A.mom, 3.4, '(60-58)/58 = 3.4%');
  assert.equal(A.lastYear, 40000000); assert.equal(A.yoy, 50, '전년 같은 달 대비 +50%');
  assert.equal(A.ma3, 58000000, '(56+58+60)/3'); assert.equal(A.ma3Prev, 56333333, '(55+56+58)/3'); assert.equal(A.ma3Change, 3);
  assert.equal(A.trend, 2.7, '최근 6개월(52·54·55·56·58·60) 기울기 1.514 ÷ 평균 55.83 = 2.7%/월');
  assert.equal(A.forecast.length, 3); assert.equal(A.forecast[0].month, '2026-10');
  assert.equal(A.forecast[0].base, Math.round(58000000 * 1.027 ** 2), '3개월 평균 × (1+추세)^(k+1)');
  assert.ok(A.forecast[0].low < A.forecast[0].base && A.forecast[0].base < A.forecast[0].high);
  assert.equal(A.members, 830); assert.equal(A.perMember, Math.round(60000000 / 830));
  assert.equal(B.mom, -30, '(9.1-13)/13 = -30.0%'); assert.equal(B.members, 210);
  assert.equal(report.stats.total.revenue, 69100000); assert.equal(report.stats.total.prev, 71000000); assert.equal(report.stats.total.mom, -2.7); assert.equal(report.stats.total.yoy, 38.2);
  assert.deepEqual(report.stats.ranking, { up: [{ site: '다짐 강남점', mom: 3.4 }], down: [{ site: '하이링크 판교 위탁현장', mom: -30 }] });
  assert.ok(report.stats.flags.some((f) => f.site === '하이링크 판교 위탁현장' && f.basis === 'mom' && f.change === -30), '판교 급감 표시');
  assert.ok(report.stats.flags.some((f) => f.site === '다짐 강남점' && f.basis === 'yoy' && f.change === 50));
  assert.ok(report.stats.checks.some((c) => /판교.*빈 달/.test(c)) === false, '빈 달 없음(판교는 6월부터)');
  // AI 문장: 입력에 없는 현장을 가리키는 이상치·전망은 버림 — 가짜 AI 기본 답은 '입력의 첫 현장'(서버가 현장 이름순으로 보냄 → DB 정렬 규칙에 따라 C.UTF-8 은 다짐, en_US 는 하이링크가 먼저) 이라 같은 순서로 읽어 비교
  const [{ name: first }] = await sql`select o.name from revenue_entries r join org_units o on o.id = r.org_unit_id where o.tenant = 'default' and not o.is_demo and r.month = '2026-09-01' order by o.name limit 1`;
  assert.deepEqual(report.output.anomalies.map((a) => a.site), [first]); assert.deepEqual(report.output.forecast.map((f) => f.site), ['전체']);
  assert.deepEqual(report.output.actions, [{ site: first, items: ['재등록 안내를 이번 달 안에 보내기', '오전 시간대 프로그램 늘리기'] }]);
  assert.deepEqual(report.output.checks, ['다른 현장 자료가 빠졌는지 확인']);
  assert.deepEqual(report.files.map((f) => f.id).sort(), [fileA, fileB].sort(), '근거 파일 2개');
  // 사용량: 회사 시스템 작업(사람 없음)
  const [u] = await sql`select count(*)::int as n, count(*) filter (where user_id is null)::int as sys from ai_usage where purpose = 'revenue_auto'`;
  assert.equal(u.n, 1); assert.equal(u.sys, 1);
  // 알림: 매출 권한자에게 '분석 완료' 1건 — 잠금 화면에 숫자 없게
  const [nt] = await sql`select user_id, title, body, link from notifications where type = 'revenue' and title like '%분석 완료%'`;
  assert.equal(nt.user_id, ctx.ownerId); assert.equal(nt.title, '9월 매출 자료 분석 완료 — 동향·전망·대안'); assert.equal(nt.link, `/revenue?report=${reportId}`);
  assert.ok(!/60,000,000|60000000|69,100,000/.test(nt.body), nt.body);
  assert.equal((await sql`select count(*)::int as n from notifications where type = 'revenue' and user_id <> ${ctx.ownerId}`)[0].n, 0, '직원·매니저 알림 없음');
  // 이력: 화면 목록에 보고서 1건, 직원은 보고서도 404
  const ov = await ctx.owner.ok('GET', '/api/revenue/auto');
  assert.deepEqual(ov.reports.map((r) => [r.id, r.kind, r.files]), [[reportId, 'auto', 2]]);
  assert.equal((await ctx.staffA.client.get(`/api/revenue/ai?id=${reportId}`)).status, 404);
});

test('[무시]·읽기 실패 [다시 읽기] · [지금 분석]은 기다리지 않고 바로(대기열 비움)', async () => {
  // 무시: 실적·대기열 변화 없음
  await ctl({ anthropicQueue: [org('7월 정산'), reply({ rows: [{ site: '다짐 강남점', month: '2026-07', item: '매출', amount: 1 }], notes: '' })] });
  const f1 = await upload(ctx.owner, '2026-07 정산 사본.csv', 'x,y\n');
  const i1 = await settled(f1);
  assert.equal((await ctx.owner.ok('POST', `/api/revenue/auto/imports/${i1.id}`, { action: 'dismiss' })).status, 'dismissed');
  assert.equal((await sql`select revenue::float8 as r from revenue_entries where org_unit_id = ${ctx.siteA} and month = '2026-07-01'`)[0].r, 56000000);
  assert.equal((await sql`select count(*)::int as n from revenue_analysis_queue`)[0].n, 0);
  // 읽을 숫자 없음 → [다시 읽기] → 확인 대기
  await ctl({ anthropicQueue: [org('10월 정산'), reply({ rows: [], notes: '' })] });
  const f2 = await upload(ctx.owner, '2026-10 정산.csv', 'x,y\n');
  const i2 = await settled(f2);
  assert.equal(i2.status, 'empty');
  await ctl({ anthropicQueue: [reply({ rows: [{ site: '다짐 강남점', month: '2026-10', item: '매출', amount: 61000000 }], notes: '' })] });
  const rr = await ctx.owner.ok('POST', `/api/revenue/auto/imports/${i2.id}`, { action: 'retry' });
  assert.equal(rr.status, 'pending');
  assert.equal((await ctx.owner.post(`/api/revenue/auto/imports/${i2.id}`, { action: 'retry' })).status, 409, '확인 대기는 다시 읽기 대상 아님');
  const c = await ctx.owner.ok('POST', `/api/revenue/auto/imports/${i2.id}`, { action: 'confirm' });
  assert.equal(c.period, '2026-10');
  // 지금 분석: 누른 사람 이름으로, 대기열 비움 · 입력에 없는 현장은 버리고 제안은 현장별 3개까지
  const out = { summary: '10월 강남점 매출은 61,000,000원입니다.', trend: '강남점은 오름세입니다.', anomalies: [], comparisons: [],
    forecast: [{ site: '전체', comment: '최근 추세가 이어진다는 가정의 추정입니다.' }, { site: '없는 현장', comment: '지어낸 전망' }],
    actions: [{ site: '다짐 강남점', items: ['재등록 안내', '오전 프로그램 점검', '세 번째', '네 번째는 버림'] }, { site: '없는 현장', items: ['버림'] }], checks: ['판교 10월 자료 확인'] };
  await ctl({ anthropicQueue: [reply(out)] });
  const { report } = await ctx.owner.ok('POST', '/api/revenue/auto/analyze', { period: '2026-10' });
  assert.equal(report.kind, 'auto'); assert.equal(report.period, '2026-10'); assert.deepEqual(report.file_ids, [f2]);
  assert.deepEqual(report.output.actions, [{ site: '다짐 강남점', items: ['재등록 안내', '오전 프로그램 점검', '세 번째'] }]);
  assert.deepEqual(report.output.forecast.map((f) => f.site), ['전체']); assert.deepEqual(report.output.checks, ['판교 10월 자료 확인']);
  assert.ok(report.stats.checks.some((c) => c.includes('하이링크 판교 위탁현장 2026-10 자료가 없습니다')), '서버 확인 필요: 이번 달 빠진 현장');
  assert.equal((await sql`select count(*)::int as n from revenue_analysis_queue`)[0].n, 0);
  assert.equal((await sql`select created_by from revenue_ai_reports where id = ${report.id}`)[0].created_by, ctx.ownerId);
  const [{ n }] = await sql`select count(*)::int as n from notifications where type = 'revenue' and entity_id = ${report.id}`;
  assert.equal(n, 0, '직접 누른 사람에게는 알림 안 함(대표 1명뿐인 회사)');
});
