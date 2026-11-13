// 410차 범용화 P2 문구 ①(docs/generalization-audit.md G-23·G-25·G-27·G-28 — G-20·G-36 은 화면 글이라 용어 사전 시험 terms-1026 에서):
// 다짐(기본 회사)은 지금 글 그대로, 다른 회사만 공통 글.
// · G-23 QR 신고 공개 화면 머리글: 브랜드 없는 조직 — 다른 회사는 회사 이름(예전엔 '다짐 · 하이링크')
// · G-25 일정 준비 업무 묶음: 다른 회사는 'GX 개강' 없음·'현장' 낱말 없음
// · G-27 메일 양식 '용역비 청구' → 다른 회사 '대금 청구'
// · G-28 예시 결재선 '팀장 → 본부장 → 대표' → 다른 회사 '팀장 → 부서장 → 대표'(대표는 그 회사 이름)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@other-copy.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-copy.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '모퉁이카페', industry: '외식·카페', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, tenant: me.user.tenant, unit: (await c.ok('GET', '/api/admin/org-units')).units[0].id };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('410차 P2 문구 ①', () => {
  test('G-25 일정 준비 업무 묶음: 다짐은 GX 개강 포함 4개 그대로 · 다른 회사는 3개(GX 개강·현장 낱말 없음) · 없는 묶음으로 만들기는 400', async () => {
    const d = (await ctx.owner.ok('GET', '/api/events/x/prep')).presets;
    assert.deepEqual(d.map((p) => [p.id, p.label]), [['gx_open', 'GX 개강'], ['site_inspection', '현장 점검'], ['contract_meeting', '계약 미팅'], ['event_promo', '행사·프로모션']]);
    assert.deepEqual(d[3].items.map((x) => x.title), ['홍보물 제작', 'SNS·문자 공지', '현장 준비물 확인']);
    const o = (await T.c.ok('GET', '/api/events/x/prep')).presets;
    assert.deepEqual(o.map((p) => [p.id, p.label]), [['site_inspection', '방문 점검'], ['contract_meeting', '계약 미팅'], ['event_promo', '행사·프로모션']]);
    assert.ok(!/GX|현장|회원|강사/.test(JSON.stringify(o)), JSON.stringify(o));
    // 다른 회사가 gx_open 으로 만들려 하면 묶음이 없는 것으로
    const cals = (await T.c.ok('GET', '/api/calendars')).calendars; const cal = cals.find((x) => x.type === 'company') ?? cals[0];
    const ev = await T.c.ok('POST', '/api/events', { calendarId: cal.id, title: '오픈 행사', start: '2027-01-20T10:00:00+09:00', end: '2027-01-20T11:00:00+09:00' });
    assert.equal((await T.c.req('POST', `/api/events/${ev.id}/prep`, { preset: 'gx_open' })).status, 400);
    const made = await T.c.ok('POST', `/api/events/${ev.id}/prep`, { preset: 'event_promo' });
    assert.ok(made);
    const prep = (await sql`select title from tasks where title like '%준비물 확인%'`).map((x) => x.title);
    assert.equal(prep.length, 1, JSON.stringify(prep)); assert.ok(!prep[0].includes('현장'), prep[0]);
  });

  test('G-28 예시 결재선: 다짐 = 팀장 → 본부장 → 대표 그대로 · 다른 회사 = 팀장 → 부서장 → 대표', async () => {
    const d = await ctx.owner.ok('POST', '/api/approval-lines/templates', { preset: 'three' });
    const [dl] = await sql`select name, steps from approval_lines where id = ${d.id}`;
    assert.equal(dl.name, '3단계(팀장 → 본부장 → 대표)'); assert.deepEqual(dl.steps.map((s) => s.label), ['팀장', '본부장', '대표']);
    const o = await T.c.ok('POST', '/api/approval-lines/templates', { preset: 'three' });
    const [ol] = await sql`select name, steps, tenant from approval_lines where id = ${o.id}`;
    assert.equal(ol.name, '3단계(팀장 → 부서장 → 대표)'); assert.deepEqual(ol.steps.map((s) => [s.label, s.type, s.up ?? null]), [['팀장', 'lead', 0], ['부서장', 'lead', 1], ['대표', 'role', null]]);
    assert.equal(ol.tenant, T.tenant);
    const l3 = await T.c.ok('POST', '/api/approval-lines/templates', { preset: 'leave3' });
    assert.equal((await sql`select name from approval_lines where id = ${l3.id}`)[0].name, '휴가(팀장, 3일 이상 대표)');
    // 회사가 대표 이름을 바꾸면 예시 결재선도 그 이름으로
    await T.c.ok('PUT', '/api/org/terms', { role: { owner: '원장' } });
    const o2 = await T.c.ok('POST', '/api/approval-lines/templates', { preset: 'two' });
    assert.equal((await sql`select name from approval_lines where id = ${o2.id}`)[0].name, '2단계(팀장 → 원장)');
    await T.c.ok('PUT', '/api/org/terms', { role: {} });
  });

  test('G-27 메일 양식: 다짐은 "용역비 청구" 그대로 · 다른 회사는 "대금 청구"', async () => {
    const dt = await ctx.owner.ok('POST', '/api/tasks', { title: '청구 메일 보내기', orgUnitId: ctx.siteA });
    const dk = (await ctx.owner.ok('GET', `/api/tasks/${dt.id}/mail`)).kinds.find((k) => k.key === 'invoice');
    assert.deepEqual([dk.label, dk.subject], ['용역비 청구', '용역비 청구의 건']); assert.ok(dk.body.includes('용역비 청구서'));
    const ot = await T.c.ok('POST', '/api/tasks', { title: '청구 메일 보내기', orgUnitId: T.unit });
    const kinds = (await T.c.ok('GET', `/api/tasks/${ot.id}/mail`)).kinds;
    const ok = kinds.find((k) => k.key === 'invoice');
    assert.deepEqual([ok.label, ok.subject], ['대금 청구', '대금 청구의 건']); assert.ok(!JSON.stringify(kinds).includes('용역'));
    assert.deepEqual(kinds.map((k) => k.key), ['quote', 'proposal', 'official', 'invoice', 'material'], '양식 종류·순서는 같음');
  });

  test('G-23 QR 신고 공개 화면 머리글: 브랜드 없는 조직 — 다른 회사는 회사 이름, 다짐은 화면 기본값(없음 → 다짐 · 하이링크) · 브랜드 있는 조직은 브랜드 그대로', async () => {
    const anon = new Client('anon');
    const of = await T.c.ok('POST', '/api/forms', { orgUnitId: T.unit, kind: 'facility' });
    const otok = (await T.c.ok('GET', '/api/forms')).forms.find((f) => f.id === of.id).token;
    assert.equal((await anon.ok('GET', `/api/public/forms/${otok}`)).brand, '모퉁이카페');
    const df = await ctx.owner.ok('POST', '/api/forms', { orgUnitId: ctx.siteA, kind: 'facility' });
    const dtok = (await ctx.owner.ok('GET', '/api/forms')).forms.find((f) => f.id === df.id).token;
    const dinfo = await anon.ok('GET', `/api/public/forms/${dtok}`);
    assert.ok(dinfo.brand === null || typeof dinfo.brand === 'string'); assert.notEqual(dinfo.brand, '모퉁이카페');
    const hq = await ctx.owner.ok('POST', '/api/forms', { orgUnitId: ctx.hq, kind: 'supply' }).catch(() => null);
    if (hq) { const htok = (await ctx.owner.ok('GET', '/api/forms')).forms.find((f) => f.id === hq.id).token; assert.equal((await anon.ok('GET', `/api/public/forms/${htok}`)).brand, null, '다짐의 브랜드 없는 조직 = 없음(화면 기본값 다짐 · 하이링크)'); }
  });
});
