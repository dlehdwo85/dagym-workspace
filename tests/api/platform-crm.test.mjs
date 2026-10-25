// #656 플랫폼 관리 › 고객사 관리 확장(대표 10/26 00:40): 담당자·구분·소개 경로, 단계(체험/유료/보류/해지), 연락 기록(다음 연락일), 할인(다음 결제부터), 목록 내보내기
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE, seoulToday, addDays } from '../helpers.mjs';

let srv, sql, ctx;
const N = {};

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#656 고객사 관리 확장', () => {
  test('[고객사 추가]에 담당자·연락처·직책·구분(설계 파트너)·소개 경로 → 목록에 담당자·구분·단계(체험 자동)·초대 대기, 운영자만', async () => {
    const body = { company: '파트너체험단', industries: ['운동·피트니스'], size: '2-10', ownerName: '박대표', ownerEmail: 'partner@cust.test', trialDays: 30,
      contactName: '김담당', contactPhone: '010-1234-5678', contactTitle: '실장', segment: 'partner', source: '하이링크 고객' };
    assert.equal((await ctx.staffA.client.req('POST', '/api/platform/tenants', body)).status, 404, '플랫폼 운영자만');
    const r = await ctx.owner.ok('POST', '/api/platform/tenants', body);
    N.tenant = r.tenant;
    const [t] = await sql`select contact_name, contact_phone, contact_title, segment, source, lifecycle from tenants where id = ${r.tenant}`;
    assert.deepEqual([t.contact_name, t.contact_phone, t.contact_title, t.segment, t.source, t.lifecycle], ['김담당', '010-1234-5678', '실장', 'partner', '하이링크 고객', null]);
    const list = await ctx.owner.ok('GET', '/api/platform/tenants?q=파트너체험단');
    const row = list.tenants.find((x) => x.id === r.tenant);
    assert.deepEqual([row.contact_name, row.contact_phone, row.segment, row.stage, row.owner_invited, row.active7, row.next_contact_at], ['김담당', '010-1234-5678', 'partner', 'trial', true, 0, null]);
    // 구분 필터: 파트너만 / 일반만
    assert.ok((await ctx.owner.ok('GET', '/api/platform/tenants?segment=partner')).tenants.every((x) => x.segment === 'partner'));
    assert.ok(!(await ctx.owner.ok('GET', '/api/platform/tenants?segment=customer')).tenants.some((x) => x.id === r.tenant), '일반 필터에는 파트너가 없음');
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${r.tenant}/detail`);
    assert.deepEqual([d.stage, d.contacts, d.tenant.contact_phone], ['trial', [], '010-1234-5678']);
    // 새 API 들도 운영자만(다른 회사 사람은 404)
    for (const [m, p, b] of [['PUT', `/api/platform/tenants/${r.tenant}/profile`, { contactName: 'x' }], ['PUT', `/api/platform/tenants/${r.tenant}/lifecycle`, { stage: 'hold' }],
      ['POST', `/api/platform/tenants/${r.tenant}/contacts`, { summary: 'x' }], ['PUT', `/api/platform/tenants/${r.tenant}/discount`, { pct: 10 }], ['GET', '/api/platform/tenants/export', undefined]]) {
      assert.equal((await ctx.staffA.client.req(m, p, b)).status, 404, `${m} ${p} 운영자만`);
    }
  });

  test('담당자·구분·소개 경로 고치기(보낸 칸만) → 감사 기록에는 연락처 값 없음', async () => {
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/profile`, { contactPhone: '010-9999-0000', segment: 'customer' });
    const [t] = await sql`select contact_name, contact_phone, contact_title, segment, source from tenants where id = ${N.tenant}`;
    assert.deepEqual([t.contact_name, t.contact_phone, t.contact_title, t.segment, t.source], ['김담당', '010-9999-0000', '실장', 'customer', '하이링크 고객'], '안 보낸 칸은 그대로');
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/profile`, { contactTitle: null, source: '  ' });
    const [t2] = await sql`select contact_title, source from tenants where id = ${N.tenant}`;
    assert.deepEqual([t2.contact_title, t2.source], [null, null], 'null·빈칸은 지움');
    const [a] = await sql`select detail from audit_logs where action = 'platform.tenant_profile' and target_id = ${N.tenant} order by created_at desc limit 1`;
    assert.ok(!JSON.stringify(a.detail).includes('010-9999'), '감사 기록에 전화번호 없음');
    assert.equal((await ctx.owner.req('PUT', `/api/platform/tenants/${N.tenant}/profile`, { segment: 'vip' })).status, 400, '없는 구분');
    assert.equal((await ctx.owner.req('PUT', '/api/platform/tenants/nope/profile', { contactName: 'x' })).status, 404);
  });

  test('단계: 체험(자동) → 보류(직접·사유) → 목록 단계 필터·감사 → 자동으로 되돌리기 / 정지하면 자동 해지', async () => {
    const r = await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/lifecycle`, { stage: 'hold', note: '11월 결제 협의 중' });
    assert.equal(r.stage, 'hold');
    const row = (await ctx.owner.ok('GET', '/api/platform/tenants?stage=hold')).tenants.find((x) => x.id === N.tenant);
    assert.deepEqual([row?.stage, row?.lifecycle, row?.lifecycle_note], ['hold', 'hold', '11월 결제 협의 중']);
    assert.ok(!(await ctx.owner.ok('GET', '/api/platform/tenants?stage=trial')).tenants.some((x) => x.id === N.tenant), '체험 필터에는 없음');
    assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/detail`)).stage, 'hold');
    assert.equal((await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/lifecycle`, { stage: null })).stage, 'trial', 'null = 구독 상태에서 자동');
    const [t] = await sql`select lifecycle, lifecycle_note, lifecycle_at from tenants where id = ${N.tenant}`;
    assert.deepEqual([t.lifecycle, t.lifecycle_note, t.lifecycle_at], [null, null, null]);
    assert.equal((await ctx.owner.req('PUT', `/api/platform/tenants/${N.tenant}/lifecycle`, { stage: 'gone' })).status, 400);
    const acts = (await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/audit`)).logs.map((l) => l.action);
    assert.ok(acts.includes('platform.tenant_lifecycle'));
    // 정지한 회사는 자동으로 '해지'
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/status`, { status: 'blocked' });
    assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/detail`)).stage, 'churned');
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/status`, { status: 'active' });
    assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/detail`)).stage, 'trial');
  });

  test('연락 기록: 전화·미팅(다음 연락일) 남기기 → 목록 다음 연락·마지막 연락·오늘까지 연락할 곳 → 지우기', async () => {
    const today = seoulToday();
    const a = await ctx.owner.ok('POST', `/api/platform/tenants/${N.tenant}/contacts`, { kind: 'call', summary: '대표와 통화 — 데모 약속', nextAt: addDays(today, 3) });
    const b = await ctx.owner.ok('POST', `/api/platform/tenants/${N.tenant}/contacts`, { kind: 'meeting', summary: '사무실 방문 미팅', nextAt: addDays(today, -1), at: new Date(Date.now() - 86400000).toISOString() });
    assert.ok(a.id && b.id);
    const logs = (await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/contacts`)).logs;
    assert.deepEqual(logs.map((l) => [l.kind, l.summary, l.next_at]), [['call', '대표와 통화 — 데모 약속', addDays(today, 3)], ['meeting', '사무실 방문 미팅', addDays(today, -1)]], '최근 것부터');
    assert.equal(logs[0].by_name, (await ctx.owner.ok('GET', '/api/auth/me')).user.name);
    const row = (await ctx.owner.ok('GET', '/api/platform/tenants?q=파트너체험단')).tenants.find((x) => x.id === N.tenant);
    assert.equal(row.next_contact_at, addDays(today, 3), '다음 연락 = 가장 최근 기록의 예정일');
    assert.ok(row.last_contact_at);
    assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/detail`)).contacts.length, 2);
    // 오늘까지 연락할 곳: 가장 최근 기록의 예정일이 오늘 이전이면 센다
    await ctx.owner.ok('POST', `/api/platform/tenants/${N.tenant}/contacts`, { kind: 'memo', summary: '오늘 다시 전화', nextAt: today });
    assert.ok((await ctx.owner.ok('GET', '/api/platform/tenants')).summary.contactDue >= 1);
    assert.ok((await ctx.owner.ok('GET', '/api/platform/today')).contactDue >= 1, "'오늘 볼 것'에도");
    assert.equal((await ctx.owner.req('POST', `/api/platform/tenants/${N.tenant}/contacts`, { kind: 'fax', summary: 'x' })).status, 400, '없는 종류');
    assert.equal((await ctx.owner.req('POST', `/api/platform/tenants/${N.tenant}/contacts`, { kind: 'call', summary: '' })).status, 400, '내용 없음');
    assert.equal((await ctx.owner.req('POST', `/api/platform/tenants/${N.tenant}/contacts`, { kind: 'call', summary: 'x', nextAt: '2026/11/01' })).status, 400, '날짜 형식');
    await ctx.owner.ok('DELETE', `/api/platform/tenants/${N.tenant}/contacts/${b.id}`);
    assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/contacts`)).logs.length, 2);
    assert.equal((await ctx.owner.req('DELETE', `/api/platform/tenants/${N.tenant}/contacts/${b.id}`)).status, 404, '이미 지움');
    assert.equal((await ctx.owner.req('DELETE', `/api/platform/tenants/${N.tenant}/contacts/not-a-uuid`)).status, 404);
    assert.equal((await ctx.owner.req('DELETE', `/api/platform/tenants/default/contacts/${a.id}`)).status, 404, '다른 회사 id 로는 못 지움');
  });

  test('할인: 20%·기한 → 다음 결제 견적(quote)에 반영, 기한 지나면 미적용, 0 이면 해제, 기본 회사 불가', async () => {
    const today = seoulToday();
    const [plan] = await sql`select code, monthly_krw, per_user_krw, min_users from plans where public and active and code not in ('trial', 'free', 'team_free', 'w_free') order by sort limit 1`;
    assert.ok(plan, '결제 가능한 요금제가 있어야 함');
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/discount`, { pct: 20, until: addDays(today, 30), note: '설계 파트너 1개월' });
    // 정기 결제 중인 것처럼 — 상세 '다음 결제' 금액이 견적(할인 반영)으로 나온다
    await sql`update tenant_subscriptions set plan_code = ${plan.code}, status = 'active', billing_cycle = 'monthly', billing_amount = 999999 where tenant = ${N.tenant}`;
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/detail`);
    const [{ n }] = await sql`select count(*)::int n from users where tenant = ${N.tenant} and status = 'active'`;
    const seats = plan.per_user_krw ? Math.max(plan.min_users ?? 1, Number(n)) : 1;
    const list = Math.round((plan.per_user_krw ?? plan.monthly_krw) * seats);
    assert.equal(d.billing.expectedThisMonth, Math.round(Math.round(list * 0.8) * 1.1), '공급가 20% 할인 × VAT');
    assert.deepEqual([d.billing.discount_pct, d.billing.discount_until, d.billing.discountApplied], [20, addDays(today, 30), 20]);
    const row = (await ctx.owner.ok('GET', '/api/platform/tenants?q=파트너체험단')).tenants.find((x) => x.id === N.tenant);
    assert.deepEqual([row.discount_pct, row.discount_until, row.stage], [20, addDays(today, 30), 'paid']);
    // 기한이 지난 할인은 적용되지 않는다
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/discount`, { pct: 20, until: addDays(today, -1) });
    const d2 = await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/detail`);
    assert.deepEqual([d2.billing.expectedThisMonth, d2.billing.discountApplied], [Math.round(list * 1.1), 0]);
    await ctx.owner.ok('PUT', `/api/platform/tenants/${N.tenant}/discount`, { pct: 0 });
    const [s] = await sql`select discount_pct, discount_until, discount_note from tenant_subscriptions where tenant = ${N.tenant}`;
    assert.deepEqual([s.discount_pct, s.discount_until, s.discount_note], [0, null, null], '0 이면 기한·사유도 지움');
    assert.equal((await ctx.owner.req('PUT', `/api/platform/tenants/${N.tenant}/discount`, { pct: 101 })).status, 400);
    assert.equal((await ctx.owner.req('PUT', '/api/platform/tenants/default/discount', { pct: 10 })).status, 400, '기본 회사 불가');
    assert.ok((await ctx.owner.ok('GET', `/api/platform/tenants/${N.tenant}/audit`)).logs.some((l) => l.action === 'platform.tenant_discount'));
  });

  test('목록 내보내기: 엑셀(기본)·CSV(UTF-8 BOM, 같은 필터) + 감사 기록, 운영자만', async () => {
    const x = await fetch(`${BASE}/api/platform/tenants/export?q=${encodeURIComponent('파트너체험단')}`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200);
    assert.match(x.headers.get('content-type') ?? '', /spreadsheetml/);
    assert.match(decodeURIComponent(x.headers.get('content-disposition') ?? ''), /고객사목록_\d{4}-\d{2}-\d{2}\.xlsx/);
    const buf = Buffer.from(await x.arrayBuffer());
    assert.equal(buf.subarray(0, 2).toString(), 'PK', 'xlsx(zip)');
    const c = await fetch(`${BASE}/api/platform/tenants/export?format=csv&segment=customer`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(c.status, 200);
    assert.match(c.headers.get('content-type') ?? '', /text\/csv/);
    const raw = Buffer.from(await c.arrayBuffer()); // text() 는 BOM 을 떼고 주므로 바이트로 확인
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], '엑셀용 UTF-8 BOM');
    const text = raw.subarray(3).toString('utf8');
    assert.ok(text.startsWith('회사,id,구분,단계,'), '머리줄');
    const lines = text.split('\r\n');
    const mine = lines.find((l) => l.includes('파트너체험단'));
    assert.ok(mine, '파트너체험단 줄 있음');
    assert.ok(mine.includes('일반') && mine.includes('김담당') && mine.includes('010-9999-0000'), `담당자·연락처 포함: ${mine}`);
    assert.ok(!lines.some((l) => l.includes('기본 회사') && l.includes('설계 파트너')), '필터(segment=customer)가 적용됨');
    const [a] = await sql`select detail from audit_logs where action = 'platform.tenant_export' order by created_at desc limit 1`;
    assert.equal(a.detail.format, 'csv');
  });
});
