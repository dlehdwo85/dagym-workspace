// 소개 사이트 그림(대표 10/20 16:45 · 306차 #877 '보편적인 회사 툴로 보이게'): 일반 B2B 샘플 회사(실제 데이터 아님)로 홈·업무·캘린더·영업 홈·마케팅 홈 + OG 그림을 public/landing/ 에 만든다.
// 실행: npm run build && node tests/e2e/landing-shots.mjs  (PostgreSQL 필요)
import { chromium } from 'playwright';
import { bootstrap, resetDb, startServer, BASE, Client, addDays, seoulToday, testDb } from '../helpers.mjs';

await resetDb();
const srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50' });
await bootstrap();
const sql = testDb();
const today = seoulToday();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
try {
  const c = new Client('sample');
  const sg = await c.ok('POST', '/api/auth/signup', { email: 'sample@workin.test', password: 'sample-pass-1234', name: '김하늘', mode: 'team', company: '하늘솔루션', agree: { terms: true, age14: true, privacy: true } });
  await c.ok('POST', '/api/auth/verify', { token: sg.devLink.split('/').pop() });
  await c.ok('POST', '/api/onboarding', { title: '대표', done: true });
  const me = await c.ok('GET', '/api/auth/me'); const unit = me.orgUnits[0].id; const tenant = me.user.tenant ?? (await sql`select tenant from users where email = 'sample@workin.test'`)[0].tenant;
  const ppl = [];
  for (const [n, e] of [['이서준', 'seojun'], ['박지우', 'jiwoo'], ['최민서', 'minseo']]) {
    const inv = await c.ok('POST', '/api/admin/users', { email: `${e}@workin.test`, name: n, role: 'staff', orgUnitIds: [unit], title: '매니저' });
    const x = new Client(e); await x.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'sample-pass-1234' });
    ppl.push((await x.ok('GET', '/api/auth/me')).user.id);
  }
  const T = [['신제품 소개 자료 최종본 정리', 0, 0, 'high'], ['거래처 미팅 준비 — 견적서 확인', 1, 0, 'urgent'], ['월간 매출 보고서 작성', 2, 1, 'normal'], ['홈페이지 이벤트 배너 교체', 0, 2, 'normal'],
    ['신규 입사자 교육 일정 잡기', 1, 3, 'normal'], ['사무실 비품 주문', 2, -1, 'low'], ['고객 문의 답변 정리', 0, 1, 'high'], ['분기 목표 회의 안건 정리', 1, 4, 'normal']];
  for (const [title, who, d, priority] of T) await c.ok('POST', '/api/tasks', { title, orgUnitId: unit, assigneeId: ppl[who], dueDate: addDays(today, d), priority });
  const cals = (await c.ok('GET', '/api/calendars')).calendars; const cc = cals.find((x) => x.type === 'company') ?? cals[0];
  for (const [title, d, h] of [['주간 팀 회의', 0, 10], ['거래처 미팅', 1, 14], ['신제품 리뷰', 2, 11], ['점심 세미나', 3, 12], ['월간 회고', 4, 16]]) await c.ok('POST', '/api/events', { calendarId: cc.id, title, start: `${addDays(today, d)}T${String(h).padStart(2, '0')}:00:00+09:00`, end: `${addDays(today, d)}T${String(h + 1).padStart(2, '0')}:00:00+09:00` });
  // 영업: 공간 켜기 + 전환 완료 + 샘플 공고·리드(일반 B2B — 306차 #877)
  await c.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant, at: new Date().toISOString(), daily: true })}) on conflict (key) do update set value = excluded.value`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values (${tenant}, true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
  await put('procurement_notices', { id: 'S1', title: '공공기관 홈페이지 유지관리 용역', issuer: '경기도청', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 6)}T10:00:00+09:00`, status: '공고중' });
  await put('procurement_notices', { id: 'S2', title: '사무용 가구 구매', issuer: '수원시', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 3)}T14:00:00+09:00`, status: '공고중' });
  await put('procurement_notices', { id: 'S3', title: '청사 시설 청소 용역', issuer: '화성시', region: '경기', related: true, first_seen_at: addDays(today, -40), status: '낙찰', winner_name: '타사', contract_end_date: addDays(today, 70) });
  await c.ok('POST', '/api/sales/work', { kind: 'bid', id: 'S1', status: '연락중', nextDate: today });
  await c.ok('POST', '/api/sales/leads', { name: '가나 물류(가상)', status: '미팅예정', priority: 'high', region: '경기', expectedRevenue: 36000000, nextContactDate: today, force: true, ownerId: ppl[0] });
  await c.ok('POST', '/api/sales/leads', { name: '다라 오피스(가상)', status: '1차연락완료', region: '서울', nextContactDate: addDays(today, 2), force: true, ownerId: ppl[1] });
  await c.ok('POST', '/api/sales/leads', { name: '마바 디자인(가상)', status: '제안서작성중', region: '인천', expectedRevenue: 24000000, nextContactDate: addDays(today, 4), force: true });
  // 마케팅: 공간 켜기 + 브랜드 + 시안 3건(그림 포함)
  await c.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = await c.ok('POST', '/api/marketing/brands', { name: '하늘솔루션' }).catch(() => null);
  const { PNG } = await import('./png.mjs');
  const media = [];
  for (const [name, col] of [['신제품 소개 시안.png', [124, 58, 237]], ['고객 사례 시안.png', [37, 99, 235]], ['연말 안내 시안.png', [15, 118, 110]]]) {
    const lf = await c.ok('POST', '/api/library', { fileName: name, mimeType: 'image/png', size: 100, folder: '마케팅' });
    const buf = PNG(640, 640, col);
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: { ...lf.upload.headers, 'content-length': String(buf.length) }, body: buf });
    await c.ok('POST', `/api/library/${lf.id}/complete`); media.push(lf.id);
  }
  for (const [i, [title, channel, kind, d, h]] of [['신제품 출시 소식', 'instagram', 'feed', 0, 18], ['고객 사례 소개 영상', 'instagram', 'reels', 1, 12], ['연말 휴무 안내', 'facebook', 'feed', 2, 10]].entries())
    await c.ok('POST', '/api/marketing/contents', { title, channel, kind, brandId: brand?.id, body: `${title} — 이번 주 하늘솔루션 소식을 전해 드립니다. 자세한 내용은 프로필 링크에서 확인하세요.`, mediaIds: [media[i]], scheduledAt: `${addDays(today, d)}T${String(h).padStart(2, '0')}:00:00+09:00` }).catch((e) => console.log('content', e.message));
  // 로그인 → 캡처
  const ctx0 = await browser.newContext(); const p0 = await ctx0.newPage();
  await p0.goto(BASE + '/login'); await p0.getByLabel('이메일', { exact: true }).fill('sample@workin.test'); await p0.getByLabel('비밀번호').fill('sample-pass-1234');
  await p0.getByRole('button', { name: '로그인' }).click(); await p0.waitForURL(BASE + '/');
  const st = await ctx0.storageState(); await ctx0.close();
  const lc = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: st });
  const p = await lc.newPage();
  for (const [path, file] of [['/', 'home'], ['/tasks', 'tasks'], ['/calendar?view=week', 'calendar'], ['/s/sales', 'sales'], ['/s/marketing', 'marketing'], ['/s/marketing/approvals', 'approvals']]) {
    await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1200);
    await p.screenshot({ path: `public/landing/${file}.png` });
  }
  // OG 그림 1200×630
  const og = await lc.newPage(); await og.setViewportSize({ width: 1200, height: 630 });
  await og.setContent(`<html><body style="margin:0;font-family:Pretendard,system-ui,sans-serif;background:linear-gradient(135deg,#0F766E 0%,#2563EB 55%,#7C3AED 100%);color:#fff;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;padding:0 80px;box-sizing:border-box">
    <div style="font-size:28px;font-weight:600;opacity:.9">워크인</div><div style="font-size:72px;font-weight:800;line-height:1.15;margin-top:12px">업무도, 영업도,<br>마케팅도 한 화면에서</div>
    <div style="font-size:30px;margin-top:28px;opacity:.95">14일 무료 체험 · 웹 · Android · iOS</div></body></html>`);
  await og.screenshot({ path: '/tmp/landing-og-preview.png' }); // 로고 S3 확정: public/landing/og.png 는 docs/handoff/brand/workin-s3/og-1200x630.png 고정본(덮어쓰지 않음)
  console.log('랜딩 그림 저장: public/landing/{home,tasks,calendar,sales,marketing,approvals,og}.png');
} finally { await browser.close(); srv.proc.kill(); await sql.end(); }
