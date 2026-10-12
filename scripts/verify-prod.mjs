// 운영(또는 검수) 배포 직후 점검: node scripts/verify-prod.mjs https://<주소>
// 선택: SMOKE_EMAIL / SMOKE_PASSWORD 를 주면 로그인·내 정보·업무 목록까지 확인 (데이터는 만들지 않음)
const base = (process.argv[2] ?? process.env.APP_URL ?? '').replace(/\/$/, '');
if (!base) { console.error('사용법: node scripts/verify-prod.mjs https://<주소>'); process.exit(1); }
const results = [];
const check = async (name, fn) => {
  try { const d = await fn(); results.push({ name, ok: true, d }); console.log('✔', name, d ?? ''); }
  catch (e) { results.push({ name, ok: false, e: e.message }); console.log('✖', name, '-', e.message); }
};
const get = (p, opt) => fetch(base + p, { redirect: 'manual', ...opt });
const assert = (c, m) => { if (!c) throw new Error(m); };

await check('헬스체크 (DB·마이그레이션)', async () => {
  const h = await (await get('/api/health')).json();
  assert(h.ok && h.db === 'ok', JSON.stringify(h));
  return `DB ${h.dbLatencyMs}ms · ${h.migration} · ${h.env} · ${h.commit ?? ''}`;
});
await check('정기 실행 30분 이내', async () => {
  const h = await (await get('/api/health')).json();
  assert(h.scheduler.healthy, `마지막 실행 ${h.scheduler.lastTick ?? '없음'}`);
  return `${h.scheduler.ageMinutes}분 전`;
});
await check('운영 설정 (파일 저장소 S3·웹 푸시)', async () => {
  const h = await (await get('/api/health')).json();
  assert(h.config.fileStorage === 's3', '파일 저장소가 로컬 디스크 — 운영에서는 S3_* 필요');
  return `webPush=${h.config.webPush} appPush=${h.config.appPush} googleSync(선택)=${h.config.googleCalendar}`;
});
await check('로그인 화면', async () => { const r = await get('/login'); assert(r.status === 200, `HTTP ${r.status}`); });
await check('보안 헤더', async () => {
  const r = await get('/login');
  for (const h of ['x-frame-options', 'x-content-type-options', 'referrer-policy']) assert(r.headers.get(h), `${h} 없음`);
  assert(base.startsWith('https://') ? (r.headers.get('strict-transport-security') ?? 'vercel') : true, 'HSTS');
});
await check('비로그인 API 차단 401', async () => { const r = await get('/api/tasks'); assert(r.status === 401, `HTTP ${r.status}`); });
await check('관리자 API 비로그인 차단', async () => { const r = await get('/api/admin/users'); assert(r.status === 401, `HTTP ${r.status}`); });
await check('스케줄러 무인증 호출 거부', async () => { const r = await get('/api/cron/tick', { method: 'POST' }); assert(r.status === 401, `HTTP ${r.status}`); });
await check('개인정보처리방침', async () => { const r = await get('/privacy'); assert(r.status === 200, `HTTP ${r.status}`); });
await check('검색엔진 차단(robots)', async () => { const t = await (await get('/robots.txt')).text(); assert(t.includes('Disallow: /'), t); });
await check('앱 링크 파일', async () => { const r = await get('/.well-known/assetlinks.json'); assert(r.status === 200, `HTTP ${r.status}`); return JSON.stringify(await r.json()).slice(0, 80); });
if (process.env.SMOKE_EMAIL) {
  await check('점검 계정 로그인·조회', async () => {
    const r = await get('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }) });
    assert(r.status === 200, `로그인 HTTP ${r.status}`);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    const me = await (await get('/api/auth/me', { headers: { cookie } })).json();
    const t = await (await get('/api/tasks?view=my', { headers: { cookie } })).json();
    await get('/api/auth/logout', { method: 'POST', headers: { cookie, origin: base } });
    return `${me.user.name} · 내 업무 ${t.tasks.length}건`;
  });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과 — ${base}`);
process.exit(failed ? 1 : 0);
