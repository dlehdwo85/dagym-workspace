// 412차 범용화 P2 문구 ③(docs/generalization-audit.md G-24): QR 신고의 '회원 민원'은 피트니스 말 —
// 다른 회사는 '고객 민원'(양식 종류·업무 제목 머리·태그·접수 알림·현장 비교의 미해결 민원 집계).
// 다짐(기본 회사)은 태그 '현장신고'·'회원 민원', 접수 알림 '현장 신고 접수 (회원 민원)', 현장 비교·주간 보고의 미해결 민원 숫자가 그대로여야 한다(노트북 11/14 조건).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, seoulToday, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T;
const anon = new Client('anon');
const notifs = async (c) => (await c.ok('GET', '/api/notifications')).items;
const tokenOf = async (c, id) => (await c.ok('GET', '/api/forms')).forms.find((f) => f.id === id).token;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@other-complaint.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-complaint.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '모퉁이카페', industry: '외식·카페', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  await c.ok('PUT', '/api/org/model', { multiSite: true }); // 지점이 있어야 '지점 비교'에 나온다
  const hq = (await c.ok('GET', '/api/admin/org-units')).units[0].id;
  const branch = (await c.ok('POST', '/api/admin/org-units', { name: '역삼점', type: 'branch', parentId: hq })).id;
  T = { c, id: me.user.id, tenant: me.user.tenant, hq, branch };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('412차 G-24 QR 신고 민원 낱말', () => {
  test('다짐: 회원 민원 그대로 — 양식 이름·공개 화면·업무 제목 머리·태그(현장신고, 회원 민원)·접수 알림·현장 비교·주간 보고 숫자', async () => {
    const f = await ctx.managerA.client.ok('POST', '/api/forms', { orgUnitId: ctx.siteA, kind: 'complaint' });
    const forms = (await ctx.managerA.client.ok('GET', '/api/forms')).forms;
    assert.equal(forms.find((x) => x.id === f.id).title, '회원 민원');
    const tok = forms.find((x) => x.id === f.id).token;
    assert.equal((await anon.ok('GET', `/api/public/forms/${tok}`)).kindLabel, '회원 민원');
    await anon.ok('POST', `/api/public/forms/${tok}`, { content: '샤워실 온수가 안 나와요', location: '남자 샤워실', name: '김회원', phone: '010-0000-0000', agree: true }, { 'x-forwarded-for': '10.2.2.1' });
    const [t] = await sql`select id, title, tags, priority from tasks where title like '%샤워실 온수%'`;
    assert.equal(t.title, '[회원 민원] 샤워실 온수가 안 나와요'); assert.deepEqual(t.tags, ['현장신고', '회원 민원']); assert.equal(t.priority, 'high');
    assert.ok((await notifs(ctx.managerA.client)).some((n) => n.title === '현장 신고 접수 (회원 민원): 샤워실 온수가 안 나와요'), JSON.stringify((await notifs(ctx.managerA.client)).map((n) => n.title)));
    const site = (await ctx.managerA.client.ok('GET', '/api/insights/sites?weeks=4')).sites.find((s) => s.id === ctx.siteA);
    assert.equal(site.openComplaints, 1, '현장 비교 미해결 민원');
    const rep = await ctx.owner.ok('POST', '/api/reports', { weekStart: seoulToday() });
    const d = (await ctx.owner.ok('GET', `/api/reports/${rep.id}`)).report.data;
    assert.equal(d.totals.complaints, 1, '주간 보고 미해결 민원'); assert.equal(d.sites.find((s) => s.id === ctx.siteA).open_complaints, 1);
  });

  test('다른 회사: 고객 민원 — 양식 이름·공개 화면·업무 제목 머리·태그(QR 신고, 고객 민원)·접수 알림(신고 접수)·지점 비교 미해결 민원 · 다짐 낱말 없음', async () => {
    const f = await T.c.ok('POST', '/api/forms', { orgUnitId: T.branch, kind: 'complaint' });
    const forms = (await T.c.ok('GET', '/api/forms')).forms;
    assert.equal(forms.find((x) => x.id === f.id).title, '고객 민원');
    const tok = forms.find((x) => x.id === f.id).token;
    const info = await anon.ok('GET', `/api/public/forms/${tok}`);
    assert.deepEqual([info.kindLabel, info.brand, info.place], ['고객 민원', '모퉁이카페', '역삼점']);
    await anon.ok('POST', `/api/public/forms/${tok}`, { content: '주문한 음료가 30분째 안 나와요', location: '2층 창가', name: '이손님', phone: '010-0000-0000', agree: true }, { 'x-forwarded-for': '10.2.2.2' });
    const [t] = await sql`select id, title, tags, priority, org_unit_id, assignee_id, created_by from tasks where title like '%주문한 음료%'`;
    assert.equal(t.title, '[고객 민원] 주문한 음료가 30분째 안 나와요'); assert.deepEqual(t.tags, ['QR 신고', '고객 민원']); assert.equal(t.priority, 'high'); assert.equal(t.org_unit_id, T.branch);
    // 관리자 역할이 없는 작은 회사: 담당·만든 사람 = 그 회사 대표(예전엔 담당 없음·알림 없음, 만든 사람이 다른 회사 대표로 잡힐 수 있었음)
    assert.deepEqual([t.assignee_id, t.created_by], [T.id, T.id]);
    assert.equal((await sql`select tenant from users where id = ${t.created_by}`)[0].tenant, T.tenant);
    const ns = (await notifs(T.c)).map((n) => n.title);
    assert.ok(ns.includes('신고 접수 (고객 민원): 주문한 음료가 30분째 안 나와요'), JSON.stringify(ns));
    assert.ok(!ns.some((x) => /현장|회원/.test(x)), JSON.stringify(ns));
    const site = (await T.c.ok('GET', '/api/insights/sites?weeks=4')).sites.find((s) => s.id === T.branch);
    assert.equal(site.openComplaints, 1, '지점 비교 미해결 민원(고객 민원 태그)');
    // 시설 고장·비품 요청 이름은 두 회사가 같음
    const fac = await T.c.ok('POST', '/api/forms', { orgUnitId: T.branch, kind: 'facility' });
    assert.equal((await anon.ok('GET', `/api/public/forms/${await tokenOf(T.c, fac.id)}`)).kindLabel, '시설 고장');
    // 다짐 숫자에는 섞이지 않음
    const dsite = (await ctx.managerA.client.ok('GET', '/api/insights/sites?weeks=4')).sites.find((s) => s.id === ctx.siteA);
    assert.equal(dsite.openComplaints, 1);
  });
});
