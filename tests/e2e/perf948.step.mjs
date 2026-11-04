// #948(대표 11/04): 속도 — ⓐ 로그인한 화면을 열면 비콘이 첫 표시·목록 표시 시간을 /api/public/perf 로 보냄(사람·회사 값 없음)
// ⓑ 플랫폼 운영 › 속도 탭: 느린 곳 상위 5 · 핵심 API 7곳 7일 막대 · 실제 화면 표(웹·앱) · 최근 알림
import assert from 'node:assert/strict';

export async function perf948({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  // 검침 7일치·화면 기록 시드(시험 서버는 정기 검침 꺼짐)
  const targets = ['health', 'login', 'tasks', 'hub', 'bids', 'approvals', 'messages'];
  for (let d = 6; d >= 0; d--) for (let r = 0; r < 4; r++) for (const [i, t] of targets.entries()) {
    const ms = t === 'hub' ? 1800 + r * 200 + d * 30 : 150 + i * 60 + r * 20;
    await sql`insert into perf_probes (at, round, target, ms, status, ok) values (now() - make_interval(days => ${d}, hours => ${r * 5}), ${d * 10 + r}, ${t}, ${ms}, 200, true)`;
  }
  const h = (b, n) => { const a = Array(16).fill(0); a[b] = n; return a; };
  await sql`insert into perf_screens (day, client, screen, metric, n, sum_ms, max_ms, h) values
    ((now() at time zone 'Asia/Seoul')::date, 'web', '/calendar', 'first', 12, 9600, 1200, ${h(5, 12)}::int[]),
    ((now() at time zone 'Asia/Seoul')::date, 'app', '/s/sales/hub', 'list', 6, 27000, 5000, ${h(9, 6)}::int[])
    on conflict (day, client, screen, metric) do update set n = excluded.n, sum_ms = excluded.sum_ms, max_ms = excluded.max_ms, h = excluded.h`; // 357차: 전체 E2E 에서는 앞 단계 화면이 보낸 비콘이 오늘 /calendar 줄을 이미 만듦
  // ⓐ 비콘: 업무 화면을 열고 한 번 누르면(LCP 확정) 3초 안에 보냄 — sendBeacon 본문(Blob)은 Playwright 가 못 읽는 때가 있어 저장된 줄로 확인
  const sent = [];
  owner.on('request', (r) => { if (r.url().includes('/api/public/perf') && r.method() === 'POST') sent.push(r.postDataBuffer()?.toString() ?? ''); });
  await owner.goto(`${BASE}/tasks`);
  await owner.waitForLoadState('networkidle').catch(() => {});
  await owner.mouse.click(5, 5);
  await owner.waitForRequest((r) => r.url().includes('/api/public/perf') && r.method() === 'POST', { timeout: 25000 });
  let rows = [];
  for (let i = 0; i < 20 && !rows.length; i++) { await owner.waitForTimeout(300); rows = await sql`select client, metric, n from perf_screens where screen = '/tasks' order by metric`; }
  assert.ok(rows.length >= 1 && rows.every((r) => r.client === 'web' && r.n >= 1), JSON.stringify(rows));
  const body = sent.find((b) => b && b.startsWith('{'));
  if (body) { const j = JSON.parse(body); assert.equal(j.c, 'web'); assert.ok(!body.includes(ctx.ownerId) && !body.includes('@'), '사람 값 없음'); }
  // ⓑ 속도 탭
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/platform?tab=speed`);
  await owner.getByTestId('platform-speed').waitFor();
  assert.equal(await owner.getByTestId('platform-tab-speed').getAttribute('aria-selected'), 'true');
  assert.match(await owner.getByTestId('platform-tab-desc').innerText(), /30분마다 검침/);
  const top = owner.getByTestId('speed-top');
  assert.ok((await top.getByTestId('speed-top-row').count()) >= 2 && (await top.getByTestId('speed-top-row').count()) <= 5);
  assert.match(await top.getByTestId('speed-top-row').first().innerText(), /영업기회 허브 › 시설|앱 \/s\/sales\/hub/);
  assert.match(await owner.getByTestId('speed-target-hub').innerText(), /2\.\d초/);
  assert.equal(await owner.getByTestId('speed-targets').locator('svg[role="img"]').count(), 7, '7곳 막대');
  assert.ok((await owner.getByTestId('speed-screen-row').count()) >= 3, '실제 화면 표(웹 /calendar · 앱 허브 · 방금 보낸 /tasks)');
  await owner.screenshot({ path: `${SHOTS}/948-platform-speed.png`, fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.reload(); await owner.getByTestId('platform-speed').waitFor();
  assert.ok((await owner.evaluate(() => document.documentElement.scrollWidth)) <= 392, '휴대폰 폭 가로 넘침 없음');
  await owner.screenshot({ path: `${SHOTS}/948-platform-speed-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
