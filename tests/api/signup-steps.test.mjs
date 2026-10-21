// V32 3 가입 4단계: 화면 단계 기록(익명·중복 없음) → 가입 신청 → 이메일 확인 → ③ 연락 채널(회사 만든 사람만, 가입 이메일을 회신 주소로) → ④ 초대 → 플랫폼 퍼널 단계별 이탈
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V32 3 가입 단계', () => {
  test('익명 화면 단계 · 가입 → 확인 → 연락 채널 → 초대 → 퍼널', async () => {
    const pub = new Client();
    for (const step of ['account_view', 'account_view', 'company_view']) await pub.ok('POST', '/api/public/signup-step', { anon: 'anon-test-0001', step });
    assert.equal((await pub.req('POST', '/api/public/signup-step', { anon: 'x', step: 'account_view' })).status, 400);
    assert.equal((await pub.req('POST', '/api/public/signup-step', { anon: 'anon-test-0001', step: 'verified' })).status, 400, '서버 단계는 밖에서 못 넣음');
    const c = new Client('boss');
    const r = await c.ok('POST', '/api/auth/signup', { email: 'boss@steps.test', name: '대표', password: 'signup-pass-1234', mode: 'team', company: '단계상사', size: '2-10', agree: { terms: true, age14: true, privacy: true } });
    await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
    const [{ tenant }] = await sql`select tenant from users where email = 'boss@steps.test'`;
    const steps = async () => (await sql`select step from signup_steps where tenant = ${tenant} order by id`).map((x) => x.step);
    assert.deepEqual(await steps(), ['submitted', 'verified']);
    const st = await c.ok('GET', '/api/onboarding');
    assert.equal(st.email, 'boss@steps.test'); assert.equal(st.admin, true); assert.equal(st.people, 1);
    await c.ok('POST', '/api/onboarding', { title: '대표', channels: { replyTo: 'signup', phone: '010-2222-3333' } });
    const [u] = await sql`select work_email, phone, title from users where email = 'boss@steps.test'`;
    assert.deepEqual([u.work_email, u.phone, u.title], ['boss@steps.test', '010-2222-3333', '대표']);
    // 초대받은 직원은 연락 채널을 기록하지 않음(회사 만든 사람만)
    const [hq] = await sql`select id from org_units where tenant = ${tenant} and type = 'hq'`;
    const inv = await c.ok('POST', '/api/admin/users', { email: 'staff@steps.test', name: '직원', role: 'staff', orgUnitIds: [hq.id] });
    const s = new Client('staff');
    await s.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'staff-pass-1234' });
    await s.ok('POST', '/api/onboarding', { channels: { replyTo: 'other', workEmail: 'other@steps.test' }, invited: true });
    assert.equal((await sql`select work_email from users where email = 'staff@steps.test'`)[0].work_email, null, '직원은 반영 안 됨');
    assert.deepEqual(await steps(), ['submitted', 'verified', 'channels_done']);
    await c.ok('POST', '/api/onboarding', { invited: true });
    await c.ok('POST', '/api/onboarding', { invited: true });
    assert.deepEqual(await steps(), ['submitted', 'verified', 'channels_done', 'invite_done'], '같은 단계는 한 번');
    // 플랫폼 퍼널
    await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
    const f = await ctx.owner.ok('GET', '/api/platform/funnel');
    const n = (k) => f.steps.find((x) => x.step === k).n;
    assert.deepEqual(['account_view', 'company_view', 'submitted', 'verified', 'channels_done', 'invite_done'].map(n), [1, 1, 1, 1, 1, 1]);
    assert.equal(f.steps.find((x) => x.step === 'company_view').fromPrev, 100);
  });
});
