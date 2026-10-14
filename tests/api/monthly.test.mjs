// V20 업무 월별 보관·이월: 이월 필터·완료 달별 불러오기·달별 개수, 매월 1일 월 마감 기록(회사·담당자별, 소급 3개월 "추정", 중복 없음, 대표 알림 1건, 권한)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const thisMonth = kst(new Date()).slice(0, 7);
const shift = (m, n) => { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const last = shift(thisMonth, -1), last2 = shift(thisMonth, -2);
const at = (m, day) => `${m}-${String(day).padStart(2, '0')}T12:00:00+09:00`;

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('V20 월별 보관·이월·월 마감', () => {
  const T = {};
  test('준비: 박직원 업무 4건(지지난달 생성·지난달 완료 / 지난달 생성·마감 지남 / 지난달 생성·이번 달 완료 / 이번 달 생성)', async () => {
    assert.equal((await sql`select count(*)::int n from tasks where assignee_id = ${ctx.staffB.id}`)[0].n, 0, '시험 담당자는 업무 없이 시작');
    const mk = async (title, extra = {}) => (await ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ctx.staffB.id, orgUnitId: ctx.siteB, approvalRequired: false, ...extra })).id;
    T.t1 = await mk('월마감 1'); T.t2 = await mk('월마감 2', { dueDate: `${last}-20` }); T.t3 = await mk('월마감 3'); T.t4 = await mk('월마감 4');
    await sql`update tasks set created_at = ${at(last2, 10)}, status = 'done', completed_at = ${at(last, 5)} where id = ${T.t1}`;
    await sql`update tasks set created_at = ${at(last, 3)} where id = ${T.t2}`;
    await sql`update tasks set created_at = ${at(last, 8)}, status = 'done', completed_at = now() where id = ${T.t3}`;
  });

  test('이월만 보기: 지난달 이전부터 이어진 진행 중 업무만(마감일, 없으면 만든 날)', async () => {
    const ids = (await ctx.owner.ok('GET', `/api/tasks?carried=1&assigneeId=${ctx.staffB.id}`)).tasks.map((t) => t.id);
    assert.deepEqual(ids, [T.t2], '마감이 지난달인 진행 중 업무만 — 완료·이번 달 업무 제외');
  });

  test('완료 보관: doneMonth 로 그 달만, 달별 개수', async () => {
    const l = (await ctx.owner.ok('GET', `/api/tasks?view=done&doneMonth=${last}&assigneeId=${ctx.staffB.id}`)).tasks.map((t) => t.id);
    assert.deepEqual(l, [T.t1]);
    const now = (await ctx.owner.ok('GET', `/api/tasks?view=done&doneMonth=${thisMonth}&assigneeId=${ctx.staffB.id}`)).tasks.map((t) => t.id);
    assert.deepEqual(now, [T.t3]);
    const months = (await ctx.owner.ok('GET', `/api/tasks/done-months?assigneeId=${ctx.staffB.id}`)).months;
    assert.deepEqual(months, [{ month: thisMonth, n: 1 }, { month: last, n: 1 }]);
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/done-months?assigneeId=${ctx.staffB.id}`)).months.length, 0, '볼 수 없는 현장 업무는 개수에도 없음');
  });

  test('월 마감 기록: 첫 실행은 최근 3개월 소급(추정)·회사 전체+담당자별·대표 알림 1건, 다시 실행해도 중복 없음', async () => {
    await tick();
    const rows = await sql`select month, user_id, done_count, carried_count, overdue_count, created_count, estimated from task_month_close where tenant = 'default'`;
    const months = [...new Set(rows.map((r) => r.month))].sort();
    assert.deepEqual(months, [shift(thisMonth, -3), last2, last], '최근 3개월');
    const b = rows.find((r) => r.month === last && r.user_id === ctx.staffB.id);
    assert.deepEqual({ done: b.done_count, carried: b.carried_count, overdue: b.overdue_count, created: b.created_count }, { done: 1, carried: 2, overdue: 1, created: 2 }, '지난달: 완료 1(1번)·이월 2(2·3번)·지연 1(2번)·새 업무 2');
    const b2 = rows.find((r) => r.month === last2 && r.user_id === ctx.staffB.id);
    assert.deepEqual({ done: b2.done_count, carried: b2.carried_count, created: b2.created_count }, { done: 0, carried: 1, created: 1 }, '지지난달: 1번이 만들어지고 아직 안 끝남');
    assert.ok(rows.some((r) => r.month === last && r.user_id === null), '회사 전체 행');
    if (Number(kst(new Date()).slice(8)) >= 3) assert.ok(rows.every((r) => r.estimated), '달이 끝나고 하루 넘게 지나 계산 → 추정');
    const n1 = rows.length;
    const notes = await sql`select title, link from notifications where user_id = ${ctx.ownerId} and type = 'month_close'`;
    assert.equal(notes.length, 1, '대표 알림은 지난달 1건만');
    assert.match(notes[0].title, new RegExp(`^${Number(last.slice(5))}월 마감: 완료 \\d+ · 이월 \\d+ · 지연 \\d+$`));
    assert.equal(notes[0].link, `/reports?month=${last}`);
    await tick();
    assert.equal((await sql`select count(*)::int n from task_month_close`)[0].n, n1, '두 번 실행해도 중복 없음');
    assert.equal((await sql`select count(*)::int n from notifications where type = 'month_close'`)[0].n, 1);
    // 나중에 업무가 바뀌어도 그 달 기록은 그대로
    await sql`update tasks set status = 'done', completed_at = ${at(last, 25)} where id = ${T.t2}`;
    await tick();
    assert.equal((await sql`select carried_count from task_month_close where month = ${last} and user_id = ${ctx.staffB.id}`)[0].carried_count, 2);
  });

  test('보기 권한: 대표는 월별 기록, 직원은 403', async () => {
    const r = await ctx.owner.ok('GET', '/api/reports/monthly');
    assert.ok(r.months.some((x) => x.month === last && x.user_id === null));
    assert.ok(r.months.some((x) => x.month === last && x.name === '박직원'));
    assert.equal((await ctx.staffA.client.req('GET', '/api/reports/monthly')).status, 403);
  });
});
