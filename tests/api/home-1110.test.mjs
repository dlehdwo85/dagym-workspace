// #1110(대표 11/22 시안 승인) 홈 요약 한 번에(/api/home): 오늘 처리할 것 숫자(내 업무 기한 지남·오늘 마감·결재·메시지…) · 회사 현황(대표·관리자만) · 공지 2개
// 직원은 회사 현황 없음 · 다른 회사 숫자는 섞이지 않음 · 지점 보고 칸은 지점 보고를 쓰는 회사만
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, other;
const seoul = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_APPROVAL: '0', SIGNUP_IP_PER_DAY: '50' });
  sql = testDb(); ctx = await bootstrap();
  const c = new Client('other@home1110.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'other@home1110.test', password: 'signup-pass-1234', name: '다른대표', mode: 'team', company: '다른상사3', size: '2-10', industry: '제조', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  other = c;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#1110 홈 요약', () => {
  test('#1113 검토 대기(현장 관리자 이상): 검토 요청된 업무 수·내가 요청자인 것 먼저 3건 — 직원은 없음(null)', async () => {
    const t = await ctx.managerA.client.ok('POST', '/api/tasks', { title: '홈 검토 대기 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: true });
    const id = t.id ?? t.task?.id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
    const m = await ctx.managerA.client.ok('GET', '/api/home');
    assert.ok(m.review.count >= 1); assert.equal(m.review.items[0].title, '홈 검토 대기 업무'); assert.equal(m.review.items[0].requested_by, m.me, '내가 요청자인 것 먼저');
    assert.equal((await ctx.staffA.client.ok('GET', '/api/home')).review, null, '직원은 검토 칸 없음');
    assert.ok(!(await other.ok('GET', '/api/home')).review?.items?.some((x) => x.title === '홈 검토 대기 업무'), '다른 회사에는 안 보임');
  });

  test('직원: 내 업무 기한 지남(가장 오래된 날)·오늘 마감 · 회사 현황 없음 · 남의 업무는 안 셈', async () => {
    const today = seoul();
    for (const [title, due] of [['홈 지남 3일', addDays(today, -3)], ['홈 지남 1일', addDays(today, -1)], ['홈 오늘', today], ['홈 다음 주', addDays(today, 8)]])
      await ctx.staffA.client.ok('POST', '/api/tasks', { title, orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: due, approvalRequired: false });
    await ctx.owner.ok('POST', '/api/tasks', { title: '남의 지난 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffB.id, dueDate: addDays(today, -2), approvalRequired: false });
    const h = await ctx.staffA.client.ok('GET', '/api/home');
    assert.equal(h.admin, false); assert.equal(h.company, null, '직원은 회사 현황 없음');
    assert.equal(h.todo.overdue, 2); assert.equal(h.todo.overdueOldestDays, 3); assert.equal(h.todo.dueToday, 1);
    assert.equal(typeof h.todo.unread, 'number'); assert.equal(typeof h.todo.approvals, 'number'); assert.ok(Array.isArray(h.notices));
  });

  test('대표: 회사 현황 — 이번 주 지점 보고 제출 n/전체 · 공지 최근 2개(안 읽음 표시)', async () => {
    const s = await ctx.owner.ok('PUT', '/api/branch-reports/setup', { sites: [{ name: '홈 강남점', writerUserId: ctx.staffA.id }, { name: '홈 판교점' }, { name: '홈 숨김점', hidden: true }] });
    const mon = (() => { const d = seoul(); const w = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((w + 6) % 7)); })();
    const fri = addDays(mon, 4);
    await sql`insert into branch_reports (tenant, site_id, kind, period_start, period_end, report_day, status, body, submitted_at)
      values ('default', ${s.sites[0].id}, 'weekly', ${fri}::date - 7, ${fri}::date - 1, ${fri}, 'submitted', '{}'::jsonb, now())`;
    for (const t of ['홈 공지 1', '홈 공지 2', '홈 공지 3']) await ctx.owner.ok('POST', '/api/notices', { title: t, body: '내용' });
    const h = await ctx.owner.ok('GET', '/api/home');
    assert.equal(h.admin, true); assert.ok(h.company, '회사 현황');
    assert.deepEqual(h.company.branch, { submitted: 1, total: 2, day: fri }, '숨긴 지점 빼고 1/2');
    assert.equal(h.notices.length, 2);
    const st = await ctx.staffA.client.ok('GET', '/api/home');
    assert.equal(st.notices.length, 2); assert.equal(st.notices.every((n) => n.read === false), true, '직원에게는 안 읽은 공지');
  });

  test('다른 회사: 우리 숫자·지점 보고 칸 없음 · 로그인 없으면 401', async () => {
    const h = await other.ok('GET', '/api/home');
    assert.equal(h.admin, true); assert.equal(h.todo.overdue, 0); assert.equal(h.company.branch, null, '지점 보고는 다짐만');
    assert.equal(h.notices.length, 0, '다른 회사 공지 안 보임');
    assert.equal((await new Client('nobody@home1110.test').req('GET', '/api/home')).status, 401);
  });
});
