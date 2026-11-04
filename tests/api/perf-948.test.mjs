// #948(대표 11/04 '앱·웹 속도 정기 검침'): ① 정기 실행이 핵심 API 7곳을 자기 주소로 불러 응답 시간 기록(검침 세션은 끝나면 지움)
// ② 실제 화면 비콘(웹·앱 첫 표시·목록 표시) → 하루 히스토그램 p75 ③ 기준(API 1.5초·화면 3초) 2번 연속 초과 → 플랫폼 운영자 알림 하루 1번
// ④ 플랫폼 운영 › 속도(느린 곳 상위·7일·최근 알림, 슈퍼관리자만) ⑤ 주간 요약 메일 1통(같은 주 두 번 안 보냄) — 구조 시험(실제 운영 응답 시간은 운영에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const RESEND_PORT = 3288;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date()); const yday = kst(new Date(Date.now() - 864e5));
let srv, ctx, sql, fake; const resent = [];
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const beacon = (body, cookie = ctx.owner.cookie) => fetch(`${BASE}/api/public/perf`, { method: 'POST', headers: { 'content-type': 'text/plain', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const hist = (bucket, n) => { const h = Array(16).fill(0); h[bucket] = n; return h; };

before(async () => {
  fake = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { resent.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `re_${resent.length}` })); }); }).listen(RESEND_PORT);
  await resetDb(); sql = testDb();
  srv = await startServer({ PERF_PROBE: 'any', PERF_WEEKLY: 'any', RESEND_API_KEY: 're_test_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${RESEND_PORT}` });
  ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await sql`update tenants set spaces = array['work','sales','marketing'] where id = 'default'`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('① 정기 검침: 핵심 API 7곳 응답 시간 기록 · 로그인 필요한 곳은 검침 세션으로(끝나면 지움) · 주간 요약 메일 1통', async () => {
  const d = await tick();
  const p = d.perfProbe; assert.ok(p?.results?.length === 7, JSON.stringify(p));
  for (const r of p.results) assert.ok(Number.isInteger(r.ms) && r.ms >= 0, JSON.stringify(r));
  for (const k of ['health', 'login', 'tasks', 'hub', 'bids', 'approvals', 'messages']) assert.equal(p.results.find((r) => r.key === k)?.ok, true, `${k} 200~399`);
  assert.equal((await sql`select count(*)::int as n from perf_probes`)[0].n, 7);
  assert.equal((await sql`select count(*)::int as n from sessions where user_agent = 'WorkInPerfProbe/1'`)[0].n, 0, '검침 세션은 지움');
  assert.deepEqual([d.perfWeekly?.mailed, d.perfWeekly?.recipients], [1, 1], JSON.stringify(d.perfWeekly));
  const m = resent.find((x) => x.to.includes('ceo@dagym.test')); assert.ok(m, '슈퍼관리자에게 메일');
  assert.match(m.subject, /^\[워크인\] 주간 속도 요약 \d{1,2}\/\d{1,2}~\d{1,2}\/\d{1,2} — 느린 곳 \d곳$/);
  assert.ok(m.text.includes('업무 목록(열린 업무)') && m.html.includes('영업기회 허브 › 시설') && m.html.includes('/platform?tab=speed'), '메일 본문: 7곳 이름·속도 칸 링크');
  const d2 = await tick(); assert.equal(d2.perfWeekly?.skipped, 'sent', '같은 주 두 번 안 보냄');
  assert.equal(resent.filter((x) => /주간 속도 요약/.test(x.subject)).length, 1);
});

test('② 실제 화면 비콘: 웹·앱 첫 표시·목록 표시 → 하루 히스토그램 p75 · 화면 이름 검사 · 비콘은 사람·회사 값 없이', async () => {
  for (let i = 0; i < 8; i++) assert.equal((await beacon({ c: 'web', items: [{ s: '/tasks', f: 400 + i * 100, l: 900 + i * 100 }] })).status, 200);
  assert.equal((await beacon({ c: 'app', items: [{ s: '/tasks', f: 2500 }, { s: '/calendar', l: 6000 }] })).status, 200);
  assert.equal((await beacon({ c: 'web', items: [{ s: 'tasks' }] })).status, 400, '화면 이름은 / 로 시작');
  assert.equal((await beacon({ c: 'web', items: [{ s: '/tasks?x=<script>' }] })).status, 400, '허용 글자만');
  assert.equal((await beacon({ c: 'pc', items: [{ s: '/tasks', f: 1 }] })).status, 400, 'web·app 만');
  const anon = await (await beacon({ c: 'web', items: [{ s: '/tasks', f: 99999 }] }, '')).json();
  assert.deepEqual([anon.ok, anon.n], [false, 0], '로그인 안 한 요청은 안 셈');
  const rows = await sql`select client, screen, metric, n, max_ms from perf_screens where day = ${today}::date order by client, screen, metric`;
  assert.deepEqual(rows.map((r) => `${r.client} ${r.screen} ${r.metric} ${r.n} ${r.max_ms}`), ['app /calendar list 1 6000', 'app /tasks first 1 2500', 'web /tasks first 8 1100', 'web /tasks list 8 1600']);
  const ov = await ctx.owner.ok('GET', '/api/platform/perf');
  const web = ov.screens.find((s) => s.client === 'web' && s.screen === '/tasks');
  assert.ok(web.first.p75 >= 750 && web.first.p75 <= 1100 && web.list.p75 >= 1000 && web.list.p75 <= 1600, JSON.stringify(web));
  assert.equal(web.n, 8);
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/perf')).status, 404, '슈퍼관리자 아니면 없는 줄');
});

test('③ 기준 초과 2번 연속 → 플랫폼 운영자 알림 하루 1번 · 화면은 오늘·어제 p75 둘 다 넘을 때', async () => {
  // 허브 검침 2번 연속 4초(미래 시각으로 넣어 다음 검침보다 뒤에 오게) · 화면: 웹 /s/sales/hub 첫 표시 오늘·어제 p75 4~5초
  await sql`insert into perf_probes (at, round, target, ms, status, ok) values (now() + interval '1 minute', 1, 'hub', 4000, 200, true), (now() + interval '2 minutes', 2, 'hub', 4200, 200, true)`;
  await sql`insert into perf_probes (at, round, target, ms, status, ok) values (now() + interval '1 minute', 1, 'bids', 4000, 200, true), (now() + interval '2 minutes', 2, 'bids', 300, 200, true)`; // 1번만 느림 → 알림 없음
  await sql`insert into perf_screens (day, client, screen, metric, n, sum_ms, max_ms, h) values (${today}::date, 'web', '/s/sales/hub', 'first', 10, 45000, 5000, ${hist(9, 10)}::int[]), (${yday}::date, 'web', '/s/sales/hub', 'first', 10, 45000, 5000, ${hist(9, 10)}::int[])`;
  await sql`insert into perf_screens (day, client, screen, metric, n, sum_ms, max_ms, h) values (${today}::date, 'app', '/s/sales/hub', 'first', 10, 45000, 5000, ${hist(9, 10)}::int[])`; // 어제 없음 → 알림 없음
  const d = await tick();
  assert.deepEqual(d.perfProbe?.alerts?.keys, ['hub', 'web:/s/sales/hub'], JSON.stringify(d.perfProbe?.alerts));
  const n = await sql`select title, body from notifications where user_id = ${ctx.ownerId} and type = 'perf_alert' and title like '%기준 초과%' order by created_at`;
  assert.equal(n.length, 2, JSON.stringify(n));
  assert.match(n[0].title, /^속도 기준 초과: 영업기회 허브 › 시설 — 4\.2초 · 4\.0초 \(2번 연속\)$/);
  assert.match(n[1].title, /^화면 속도 기준 초과: 웹 \/s\/sales\/hub 첫 표시 — 오늘 p75 3\.8초 · 어제 3\.8초$/); // 3~4초 칸 10건 → 칸 안 보간 3,750ms
  await tick(); // 같은 날 두 번 안 보냄
  assert.equal((await sql`select count(*)::int as c from notifications where user_id = ${ctx.ownerId} and type = 'perf_alert' and title like '%기준 초과%'`)[0].c, 2);
  const staff = await sql`select count(*)::int as c from notifications where user_id = ${ctx.staffA.id} and type = 'perf_alert'`; assert.equal(staff[0].c, 0, '직원에게는 안 감');
});

test('④ 플랫폼 운영 › 속도: 느린 곳 상위(기준 대비)·7일 날짜별·마지막 검침·최근 알림 · 알림 설정 목록에 플랫폼 운영자만', async () => {
  const ov = await ctx.owner.ok('GET', '/api/platform/perf');
  assert.deepEqual([ov.days.length, ov.thresholds.api, ov.thresholds.screen, ov.targets.length], [7, 1500, 3000, 7]);
  assert.equal(ov.days[6], today);
  const hub = ov.targets.find((t) => t.key === 'hub');
  assert.ok(hub.week.p75 >= 1500 && hub.week.n >= 5 && hub.last.ms === 4200 && hub.byDay[6]?.n >= 5, JSON.stringify(hub));
  assert.ok(ov.slowTop.length >= 2 && ov.slowTop.length <= 5 && ov.slowTop[0].ratio > 1, JSON.stringify(ov.slowTop));
  assert.ok(ov.slowTop.some((s) => s.kind === 'api' && /영업기회 허브/.test(s.label)) && ov.slowTop.some((s) => s.kind === 'screen' && s.label === '웹 /s/sales/hub'));
  assert.ok(ov.alerts.length >= 2 && ov.alerts.every((a) => a.title && a.at), JSON.stringify(ov.alerts));
  assert.ok(ov.probe.lastAt && ov.probe.everyMinutes === 30 && ov.probe.on === true);
  const prefs = await ctx.owner.ok('GET', '/api/notifications/prefs'); assert.ok(prefs.types.some((t) => t.type === 'perf_alert'));
  const sp = await ctx.staffA.client.ok('GET', '/api/notifications/prefs'); assert.ok(!sp.types.some((t) => t.type === 'perf_alert'), '직원 알림 설정에는 없음');
});
