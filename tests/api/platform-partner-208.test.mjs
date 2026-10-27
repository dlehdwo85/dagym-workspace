// 208차 #667 설계 파트너(결정 15-30): [고객사 추가] 구분 = 설계 파트너 → 기간은 슈퍼관리자가 꼭 적음(기본값 없음) · AI 월 5,000원·마케팅 크레딧 0 자동
// · 끝 3일 전 슈퍼관리자에게 전환/연장/종료 알림 · 끝나면 읽기 전용 · 유료로 바뀌면 파트너 기본값을 걷고 요금제 한도
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

let srv, sql, ctx;
const N = {};
const body = (x, more = {}) => ({ company: `파트너회사${x}`, industries: [], size: '2-10', ownerName: `대표${x}`, ownerEmail: `boss${x}@partner.test`, segment: 'partner', ...more });
const preset = async (tenant) => {
  const [s] = await sql`select limit_overrides from tenant_subscriptions where tenant = ${tenant}`;
  const [m] = await sql`select monthly_credits::float8 c from mkt_settings where tenant = ${tenant}`;
  return { ai: s.limit_overrides.aiBudgetKrw, credits: m ? m.c : undefined };
};
const superNotes = () => sql`select title, link, body from notifications where user_id = ${ctx.ownerId} and title like '설계 파트너%' order by created_at`;

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  [N.paid] = (await sql`select code from plans where active and code <> all(${['trial', 'free', 'team_free', 'w_free']}) order by sort limit 1`).map((r) => r.code);
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('208차 #667 설계 파트너', () => {
  test('만들 때: 기간 꼭 적기(기본값 없음, 1년까지)·체험으로만 → AI 월 5,000원·마케팅 크레딧 0 자동 / 일반 고객은 그대로(90일까지)', async () => {
    const bad = async (b, re) => { const r = await ctx.owner.req('POST', '/api/platform/tenants', b); assert.equal(r.status, 400, JSON.stringify(b)); assert.match(r.body.error.message, re); };
    await bad(body(1), /설계 파트너 기간\(일\)을 적어 주세요/);
    await bad(body(1, { trialDays: 30, planCode: N.paid }), /체험으로 시작합니다/);
    await bad(body(1, { trialDays: 366 }), /기간\(일\)/);
    await bad(body(9, { segment: 'customer', trialDays: 120 }), /90일까지/);
    assert.equal((await ctx.staffA.client.req('POST', '/api/platform/tenants', body(1, { trialDays: 30 }))).status, 404, '플랫폼 운영자만');

    const p = await ctx.owner.ok('POST', '/api/platform/tenants', body(1, { trialDays: 200 }));
    N.p = p.tenant; N.pInvite = p.inviteLink;
    const [s] = await sql`select plan_code, status, (trial_ends_at::date - current_date) as days from tenant_subscriptions where tenant = ${p.tenant}`;
    assert.deepEqual([s.plan_code, s.status], ['trial', 'trial']); assert.ok(Number(s.days) >= 199 && Number(s.days) <= 200, `200일 (${s.days})`);
    assert.deepEqual(await preset(p.tenant), { ai: 5000, credits: 0 });
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${p.tenant}/detail`);
    assert.deepEqual([d.aiBudget.limitKrw, d.aiBudget.source, d.partner.mktCredits, d.partner.trial.trial, d.partner.trial.partner], [5000, 'override', 0, true, true]);
    const row = (await ctx.owner.ok('GET', '/api/platform/tenants?segment=partner')).tenants.find((x) => x.id === p.tenant);
    assert.deepEqual([row.mkt_credits_limit, row.mkt_credits_left], [0, 0], '목록에 마케팅 0/0 크레딧');
    const [a] = await sql`select detail from audit_logs where action = 'platform.tenant_create' and target_id = ${p.tenant}`;
    assert.equal(a.detail.preset.aiBudgetKrw, 5000);

    const c = await ctx.owner.ok('POST', '/api/platform/tenants', body(2, { segment: 'customer', trialDays: 14 }));
    N.c = c.tenant;
    assert.deepEqual(await preset(c.tenant), { ai: undefined, credits: undefined }, '일반 고객 체험에는 파트너 기본값 없음');
    assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${c.tenant}/detail`)).partner, null);
  });

  test('끝 3일 전: 슈퍼관리자에게 전환·연장·종료 알림 한 번(그 회사 관리 창 링크) · 파트너 대표에겐 "설계 파트너 기간" · 연장하면 새 기간에 다시', async () => {
    const boss = new Client('partner-boss');
    await boss.ok('POST', `/api/invitations/${N.pInvite.split('/').pop()}/accept`, { password: 'partner-boss-1234' });
    N.boss = boss; N.bossId = (await boss.ok('GET', '/api/auth/me')).user.id;
    await sql`update tenant_subscriptions set trial_ends_at = now() + interval '2 days' where tenant in (${N.p}, ${N.c})`;
    await tick(); await tick();
    let n = await superNotes();
    assert.equal(n.length, 1, '파트너 한 곳만, 두 번 돌려도 한 번');
    assert.match(n[0].title, /^설계 파트너 기간이 2일 남았습니다 — 파트너회사1$/);
    assert.equal(n[0].link, `/platform?tab=company&tenant=${encodeURIComponent(N.p)}`);
    assert.match(n[0].body, /\[유료 전환\]·\[기간 연장\]·\[지금 종료\]/);
    const mine = await sql`select title from notifications where user_id = ${N.bossId} and (title like '설계 파트너%' or title like '무료 체험%')`;
    assert.deepEqual(mine.map((x) => x.title), ['설계 파트너 기간이 2일 남았습니다']);
    // 연장 → 새 기간 끝 1일 전에 다시(슈퍼관리자·파트너 대표 모두)
    await ctx.owner.ok('POST', `/api/platform/tenants/${N.p}/trial`, { action: 'extend', days: 90 });
    assert.deepEqual((await sql`select trial_notified from tenant_subscriptions where tenant = ${N.p}`)[0].trial_notified, {});
    await sql`update tenant_subscriptions set trial_ends_at = now() + interval '1 day' where tenant = ${N.p}`;
    await tick();
    n = await superNotes();
    assert.equal(n.length, 2); assert.match(n[1].title, /1일 남았습니다 — 파트너회사1$/);
    assert.ok((await sql`select 1 from notifications where user_id = ${N.bossId} and title = '설계 파트너 기간이 1일 남았습니다'`).length, '파트너 대표에게도 새 기간 알림');
  });

  test('끝나면 읽기 전용(파트너 문구) → [유료 전환]하면 기본값을 걷고 요금제 한도 · 운영자가 따로 바꾼 값은 그대로', async () => {
    await ctx.owner.ok('POST', `/api/platform/tenants/${N.p}/trial`, { action: 'end' });
    const w = await N.boss.post('/api/tasks', { title: '막혀야 함' });
    assert.equal(w.status, 402); assert.equal(w.body.error.code, 'read_only'); assert.match(w.body.error.message, /^설계 파트너 기간이 끝나 읽기 전용입니다/);
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${N.p}/detail`);
    assert.deepEqual([d.partner.trial.readOnly, d.partner.trial.trial], [true, false]);
    // 운영자가 AI 예산을 8,000원으로 바꿔 둔 뒤 유료 전환 → AI 예산은 운영자 값 유지, 마케팅 크레딧 0 은 걷힘
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.p}/limits`, { aiBudgetKrw: 8000 });
    await ctx.owner.ok('POST', `/api/platform/tenants/${N.p}/trial`, { action: 'convert', planCode: N.paid });
    assert.deepEqual(await preset(N.p), { ai: 8000, credits: null });
    await N.boss.ok('POST', '/api/tasks', { title: '유료 전환 뒤 업무' });
    assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${N.p}/detail`)).partner.trial, null, '유료면 기간 없음');
    // 기본값 그대로인 파트너를 요금제 변경(유료·사용)으로 바꾸면 둘 다 걷힘
    const q = await ctx.owner.ok('POST', '/api/platform/tenants', body(3, { trialDays: 10 }));
    assert.deepEqual(await preset(q.tenant), { ai: 5000, credits: 0 });
    await ctx.owner.ok('PUT', `/api/platform/tenants/${q.tenant}`, { planCode: N.paid, addons: {}, status: 'active' });
    assert.deepEqual(await preset(q.tenant), { ai: undefined, credits: null });
    const b = await ctx.owner.ok('GET', `/api/platform/tenants/${q.tenant}/detail`);
    assert.notEqual(b.aiBudget.source, 'override', '요금제 AI 예산을 따름');
  });

  test('구분 바꾸기: 체험 중 회사를 설계 파트너로 → 기본값 넣음, 일반으로 되돌리면 걷음 · 유료 회사는 구분만 바뀜', async () => {
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.c}/profile`, { segment: 'partner' });
    assert.deepEqual(await preset(N.c), { ai: 5000, credits: 0 });
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.c}/profile`, { segment: 'partner', contactName: '같은 구분 다시' });
    assert.deepEqual(await preset(N.c), { ai: 5000, credits: 0 }, '구분이 그대로면 아무것도 안 함');
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.c}/profile`, { segment: 'customer' });
    assert.deepEqual(await preset(N.c), { ai: undefined, credits: null });
    const [a] = await sql`select detail from audit_logs where action = 'platform.tenant_profile' and target_id = ${N.c} order by created_at desc limit 1`;
    assert.equal(a.detail.preset, 'lifted');
    const paid = await ctx.owner.ok('POST', '/api/platform/tenants', body(4, { segment: 'customer', planCode: N.paid }));
    await ctx.owner.ok('PUT', `/api/platform/tenants/${paid.tenant}/profile`, { segment: 'partner' });
    assert.deepEqual(await preset(paid.tenant), { ai: undefined, credits: undefined }, '유료 회사는 기본값 안 넣음');
    assert.equal((await ctx.staffA.client.req('PUT', `/api/platform/tenants/${N.c}/profile`, { segment: 'partner' })).status, 404, '운영자만');
  });
});
