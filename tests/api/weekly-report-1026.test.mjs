// 408차 범용화 '주간 보고 회사별'(대표 11/13 승인 — docs/generalization-audit.md G-17·G-55):
// 예전엔 주간 보고가 기본 회사(다짐)만 만들어져 다른 회사의 [주간 보고] 메뉴는 영원히 비어 있고 [지금 만들기]는 404 였다.
// · 다른 회사도 자기 회사 보고(지금 만들기·월요일 자동) — 회사 이름 머리글, '미해결 민원'(다짐 태그 집계) 숫자 없음
// · 다짐 보고는 모양·숫자·알림 글 그대로, 다른 회사 업무가 섞이지 않음 · 회사끼리 서로의 보고는 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, addDays, bootstrap, resetDb, seoulToday, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T, mate, Z;
const today = seoulToday();
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return r.json(); };
async function join(email, name, company) {
  await sql`delete from signup_attempts`;
  const c = new Client(email);
  const r = await c.ok('POST', '/api/auth/signup', { email, password: 'signup-pass-1234', name, mode: 'team', company, industry: '유통·판매', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  return { c, id: me.user.id, tenant: me.user.tenant, unit: (await c.ok('GET', '/api/admin/org-units')).units[0].id };
}
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  T = await join('ceo@other-weekly.test', '박대표', '튼튼상사');
  const inv = await T.c.ok('POST', '/api/admin/users', { email: 'staff@other-weekly.test', name: '김사원', role: 'staff', orgUnitIds: [T.unit] });
  mate = new Client('staff@other-weekly.test'); await mate.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'mate-pass-1234' });
  Z = await join('ceo@quiet-weekly.test', '조용한', '조용상사'); // 업무가 하나도 없는 회사
  // 업무: 다짐 2건(1건은 '회원 민원' 태그) · 튼튼상사 2건(1건은 지난주 금요일 마감 = 지연)
  await ctx.owner.ok('POST', '/api/tasks', { title: '다짐 주간 업무', orgUnitId: ctx.siteA, dueDate: addDays(today, 2) });
  await ctx.owner.ok('POST', '/api/tasks', { title: '다짐 민원 처리', orgUnitId: ctx.siteA, dueDate: addDays(today, 1), tags: ['회원 민원'], priority: 'high' });
  await T.c.ok('POST', '/api/tasks', { title: '튼튼 견적서 회신', orgUnitId: T.unit, dueDate: addDays(today, 14), priority: 'urgent' });
  await T.c.ok('POST', '/api/tasks', { title: '튼튼 지난 업무', orgUnitId: T.unit, dueDate: addDays(today, -9) });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('408차 주간 보고 회사별', () => {
  let repD, repT;
  test('다짐(기본 회사): [지금 만들기] 보고의 모양·숫자 그대로 — 다른 회사 업무가 섞이지 않음', async () => {
    const { id } = await ctx.owner.ok('POST', '/api/reports', { weekStart: today });
    repD = id;
    const d = (await ctx.owner.ok('GET', `/api/reports/${id}`)).report.data;
    assert.deepEqual(Object.keys(d).sort(), ['issues', 'photos', 'sales', 'sites', 'totals', 'weekEnd', 'weekStart'], '예전 모양 그대로(company·plain 없음)');
    assert.deepEqual(Object.keys(d.totals).sort(), ['complaints', 'created', 'done', 'overdue', 'review']);
    assert.equal(d.totals.created, 2); assert.equal(d.totals.complaints, 1);
    const site = d.sites.find((s) => s.id === ctx.siteA);
    assert.deepEqual([site.created, site.open_complaints], [2, 1]);
    assert.ok(d.issues.some((t) => t.title === '다짐 민원 처리') && !JSON.stringify(d).includes('튼튼'), '다른 회사 업무 없음');
    const list = (await ctx.owner.ok('GET', '/api/reports')).reports;
    assert.equal(list.length, 1); assert.equal(list[0].totals.complaints, 1);
  });

  test('다른 회사: 목록은 비어 있다가 [지금 만들기](예전 404)로 자기 회사 보고 — 회사 이름·민원 칸 없음 · 직원은 못 봄', async () => {
    assert.deepEqual((await T.c.ok('GET', '/api/reports')).reports, []);
    const made = await T.c.ok('POST', '/api/reports', { weekStart: today });
    repT = made.id; assert.equal(made.existed, false);
    assert.notEqual(repT, repD, '같은 주라도 회사마다 따로');
    const d = (await T.c.ok('GET', `/api/reports/${repT}`)).report.data;
    assert.deepEqual([d.plain, d.company], [true, '튼튼상사']);
    assert.deepEqual(Object.keys(d.totals).sort(), ['created', 'done', 'overdue', 'review'], "'미해결 민원' 숫자 없음");
    assert.deepEqual([d.totals.created, d.totals.overdue], [2, 1]);
    assert.ok(d.sites.length === 1 && !('open_complaints' in d.sites[0]));
    assert.ok(d.issues.some((t) => t.title === '튼튼 견적서 회신') && d.issues.some((t) => t.title === '튼튼 지난 업무'));
    assert.ok(!JSON.stringify(d).includes('다짐'), '다짐 업무·이름 없음');
    assert.equal(d.sales, null, '영업 공간을 안 쓰는 회사는 영업 줄 없음');
    const list = (await T.c.ok('GET', '/api/reports')).reports;
    assert.equal(list.length, 1); assert.equal(list[0].totals.complaints, undefined);
    assert.equal((await T.c.ok('POST', '/api/reports', { weekStart: today })).existed, true, '이미 있으면 그 보고');
    assert.equal((await mate.get('/api/reports')).status, 403); assert.equal((await mate.get(`/api/reports/${repT}`)).status, 403);
    assert.ok([403, 404].includes((await mate.req('POST', '/api/reports', {})).status));
  });

  test('회사끼리 서로의 보고는 404 · 목록도 자기 회사 것만', async () => {
    assert.equal((await ctx.owner.get(`/api/reports/${repT}`)).status, 404);
    assert.equal((await T.c.get(`/api/reports/${repD}`)).status, 404);
    assert.equal((await Z.c.get(`/api/reports/${repT}`)).status, 404);
    assert.deepEqual((await ctx.owner.ok('GET', '/api/reports')).reports.map((r) => r.id), [repD]);
    assert.deepEqual((await Z.c.ok('GET', '/api/reports')).reports, []);
    assert.equal((await sql`select count(*)::int n from weekly_reports where week_start = (select week_start from weekly_reports where id = ${repD})`)[0].n, 2, '같은 주 2건(회사별 1건)');
  });

  test('월요일 자동 생성: 다짐은 예전처럼 · 다른 회사는 지난주에 움직임이 있던 회사만 · 알림은 그 회사 대표·관리자에게(민원 글자 없음)', async () => {
    const out = await tick();
    const w = (out.detail ?? out).weeklyReport;
    if (w?.skipped === 'before Monday 08:00') return; // 월요일 08시 전에 돌린 시험은 여기까지
    const lastMonday = (await sql`select week_start::text w from weekly_reports where tenant = 'default' order by week_start limit 1`)[0].w;
    assert.ok(w.created, JSON.stringify(w)); assert.equal(w.others, 1, '튼튼상사 1곳(조용상사는 움직임 없음)');
    const rows = await sql`select tenant, data from weekly_reports where week_start = ${lastMonday} order by tenant`;
    assert.deepEqual(rows.map((r) => r.tenant).sort(), ['default', T.tenant].sort());
    const t = rows.find((r) => r.tenant === T.tenant).data;
    assert.deepEqual([t.plain, t.company, t.totals.overdue], [true, '튼튼상사', 1]);
    assert.equal((await sql`select count(*)::int n from weekly_reports where tenant = ${Z.tenant}`)[0].n, 0, '안 쓰는 회사에는 빈 보고를 만들지 않음');
    const nT = await sql`select n.title, n.body, u.tenant from notifications n join users u on u.id = n.user_id where n.type = 'weekly_report' and n.user_id = ${T.id}`;
    assert.equal(nT.length, 1); assert.ok(/^완료 0 · 새 업무 0 · 지연 1$/.test(nT[0].body), nT[0].body);
    const nD = await sql`select n.body from notifications n where n.type = 'weekly_report' and n.user_id = ${ctx.ownerId}`;
    assert.equal(nD.length, 1); assert.ok(nD[0].body.includes('미해결 민원'), '다짐 알림 글은 예전 그대로');
    assert.equal((await sql`select count(*)::int n from notifications n join users u on u.id = n.user_id where n.type = 'weekly_report' and u.email = 'staff@other-weekly.test'`)[0].n, 0, '직원에게는 안 감');
    // 다시 돌려도 더 만들지 않음
    const again = (await tick()); const w2 = (again.detail ?? again).weeklyReport;
    assert.equal(w2.skipped, 'exists'); assert.equal(w2.others, undefined);
    assert.equal((await sql`select count(*)::int n from weekly_reports where week_start = ${lastMonday}`)[0].n, 2);
  });
});
