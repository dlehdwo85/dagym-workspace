// #1171·#1173(대표 11/26 "영업 알림 14인데 메뉴는 7" · "마케팅도 어떤 숫자를 근거로 알림이 표시되는지 모르겠다"):
// 공간 전환 숫자 = 그 공간 사이드바 숫자들의 합(설정 경고는 점 — 합 밖) · 허브 = 안 본 오늘 공고(아침 공고 알림 묶음 수, '오늘 새 공고'를 열면 0)
// · 하위 화면 알림은 그 화면을 여는 메뉴 숫자로 · 마케팅 승인함 = 승인할 것(시안 + 운영 승인) · 숫자마다 설명(why)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

const MENU = {
  work: ['/tasks', '/projects', '/reports', '/approvals', '/revenue'],
  sales: ['/s/sales/hub', '/s/sales/leads', '/s/sales/deals', '/s/sales/support', '/s/sales/sources'],
  marketing: ['/s/marketing/goals', '/s/marketing/ops', '/s/marketing/team', '/s/marketing/approvals', '/s/marketing/automation', '/s/marketing/materials', '/s/marketing/calendar',
    '/s/marketing/connections', '/s/marketing/ads', '/s/marketing/ad-ops', '/s/marketing/sites', '/s/marketing/calls', '/s/marketing/history'],
};
let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  for (const space of ['sales', 'marketing']) await ctx.owner.ok('PUT', '/api/admin/spaces', { space, on: true }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const put = (link, extra = {}) => sql`insert into notifications (user_id, type, title, link, dedupe_key, space) values (${ctx.ownerId}, ${extra.type ?? 'usage_alert'}, ${extra.title ?? '시험 알림'}, ${link}, ${extra.key ?? `t1171:${Math.random()}`}, ${extra.space ?? null})`;
const poll = () => ctx.owner.ok('GET', '/api/notifications?unread=1');
/** 규칙 그 자체: 공간 숫자 = 메뉴 숫자(점 제외) 합 */
function sumOf(r, sp) { return MENU[sp].filter((a) => !r.dots.includes(a)).reduce((a, k) => a + (r.counts[k] ?? 0), 0); }

test('영업: 허브 = 안 본 오늘 공고 · 하위 화면 알림은 허브로 · 데이터 설정은 점(합 밖) · 공간 숫자 = 메뉴 합 · 열면 0', async () => {
  const today = seoulToday();
  await sql`delete from notifications where user_id = ${ctx.ownerId}`;
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified) values ('default', ${today}, '[]', ${sql.json({ total: 5 })}, 1, 1) on conflict (tenant, day) do update set counts = excluded.counts`;
  await put('/s/sales/hub?tab=bids&bt=today', { type: 'briefing', key: `salesdigest:default:${today}`, space: 'sales', title: '오늘 새 공고 5건' });
  await put('/s/sales/support?tab=fit', { space: 'sales' });
  await put('/s/sales/bids?id=1', { space: 'sales' }); // 하위 화면 → 허브
  await put('/s/sales/sources#collectors', { type: 'sales_collector_alert', space: 'sales' }); // 설정 경고
  await put('/s/sales/sources#collectors', { type: 'sales_collector_alert', space: 'sales' });
  let r = await poll();
  assert.equal(r.counts['/s/sales/hub'], 6, '안 본 오늘 공고 5 + 입찰 화면 알림 1');
  assert.equal(r.counts['/s/sales/support'], 1);
  assert.ok(r.dots.includes('/s/sales/sources'), '데이터 설정 = 점');
  assert.equal(r.sums.sales, 7, '허브 6 + 지원사업 1(데이터 설정 2는 뺌)');
  assert.equal(r.sums.sales, sumOf(r, 'sales'));
  assert.match(r.why['/s/sales/hub'], /안 본 오늘 공고 5건[\s\S]*안 읽은 알림 1건/);
  assert.match(r.why['/s/sales/sources'], /숫자 대신 점/);
  const sp = await ctx.owner.ok('GET', '/api/spaces');
  assert.equal(sp.summary.sales.badge, 7, '공간 전환 숫자(/api/spaces)도 같은 합');
  assert.equal(sp.summary.sales.text, '안 본 오늘 공고 5건');
  // '오늘 새 공고'를 열면 아침 공고 알림만 읽음 → 허브 1(입찰 화면 알림), 공간 2
  const rd = await ctx.owner.ok('POST', '/api/notifications/read', { salesDigest: true });
  assert.equal(rd.changed, 1);
  r = await poll();
  assert.equal(r.counts['/s/sales/hub'], 1); assert.equal(r.sums.sales, 2);
  assert.equal((await ctx.owner.ok('GET', '/api/spaces')).summary.sales.text, '오늘 공고 5건(모두 봄)');
});

test('마케팅: 승인함 = 승인할 것(시안 + 운영 승인) · 연결 계정·광고 집행은 점 · 업무: 결재·업무 메뉴만 합(공통 메뉴 밖)', async () => {
  await sql`delete from notifications where user_id = ${ctx.ownerId}`;
  await sql`insert into mkt_goals (tenant, month, status) values ('default', '2026-12', 'pending')`; // 운영 승인 1
  await put('/s/marketing/approvals', { space: 'marketing' });
  await put('/s/marketing/connections', { space: 'marketing' }); await put('/s/marketing/ad-ops#ad-watch', { space: 'marketing' }); await put('/s/marketing/report', { space: 'marketing' });
  await put('/s/marketing/calls', { space: 'marketing' });
  await put('/tasks/00000000-0000-0000-0000-000000000001'); await put('/branch-reports?x=1'); await put('/calendar?event=1'); await put('/library');
  const r = await poll();
  assert.ok(r.counts['/s/marketing/approvals'] >= 1);
  assert.match(r.why['/s/marketing/approvals'], /승인할 것 \d+건\(승인 대기 시안 \d+ · 운영 승인 \d+\)/);
  for (const a of ['/s/marketing/connections', '/s/marketing/ad-ops', '/s/marketing/ads']) assert.ok(r.dots.includes(a), `${a} = 점`);
  assert.equal(r.sums.marketing, r.counts['/s/marketing/approvals'] + 1, '승인함 + 전화 문의 1(점 화면 제외)');
  assert.equal(r.sums.marketing, sumOf(r, 'marketing'));
  assert.equal(r.counts['/reports'], 1, '지점 보고 알림은 보고 메뉴로');
  assert.equal(r.sums.work, sumOf(r, 'work'));
  assert.equal(r.sums.work, (r.counts['/tasks'] ?? 0) + (r.counts['/reports'] ?? 0) + (r.counts['/approvals'] ?? 0) + (r.counts['/projects'] ?? 0) + (r.counts['/revenue'] ?? 0));
  assert.ok(r.counts['/calendar'] === 1 && r.counts['/library'] === 1, '공통 메뉴 숫자는 그대로 보이지만 공간 합 밖');
  const sp = await ctx.owner.ok('GET', '/api/spaces');
  assert.equal(sp.summary.marketing.badge, r.sums.marketing); assert.equal(sp.summary.work.badge, r.sums.work);
});
