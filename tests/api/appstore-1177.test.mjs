// #1177 App Store 단추 자동 켜기 + 심사 승인·반려 알림 + /app 안내:
// ① 환경 변수가 없으면 애플 공개 조회(가짜 서버)로 주소를 찾음 — 없으면 '아이폰 앱은 준비 중'(홈 화면에 추가 안내), 올라오면 재배포 없이 App Store 단추
// ② 정기 실행이 처음 올라온 때 플랫폼 운영자에게 알림(1시간 안에는 다시 안 물음)
// ③ GitHub Actions(asc-status.mjs)가 App Store Connect 심사 상태를 보내면 바뀐 때만 알림 — 인증 없으면 401 · 반려 알림
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { BASE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const LOOKUP_PORT = 3197, ASC_PORT = 3196;
let srv, sql, ctx, live = false, ascState = 'IN_REVIEW', lookupHits = 0;
const lookup = http.createServer((req, res) => {
  lookupHits++;
  const u = new URL(req.url, 'http://x');
  const ok = live && u.searchParams.get('bundleId') === 'kr.co.dagym.workos';
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ resultCount: ok ? 1 : 0, results: ok ? [{ bundleId: 'kr.co.dagym.workos', trackViewUrl: 'https://apps.apple.com/kr/app/workin/id6700000000?uo=4', version: '1.2.0' }] : [] }));
});
const asc = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(req.headers.authorization ?? '')) { res.statusCode = 401; return res.end('{}'); }
  if (req.url.startsWith('/v1/apps?')) return res.end(JSON.stringify({ data: [{ id: 'APP1', type: 'apps' }] }));
  if (req.url.startsWith('/v1/apps/APP1/appStoreVersions')) return res.end(JSON.stringify({ data: [
    { id: 'V1', attributes: { versionString: '1.1.0', appVersionState: 'READY_FOR_SALE', createdDate: '2026-10-01T00:00:00Z' } },
    { id: 'V2', attributes: { versionString: '1.2.0', appVersionState: ascState, createdDate: '2026-11-20T00:00:00Z' } }] }));
  res.statusCode = 404; res.end('{}');
});
const env = { APPSTORE_LOOKUP_URL: `http://localhost:${LOOKUP_PORT}/lookup`, APPSTORE_WATCH: 'on', NEXT_PUBLIC_APPSTORE_URL: '' };
const html = async (p) => (await fetch(BASE + p, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' } })).text();
const notes = async (re) => (await sql`select title, body from notifications where user_id = ${ctx.ownerId} order by created_at`).filter((n) => re.test(n.title));
const review = (body, auth = 'Bearer cron-test-secret') => fetch(`${BASE}/api/cron/app-review`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });

before(async () => {
  await new Promise((r) => lookup.listen(LOOKUP_PORT, r)); await new Promise((r) => asc.listen(ASC_PORT, r));
  await resetDb(); srv = await startServer(env); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); lookup.close(); asc.close(); });

test('App Store 에 없으면 아이폰 = 홈 화면에 추가 안내 → 올라오면 재배포 없이 단추(공개 조회) · 정기 실행 알림 한 번', async () => {
  let h = await html('/app?os=ios');
  assert.match(h, /data-testid="app-get-ios-soon"/); assert.doesNotMatch(h, /data-testid="app-get-appstore"/);
  assert.equal((await (await fetch(`${BASE}/api/public/app-links`)).json()).appstore, '');
  // 올라옴 — 같은 서버는 못 찾은 결과를 10분 기억하므로 서버를 다시 띄워 확인(운영에서는 10분·1시간 안에 저절로)
  live = true; srv.proc.kill(); await new Promise((r) => setTimeout(r, 800)); srv = await startServer(env);
  h = await html('/app?os=ios');
  assert.match(h, /data-testid="app-get-appstore"/);
  assert.match(h, /href="https:\/\/apps\.apple\.com\/kr\/app\/workin\/id6700000000"/, '추적 꼬리(?uo=4) 없는 주소');
  assert.doesNotMatch(h, /app-get-ios-soon/);
  assert.match(await html('/app?os=pc'), /data-testid="app-get-appstore"/, 'PC 화면도 두 스토어');
  assert.equal((await (await fetch(`${BASE}/api/public/app-links`)).json()).appstore, 'https://apps.apple.com/kr/app/workin/id6700000000');
  const before = lookupHits; await html('/app?os=ios'); await html('/app?os=ios');
  assert.equal(lookupHits, before, '1시간 안에는 다시 묻지 않음');
  // 정기 실행: 처음 올라온 때 운영자 알림 · 1시간 안 두 번째 실행은 건너뜀
  const t1 = await tick(); assert.equal(t1.detail?.appStore?.first ?? t1.appStore?.first ?? true, true);
  assert.equal((await notes(/App Store 에 올라왔습니다/)).length, 1);
  await tick();
  assert.equal((await notes(/App Store 에 올라왔습니다/)).length, 1, '알림 한 번');
  const [s] = await sql`select value from app_settings where key = 'appstore_live'`;
  assert.equal(s.value.url, 'https://apps.apple.com/kr/app/workin/id6700000000');
});

test('심사 상태: 인증 없으면 401 · 바뀐 때만 알림 · 반려 알림 · 알리지 않는 상태는 기록만', async () => {
  assert.equal((await review({ version: '1.2.0', state: 'IN_REVIEW' }, null)).status, 401);
  assert.equal((await review({ version: '1.2.0', state: 'IN_REVIEW' }, 'Bearer wrong-secret-0000')).status, 401);
  assert.equal((await review({ version: '1.2.0', state: 'in review!' })).status, 400);
  let j = await (await review({ version: '1.2.0', state: 'IN_REVIEW' })).json();
  assert.deepEqual([j.changed, j.notified], [true, 1]);
  j = await (await review({ version: '1.2.0', state: 'IN_REVIEW' })).json();
  assert.equal(j.changed, false, '같은 상태는 알림 없음');
  j = await (await review({ version: '1.2.0', state: 'REJECTED' })).json();
  assert.deepEqual([j.changed, j.notified], [true, 1]);
  const rej = await notes(/1\.2\.0 반려/);
  assert.equal(rej.length, 1); assert.match(rej[0].body, /해결 센터/);
  j = await (await review({ version: '1.2.1', state: 'PREPARE_FOR_SUBMISSION' })).json();
  assert.deepEqual([j.changed, j.notified], [true, 0]);
  assert.equal((await notes(/아이폰 앱 1\.2\.\d/)).length, 2, '심사 중 · 반려 두 번만');
});

test('asc-status.mjs(가짜 App Store Connect): 최근 버전 상태를 읽어 서버에 보냄 → 통과 알림', async () => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const run = () => new Promise((res) => execFile('node', ['scripts/asc-status.mjs'], { env: { ...process.env, ASC_KEY_ID: 'KEY1', ASC_ISSUER_ID: 'ISS1', ASC_KEY_P8: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    ASC_API_BASE: `http://localhost:${ASC_PORT}/v1`, APP_URL: BASE, OIDC_TOKEN: 'cron-test-secret' } }, (err, stdout, stderr) => res({ code: err?.code ?? 0, out: stdout + stderr })));
  ascState = 'PENDING_DEVELOPER_RELEASE';
  let r = await run();
  assert.equal(r.code, 0, r.out); assert.match(r.out, /iOS 1\.2\.0: PENDING_DEVELOPER_RELEASE · 출시 중 1\.1\.0/); assert.match(r.out, /상태 바뀜 → 알림 1명/);
  assert.equal((await notes(/1\.2\.0 심사 통과/)).length, 1);
  r = await run();
  assert.match(r.out, /상태 그대로/);
  assert.doesNotMatch(r.out, /BEGIN|PRIVATE|cron-test-secret/, '키·토큰을 출력하지 않음');
});
