// #949(대표 승인 11/04 03:4x '광고로만 유입'): 입찰 공고 아침 메일 무료 구독 — 소개 페이지(로그인 없음) → 신청(이메일·지역·분야·동의) → 아침 정기 실행이 조건에 맞는 새 공고 최대 10건을 한 통으로
// (워크인 발송 Resend 가짜 서버로 받음) · 체험 링크 utm_source=bid_alert · 열람 1×1 · 수신 거부 한 번 · 하루 1통 · 플랫폼 운영 측정(구독·열람·전환)
// (구조 시험 — 실제 메일 도착·광고 유입은 운영에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const RESEND_PORT = 3287;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
let srv, ctx, sql, fake; const resent = [];
const put = (id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'kapt_bid', source_external_id: id, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${id}`, related: true, current_status: '진행중', notice_state: '신규공고', first_seen_at: ago(3), updated_at: ago(3), posted_date: today, deadline_at: `${plus(7)}T17:00:00+09:00`, ...row })}, 'workin')`;
const post = (body, headers = {}) => fetch(`${BASE}/api/public/bid-alerts`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const sub = async (email) => (await sql`select * from bid_alert_subscribers where email = ${email}`)[0];

before(async () => {
  fake = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { resent.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `re_${resent.length}` })); }); }).listen(RESEND_PORT);
  await resetDb(); sql = testDb();
  srv = await startServer({ RESEND_API_KEY: 're_test_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${RESEND_PORT}`, BID_ALERT_HOUR: '0' });
  ctx = await bootstrap();
  // 공고: 경기 주민공동시설(맞음) · 경기 청소(분야 다름) · 부산 헬스장(지역 다름) · 경기 취소 · 경기 마감 지남 · 경기 2주 전 수집(옛것)
  await put('BA1', { title: '[경기] 시험 푸르지오 주민공동시설 위탁운영 업체 선정 입찰공고', issuer: '시험푸르지오', region: '경기', fit_business: '다짐' });
  await put('BA2', { title: '[경기] 시험 단지 청소 용역 입찰공고', issuer: '시험래미안', region: '경기도' });
  await put('BA3', { title: '[부산] 시험 자이 헬스장 위탁운영 입찰공고', issuer: '시험자이', region: '부산', fit_business: '다짐' });
  await put('BA4', { title: '[경기] 시험 힐스테이트 커뮤니티 위탁운영 입찰공고', issuer: '시험힐스', region: '경기', notice_kind: 'cancel', current_status: '취소' });
  await put('BA5', { title: '[경기] 시험 e편한세상 헬스장 위탁운영 입찰공고', issuer: '시험이편한', region: '경기', deadline_at: `${plus(-1)}T17:00:00+09:00` });
  await put('BA6', { title: '[경기] 시험 롯데캐슬 수영장 위탁운영 입찰공고', issuer: '시험롯데', region: '경기', first_seen_at: ago(24 * 14), updated_at: ago(24 * 14) });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('소개 페이지(로그인 없음): 폼·무료 글·가입/카드 없음 · 요금·가격 숫자 없음 · 앱(WorkInApp) 표시로는 로그인으로', async () => {
  const r = await fetch(`${BASE}/landing/bid-alerts`); assert.equal(r.status, 200);
  const html = await r.text();
  for (const s of ['관심 지역 입찰 공고, 매일 아침 메일로 받으세요', '무료로 받기', '회사 가입도, 카드도 없습니다', '개인정보 수집·이용 동의', '14일 무료 체험', 'utm_source=bid_alert']) assert.ok(html.includes(s), s);
  assert.doesNotMatch(html, /[0-9][0-9,]*\s*원(?![가-힣])|최고|1위|유일/, 'kit-ko-copy: 가격 숫자·과장 없음');
  const opts = await (await fetch(`${BASE}/api/public/bid-alerts`)).json();
  assert.equal(opts.regions.length, 17); assert.ok(opts.fields.some((f) => f.key === 'community' && /주민공동시설/.test(f.name)));
  const app = await fetch(`${BASE}/landing/bid-alerts`, { headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36 WorkInApp' }, redirect: 'manual' });
  assert.equal(app.status, 307); assert.equal(new URL(app.headers.get('location'), BASE).pathname, '/login', '#942 앱 안에는 없음');
});

test('신청: 이메일 형식·동의·분야 검사 → 신청 · 같은 이메일은 조건만 바꿈(다시 받음) · utm 기억', async () => {
  assert.equal((await post({ email: 'nope', regions: [], fields: ['community'], agree: true })).status, 400);
  assert.equal((await post({ email: 'a@test.co', regions: [], fields: [], agree: true })).status, 400, '분야 하나 이상');
  assert.equal((await post({ email: 'a@test.co', regions: [], fields: ['community'], agree: false })).status, 400, '동의 필요');
  assert.equal((await post({ email: 'a@test.co', regions: ['강남'], fields: ['community'], agree: true })).status, 400, '시·도 이름만');
  const r = await post({ email: 'Lead@Test.co', regions: ['경기', '서울'], fields: ['community', 'facility'], agree: true, utm: { source: 'meta', medium: 'cpc', campaign: 'bid-alerts', page: 'bid-alerts' } });
  assert.equal(r.status, 200); const j = await r.json(); assert.deepEqual([j.ok, j.resubscribed], [true, false]);
  const s = await sub('lead@test.co');
  assert.deepEqual([s.status, s.regions, s.fields, s.utm.source, s.utm.page], ['active', ['경기', '서울'], ['community', 'facility'], 'meta', 'bid-alerts']);
  assert.ok(s.token.length >= 16 && s.created_ip, '토큰·신청 주소');
  const r2 = await post({ email: 'lead@test.co', regions: ['경기'], fields: ['community'], agree: true });
  assert.deepEqual([(await r2.json()).resubscribed, (await sub('lead@test.co')).regions], [true, ['경기']], '다시 신청하면 조건만 바꿈');
  await post({ email: 'all@test.co', regions: [], fields: ['community', 'cleaning', 'goods'], agree: true }); // 전국 · 여러 분야
});

test('아침 정기 실행: 조건에 맞는 새 공고만(지역·분야·취소·마감 지남·옛 공고 제외) 한 통 · 체험 링크 utm · 수신 거부 링크 · 열람 그림 · 하루 1통', async () => {
  resent.length = 0;
  const d = await tick();
  assert.deepEqual([d.bidAlerts?.sent, d.bidAlerts?.empty, d.bidAlerts?.subscribers], [2, 0, 2], JSON.stringify(d.bidAlerts));
  const m1 = resent.find((m) => m.to.includes('lead@test.co')); const m2 = resent.find((m) => m.to.includes('all@test.co'));
  assert.ok(m1 && m2);
  assert.match(m1.subject, /^\[워크인\] \d{1,2}\/\d{1,2}\([일월화수목금토]\) 새 입찰 공고 1건 — \[경기\] 시험 푸르지오/);
  assert.ok(m1.html.includes('시험 푸르지오') && !m1.html.includes('시험 단지 청소') && !m1.html.includes('시험 자이') && !m1.html.includes('시험 힐스') && !m1.html.includes('시험 이편한') && !m1.html.includes('시험 롯데'), '경기·주민공동시설만');
  assert.ok(m1.html.includes('utm_source=bid_alert') && m1.html.includes('data-bid-alert-trial="1"') && m1.text.includes('워크인 14일 무료 체험'), '체험 한 줄');
  const s1 = await sub('lead@test.co');
  const h1 = m1.html.replace(/&amp;/g, '&'); // HTML 안 주소의 & 는 &amp; 로 적힘
  assert.ok(h1.includes(`/api/public/bid-alerts/unsubscribe?t=${encodeURIComponent(s1.token)}`) && h1.includes(`/api/public/bid-alerts/open?t=${encodeURIComponent(s1.token)}&d=${today}`), '수신 거부·열람 주소');
  assert.ok(m1.text.includes('수신 거부하면 30일 안에 지웁니다'), '개인정보 안내');
  assert.ok(m2.html.includes('시험 푸르지오') && m2.html.includes('시험 단지 청소'), '전국·청소 분야까지 2건');
  assert.equal((m2.html.match(/data-bid-alert="1"/g) ?? []).length, 1);
  assert.deepEqual([s1.last_sent_day, s1.sent_count], [today, 1]);
  assert.equal((await sql`select n from bid_alert_sends where subscriber_id = ${s1.id}`)[0].n, 1);
  const again = await tick(); assert.equal(again.bidAlerts?.subscribers, 0, '같은 날 두 번 안 보냄'); assert.equal(resent.length, 2);
});

test('열람 1×1 · 수신 거부 한 번(HTML 안내) → 다음 날 실행에서 빠짐 · 플랫폼 운영 측정(구독·열람·수신 거부)', async () => {
  const s1 = await sub('lead@test.co');
  const px = await fetch(`${BASE}/api/public/bid-alerts/open?t=${encodeURIComponent(s1.token)}&d=${today}`);
  assert.equal(px.status, 200); assert.equal(px.headers.get('content-type'), 'image/gif');
  assert.ok((await sql`select opened_at from bid_alert_sends where subscriber_id = ${s1.id}`)[0].opened_at, '열람 기록'); assert.equal((await sub('lead@test.co')).open_count, 1);
  const u = await fetch(`${BASE}/api/public/bid-alerts/unsubscribe?t=${encodeURIComponent(s1.token)}`);
  assert.equal(u.status, 200); assert.match(await u.text(), /data-bid-alert-unsub="ok"/);
  assert.equal((await sub('lead@test.co')).status, 'unsubscribed');
  assert.match(await (await fetch(`${BASE}/api/public/bid-alerts/unsubscribe?t=nope-token-xx`)).text(), /data-bid-alert-unsub="no"/);
  await sql`update bid_alert_subscribers set last_sent_day = last_sent_day - 1`; resent.length = 0;
  const d = await tick(); assert.equal(d.bidAlerts?.subscribers, 1, '수신 거부한 사람은 빠짐'); assert.ok(!resent.some((m) => m.to.includes('lead@test.co')));
  const f = await ctx.owner.ok('GET', '/api/platform/funnel');
  assert.deepEqual([f.bidAlerts.subscribers, f.bidAlerts.unsubscribed, f.bidAlerts.newSubscribers, f.bidAlerts.opened >= 1, f.bidAlerts.signups], [1, 1, 2, true, 0], JSON.stringify(f.bidAlerts));
  assert.ok(f.byPage.rows.some((r) => r.page === 'bid-alerts'), '소개 페이지별 방문 줄에 bid-alerts');
});
