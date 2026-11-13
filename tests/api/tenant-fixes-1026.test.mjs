// 범용화 1단계(대표 11/13 승인, docs/generalization-audit.md S-01~S-05): 다른 회사로 새거나 막히던 5곳
// S-01 주간 보고 팀 목록 = 내 회사 팀만 · S-02 다른 회사 대표도 조직·공휴일·결재선(서버 운영 화면은 기본 회사 전용 그대로)
// S-03 옛 영업 자료가 없는 회사는 영업 쓰기 열림 · S-04 캘린더 '모두의 기본값'은 회사별 · S-05 공휴일은 회사별
// 기본 회사(다짐)는 표·값·동작이 예전과 같아야 한다 — 각 시험이 기본 회사 쪽도 함께 확인
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@other-1026.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-1026.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '튼튼짐', industry: '운동·피트니스', industries: ['IT·소프트웨어'], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  assert.ok(T.tenant && T.tenant !== 'default');
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('범용화 1단계 S-01~S-05', () => {
  test('S-01 주간 보고(모아보기) 팀 목록: 다른 회사에는 다짐 팀이 안 보이고 자기 팀만 · 다짐은 그대로', async () => {
    const d = await ctx.owner.ok('POST', '/api/teams', { name: '다짐 영업팀', members: [] });
    const o = await T.c.ok('POST', '/api/teams', { name: '튼튼 운영팀', members: [] });
    const mine = await T.c.ok('GET', '/api/reports/team');
    assert.deepEqual(mine.teams.map((t) => t.name), ['튼튼 운영팀']); assert.equal(mine.teams[0].id, o.id);
    assert.ok(!JSON.stringify(mine).includes('다짐 영업팀'));
    const base = await ctx.owner.ok('GET', '/api/reports/team');
    assert.ok(base.teams.some((t) => t.id === d.id) && !base.teams.some((t) => t.id === o.id), '다짐은 자기 팀만(예전과 같음)');
  });

  test('S-02 다른 회사 대표: 조직·공휴일·결재선은 열리고, 서버 운영 상태는 404 · 감사 기록은 자기 회사 것만(407차) · 다짐 대표는 모두 그대로 열림', async () => {
    // 서버 운영 화면 — 다른 회사는 404(모든 회사 기록이 섞여 있음). 감사 기록은 407차부터 회사별(자기 회사 기록만 — tests/api/audit-scope-1026)
    assert.equal((await T.c.get('/api/admin/ops')).status, 404);
    assert.ok(Array.isArray((await T.c.ok('GET', '/api/admin/audit')).logs));
    await ctx.owner.ok('GET', '/api/admin/ops'); const au = await ctx.owner.ok('GET', '/api/admin/audit'); assert.ok(Array.isArray(au.logs));
    // 조직 구성: 자기 회사 조직만 보고 만들 수 있음(다짐 조직은 안 보임)
    const units = (await T.c.ok('GET', '/api/admin/org-units')).units;
    assert.ok(units.length >= 1 && units.every((x) => x.tenant === T.tenant), JSON.stringify(units.map((x) => x.tenant)));
    const u = await T.c.ok('POST', '/api/admin/org-units', { name: '튼튼짐 2호점', type: 'branch', parentId: units[0].id });
    const [row] = await sql`select o.tenant, (select c.tenant from calendars c where c.org_unit_id = o.id) as cal_tenant from org_units o where o.id = ${u.id}`;
    assert.deepEqual([row.tenant, row.cal_tenant], [T.tenant, T.tenant], '조직·조직 캘린더 모두 자기 회사');
    assert.equal((await T.c.req('POST', '/api/admin/org-units', { name: '남의 조직 밑', type: 'branch', parentId: ctx.hq })).status, 404, '다짐 조직 밑에는 못 만듦');
    // 결재선: 저장되고 자기 회사 것만
    const line = await T.c.ok('POST', '/api/approval-lines', { name: '튼튼 기본 결재선', steps: [{ label: '대표', type: 'user', userId: T.id }] });
    assert.equal((await sql`select tenant from approval_lines where id = ${line.id}`)[0].tenant, T.tenant);
    assert.equal((await T.c.req('POST', '/api/approval-lines', { name: '남의 결재자', steps: [{ label: '대표', type: 'user', userId: ctx.ownerId }] })).status, 404, '다른 회사 사람은 결재자로 못 넣음');
    // 화면 입구: 다른 회사 대표 — 공휴일·조직·결재 설정 화면은 열리고, 운영 상태·감사 기록 화면은 '권한 없음' · 다짐 대표는 모두 열림(예전과 같음)
    const page = async (c, path) => { const r = await c.get(path); return { status: r.status, blocked: String(r.body).includes('admin-no-access') }; };
    for (const path of ['/admin/holidays', '/admin/org', '/admin/approval-settings', '/admin/audit']) assert.deepEqual(await page(T.c, path), { status: 200, blocked: false }, `다른 회사 대표 ${path}`);
    for (const path of ['/admin/ops']) assert.deepEqual(await page(T.c, path), { status: 200, blocked: true }, `다른 회사 대표 ${path} = 권한 없음`);
    for (const path of ['/admin/ops', '/admin/audit', '/admin/holidays', '/admin/org', '/admin/approval-settings']) assert.deepEqual(await page(ctx.owner, path), { status: 200, blocked: false }, `다짐 대표 ${path}`);
    // 다짐 직원은 예전처럼 운영 메뉴 없음
    assert.equal((await ctx.staffA.client.get('/api/admin/ops')).status, 404);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/holidays/2026-12-31', { name: '직원 시도' })).status, 404);
  });

  test('S-05 공휴일은 회사별: 다짐이 넣은 날은 다짐만 · 다른 회사는 법정 공휴일 + 자기 회사 것 · 서로 지워도 영향 없음', async () => {
    const list = async (c) => (await c.ok('GET', '/api/holidays?from=2026-01-01&to=2026-12-31')).holidays;
    const base0 = await list(ctx.owner); const other0 = await list(T.c);
    assert.ok(base0.some((h) => h.date === '2026-08-15') && other0.some((h) => h.date === '2026-08-15' && h.name === '광복절'), '법정 공휴일은 양쪽 다');
    assert.deepEqual(other0.map((h) => h.date), base0.map((h) => h.date), '처음에는 같은 법정 공휴일 목록');
    // 다짐이 창립기념일 추가·광복절 이름 바꿈 → 다짐만
    await ctx.owner.ok('PUT', '/api/holidays/2026-07-01', { name: '다짐 창립기념일' });
    await ctx.owner.ok('PUT', '/api/holidays/2026-08-15', { name: '광복절(다짐 휴무)' });
    const other1 = await list(T.c);
    assert.ok(!other1.some((h) => h.date === '2026-07-01'), '다짐 휴무일이 다른 회사에 안 보임');
    assert.equal(other1.find((h) => h.date === '2026-08-15').name, '광복절');
    // 다른 회사가 자기 휴무일 추가·법정 공휴일 하나 뺌 → 그 회사만
    await T.c.ok('PUT', '/api/holidays/2026-07-01', { name: '튼튼짐 정기 휴관' });
    await T.c.ok('PUT', '/api/holidays/2026-11-20', { name: '튼튼짐 워크숍' });
    await T.c.ok('DELETE', '/api/holidays/2026-06-03');
    const other2 = await list(T.c); const base2 = await list(ctx.owner);
    assert.equal(other2.find((h) => h.date === '2026-07-01').name, '튼튼짐 정기 휴관');
    assert.ok(other2.some((h) => h.date === '2026-11-20') && !other2.some((h) => h.date === '2026-06-03'));
    assert.equal(base2.find((h) => h.date === '2026-07-01').name, '다짐 창립기념일', '다짐 것은 그대로');
    assert.ok(base2.some((h) => h.date === '2026-06-03') && !base2.some((h) => h.date === '2026-11-20'), '다른 회사가 빼거나 넣은 날은 다짐에 영향 없음');
    assert.equal(base2.find((h) => h.date === '2026-08-15').name, '광복절(다짐 휴무)');
    // 다른 회사가 뺀 날을 다시 넣고, 자기 휴무일을 지움
    await T.c.ok('PUT', '/api/holidays/2026-06-03', { name: '전국동시지방선거' }); await T.c.ok('DELETE', '/api/holidays/2026-11-20');
    const other3 = await list(T.c);
    assert.ok(other3.some((h) => h.date === '2026-06-03') && !other3.some((h) => h.date === '2026-11-20'));
    // 다짐 쪽은 예전 표에 그대로 저장(다른 회사 표에 다짐 행 없음)
    assert.equal((await sql`select count(*)::int n from company_holidays where tenant = 'default'`)[0].n, 0);
    assert.equal((await sql`select name from holidays where date = '2026-07-01'`)[0].name, '다짐 창립기념일');
    assert.equal((await fetch(`${BASE}/api/holidays`)).status, 401);
  });

  test("S-04 캘린더 '모두의 기본값'은 회사별: 다른 회사 대표가 바꿔도 다짐 기본색은 그대로, 다짐이 바꿔도 다른 회사는 그대로", async () => {
    const d0 = (await ctx.staffA.client.ok('GET', '/api/calendar-colors')).default;
    await T.c.ok('PUT', '/api/calendar-colors', { personal: '#111111', company: '#222222', asDefault: true });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/calendar-colors')).default, d0, '다짐 기본색 그대로');
    assert.deepEqual((await T.c.ok('GET', '/api/calendar-colors')).default, { personal: '#111111', company: '#222222' });
    await ctx.owner.ok('PUT', '/api/calendar-colors', { personal: '#333333', company: '#444444', asDefault: true });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/calendar-colors')).default, { personal: '#333333', company: '#444444' }, '다짐은 예전처럼 대표가 정한 값');
    assert.deepEqual((await T.c.ok('GET', '/api/calendar-colors')).default, { personal: '#111111', company: '#222222' }, '다른 회사는 그대로');
    const keys = (await sql`select key from app_settings where key like 'cal_colors%' order by key`).map((r) => r.key);
    assert.deepEqual(keys, ['cal_colors', `cal_colors:${T.tenant}`], '다짐은 예전 키 그대로');
  });

  test('S-03 옛 영업 자료가 없는 다른 회사는 영업 쓰기가 열림 · 다짐은 전환 기록이 정하는 그대로(행 없으면 닫힘)', async () => {
    await T.c.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
    await sql`delete from sales_cutover where tenant = ${T.tenant}`; // 마이그레이션이 넣어 준 행이 없는 회사(뒤에 생긴 회사) 흉내
    const lead = await T.c.ok('POST', '/api/sales/leads', { name: '튼튼짐 첫 거래처' });
    assert.ok(lead.id);
    assert.deepEqual((await sql`select ok, writes_open from sales_cutover where tenant = ${T.tenant}`)[0], { ok: true, writes_open: true });
    const v = await T.c.ok('GET', '/api/sales/src?view=leads');
    assert.equal((v.meta ?? v).readOnly, false, '읽기 전용 아님'); assert.ok(v.leads.some((l) => l.id === lead.id));
    // 옮기는 중인 회사(옮긴 원본 행이 있음)는 그대로 닫힘
    await sql`delete from sales_cutover where tenant = ${T.tenant}`;
    await sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${T.tenant}, 'leads', 'x-1', '{}')`;
    assert.equal((await T.c.req('POST', '/api/sales/leads', { name: '닫힌 동안' })).status, 409);
    await sql`delete from sales_src_rows where scope = ${T.tenant}`;
    // 다짐: 전환 행이 없으면 예전처럼 409(자동으로 열지 않음)
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
    await sql`delete from sales_cutover where tenant = 'default'`;
    assert.equal((await ctx.owner.req('POST', '/api/sales/leads', { name: '다짐 전환 전' })).status, 409);
    assert.equal((await sql`select count(*)::int n from sales_cutover where tenant = 'default'`)[0].n, 0);
  });
});
