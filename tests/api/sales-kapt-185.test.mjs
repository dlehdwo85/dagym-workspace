// 185차(로컬 10/26 19:20 · 대표 지적 "K-apt 놓친 공고"): 운영 K-apt bidList 대조에서 영업실 목록에 없던 공고 번호 그대로(구조 시험 — 실제 K-apt 는 운영에서 확인)
// A1 본문 제외어(지하주차장·주차관제)로 공고 전체가 빠짐 → 제외 주제는 제목·분류만
// A2 분류 '사업자 - 공사 - 장기수선'의 '공사'를 잡음으로 봐 약한 낱말(커뮤니티·통합관리시스템) 무시 → 잡음은 제목만 · 제목에 커뮤니티가 있으면 통합관리시스템 = 강한 낱말
// A3 하이링크 검색어 '출입보안'·'로비폰'·'공동현관 출입'
// A4 예전 판정으로 '관련 아님'에 남은 줄 → 다시 판정(올리기만) · 마감 전이면 '다시 찾은 공고'로 오늘 새 공고·당일 메일에 한 번 · 플랫폼 조회(사라진·합쳐진 줄·빠지는 이유)
// A5 목록 읽기 = 최근순 + 공고 3년 창
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3251;
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const today = plus(0);
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
// [번호, 원천 번호, 제목, 입찰분류, 본문, 기대]
const N = [
  ['20261023114158368', '[서울] 출입통제장치 및 주차차단기 공사업체 선정', '사업자 - 공사 - 일반공사', '지하주차장 출입구 주차관제 차단기와 공동현관 출입통제장치를 교체합니다.', '하이링크'], // A1
  ['20261026153718356', '[서울] 커뮤니티센터 통합관리시스템 구축 사업자 선정', '사업자 - 공사 - 장기수선', '커뮤니티센터 회원·시설 통합관리시스템 구축', '하이링크'], // A2 · 191차 대표 "시스템 구축 = 하이링크" — 다짐 붙지 않음
  ['20261023135931560', '[서울] 출입보안 시스템 구축 공사 업체 선정', '사업자 - 공사 - 일반공사', '단지 출입보안 시스템 구축', '하이링크'], // A3
  ['20261023140627810', '[경기] 공동현관 출입카드리더기 모듈교체', '사업자 - 공사 - 일반공사', '지하주차장 엘리베이터홀 공동현관 카드리더기 모듈 교체', '하이링크'], // A4
  ['20261023133052575', '[경기] 출입통제(홈오토)시스템 교체 재공고', '사업자 - 공사 - 장기수선', '세대 홈오토메이션·출입통제 시스템 교체', '하이링크'],
  // 191차(대표 10/27 정정 "스크린 골프나 골프연습장 설치 및 공사는 저희가 하지 않습니다. 운영만 합니다"): 다짐 = 운영·위탁만 → 관련 아님
  ['20261023183942531', '[인천] 스크린골프 렌탈 및 시공', '사업자 - 용역 - 기타', '주민공동시설 골프연습장 스크린골프 장비 렌탈 및 시공', null],
  ['20261023103647191', '[부산] 스크린골프 GDR PLUS 설치', '사업자 - 공사 - 일반공사', '주민공동시설 골프연습장 GDR PLUS 설치', null],
  ['20261023163607068', '[대구] 골프연습장 시설개선 및 기계장비 설치', '사업자 - 공사 - 장기수선', '골프연습장 기계장비 교체 및 시설개선', null],
  ['20261026000000777', '[서울] 피트니스센터 운영 업체 선정', '사업자 - 용역 - 위탁', '피트니스센터 운영 및 출입통제 시스템 관리', '다짐·하이링크'], // 본문 낱말로 하이링크가 붙는 공고(다음 수집에서 상세를 못 읽어도 유지)
  ['20261026000000901', '[경기] 지하주차장 바닥 도장 공사', '사업자 - 공사 - 장기수선', '지하주차장 바닥 에폭시 도장', null], // 대조: 제목의 제외 주제
  ['20261026000000902', '[인천] 어린이집 운영자 선정', '사업자 - 용역 - 위탁', '단지 내 국공립 어린이집 위탁 운영', null],
];
const byId = Object.fromEntries(N.map((n) => [n[0], n]));
const failDetail = new Set();
const kapt = fakeKapt({ detailHtml: (bid) => { const n = byId[bid]; return n ? `<table><tr><th>입찰분류</th><td>${n[2]}</td></tr><tr><th>입찰종류</th><td>일반경쟁</td></tr><tr><th>내용</th><td><pre>${n[3]}</pre></td></tr></table>` : ''; } });
const dataGo = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
let srv, ctx, sql, fake;
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, u.searchParams.get('pageNo') === '1' ? `<html><table>${N.map((n, i) => tr(n[0], [String(i + 1), 'K-APT', '최저가', n[1], `${plus(6)} 14:00`, '공고중', `시험 단지 ${i + 1}`, `${today} 09:${String(i).padStart(2, '0')}`])).join('')}</table></html>` : '<html><table></table></html>');
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, dataGo([]), 'application/json');
    if (u.pathname === '/kapt/bid/bidDetail.do' && failDetail.has(u.searchParams.get('bidNum'))) return send(500, 'error');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ MAIL_DEV: '1', SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'test-key', KAPT_SERVICE_KEY: 'kapt-key' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });
const rowOf = async (ext) => (await sql`select src_id, row, gone from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and row->>'source_external_id' = ${ext}`)[0];

test('A1·A2·A3: 본문 제외어·분류 잡음으로 빠졌던 K-apt 공고가 관련으로 · 대조 2건은 그대로 · 상세를 못 읽은 다음 수집에서도 판정 유지', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.equal(r.inserted, N.length);
  for (const [ext, title, , , want] of N) {
    const { row } = await rowOf(ext);
    if (want === null) { assert.equal(row.related, false, `${title} = 관련 아님`); continue; }
    assert.equal(row.related, true, `${title} 관련 (분류 ${row.bid_category})`);
    if (want instanceof RegExp) assert.match(row.fit_business, want, title); else assert.equal(row.fit_business, want, title);
  }
  assert.ok((await rowOf('20261023135931560')).row.matched_keywords.includes('출입보안'), 'A3 출입보안');
  assert.ok((await rowOf('20261026153718356')).row.matched_keywords.includes('통합관리시스템'), 'A2 통합관리시스템(제목에 커뮤니티)');
  assert.ok((await rowOf('20261023140627810')).row.matched_keywords.includes('공동현관 출입'), 'A3 공동현관 출입');
  // 영업실 목록(전체 탭)에서 공고 이름으로 찾힘
  for (const q of ['출입통제장치 및 주차차단기', '커뮤니티센터 통합관리시스템', '출입보안 시스템', '공동현관 출입카드리더기']) {
    const v = await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent(q)}`);
    assert.ok(v.items.some((i) => i.title.includes(q)), `${q}: ${JSON.stringify(v.items.map((i) => i.title))}`);
  }
  // 191차: 스크린골프 렌탈·설치, 골프연습장 시설개선 공고는 영업실 목록에 없음
  for (const q of ['스크린골프', '골프연습장 시설개선']) assert.equal((await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent(q)}`)).items.length, 0, q);
  assert.equal((await rowOf('20261023183942531')).row.classification, '참고(비관련)');
  // 다음 수집에서 상세(분류·본문)를 못 읽어도 저장된 본문으로 판정 — 본문 낱말로 붙은 하이링크가 빠지지 않음
  failDetail.add('20261026000000777');
  const r2 = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(r2.inserted, 0);
  assert.equal((await rowOf('20261026000000777')).row.fit_business, '다짐·하이링크', '상세를 못 읽은 수집에서도 유지');
});

test('A4: 예전 판정 "관련 아님" 줄 다시 판정(올리기만) → 마감 전은 오늘 새 공고·당일 메일에 "다시 찾은 공고" 한 번 · 마감 지난 줄은 관련만 · 120일 밖은 days 로 · 플랫폼 조회', async () => {
  const ins = async (ext, title, extra = {}) => { const id = randomUUID();
    const row = { id, source_type: 'kapt_bid', source_external_id: ext, source_url: `http://localhost:${PORT}/kapt/bid/bidDetail.do?bidNum=${ext}`, title, issuer: '예전 단지', bid_category: '사업자 - 공사 - 일반공사',
      task_scope: '지하주차장 출입구 카드리더기 교체(주차관제 연동)', related: false, fit_business: null, matched_keywords: [], classification: '참고(비관련)', current_status: '진행중', notice_kind: 'new',
      posted_date: plus(-3), deadline_at: `${plus(5)}T17:00:00+09:00`, first_seen_at: new Date(Date.now() - 3 * 864e5).toISOString(), updated_at: new Date(Date.now() - 3 * 864e5).toISOString(), ...extra };
    await sql`insert into sales_src_rows (scope, tbl, src_id, row, gone, origin) values ('global', 'procurement_notices', ${id}, ${sql.json(row)}, ${!!extra.__gone}, 'src')`; return id; };
  const open = await ins('OLD-OPEN', '[서울] 공동현관 카드리더기 교체 공사');
  const closed = await ins('OLD-CLOSED', '[서울] 로비폰 교체 공사', { deadline_at: `${plus(-2)}T17:00:00+09:00`, current_status: '마감', task_scope: '세대 로비폰 교체 — 지하주차장 동 포함' });
  const plain = await ins('OLD-PLAIN', '[경기] 옥상 방수 공사', { task_scope: '옥상 방수' });
  const old = await ins('OLD-200', '[경기] 출입통제 시스템 교체', { first_seen_at: new Date(Date.now() - 200 * 864e5).toISOString(), deadline_at: null });
  const merged = await ins('OLD-MERGED', '[경기] 출입통제 시스템 교체 정정', { merged_into: 'keep-row-1', __gone: true });
  // 다른 사람은 404
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/sales-notices', { refit: true })).status, 404);
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/sales-notices?no=OLD-OPEN')).status, 404);
  // 조회: 다시 판정 전 — 관련 아님 + 지금 규칙으로는 관련
  let look = await ctx.owner.ok('GET', '/api/platform/sales-notices?no=OLD-OPEN');
  assert.equal(look.items.length, 1); assert.equal(look.items[0].origin, '원본 영업관리 복사'); assert.equal(look.items[0].related, false);
  assert.equal(look.items[0].nowRule.fit, '하이링크'); assert.match(look.items[0].reasons.join(' '), /지금 규칙으로는 관련\(하이링크/);
  look = await ctx.owner.ok('GET', '/api/platform/sales-notices?no=OLD-MERGED');
  assert.equal(look.items[0].gone, true); assert.match(look.items[0].reasons[0], /합쳐짐\(남긴 줄 keep-row-1\)/);
  look = await ctx.owner.ok('GET', `/api/platform/sales-notices?q=${encodeURIComponent('옥상 방수')}`);
  assert.equal(look.items.length, 1); assert.match(look.items[0].reasons.join(' '), /지금 규칙으로도 관련 낱말 없음/);
  assert.equal((await ctx.owner.req('GET', '/api/platform/sales-notices')).status, 400);
  // 다시 판정
  const rf = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.equal(rf.raised, 2, JSON.stringify(rf)); assert.equal(rf.reopened, 1);
  const o = (await sql`select row from sales_src_rows where src_id = ${open}`)[0].row;
  assert.equal(o.related, true); assert.equal(o.fit_business, '하이링크'); assert.ok(o.refound_at); assert.notEqual(o.classification, '참고(비관련)');
  const c = (await sql`select row from sales_src_rows where src_id = ${closed}`)[0].row;
  assert.equal(c.related, true); assert.equal(c.refound_at, undefined, '마감 지난 공고는 다시 찾은 공고로 띄우지 않음'); assert.deepEqual(c.matched_keywords, ['로비폰']);
  assert.equal((await sql`select row from sales_src_rows where src_id = ${plain}`)[0].row.related, false);
  assert.equal((await sql`select row from sales_src_rows where src_id = ${old}`)[0].row.related, false, '120일 밖');
  assert.equal((await sql`select row, gone from sales_src_rows where src_id = ${merged}`)[0].row.related, false, '사라진 줄은 그대로');
  // 오늘 새 공고 탭 · 당일 메일 미리보기에 '다시 찾은 공고'
  const td = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today');
  const hit = td.items.find((i) => i.title.includes('공동현관 카드리더기 교체'));
  assert.ok(hit, JSON.stringify(td.items.map((i) => [i.title, i.todayLabel]))); assert.match(hit.todayLabel, /^다시 찾은 공고/);
  assert.ok(!td.items.some((i) => i.title.includes('로비폰')), '마감 지난 줄은 오늘 탭 아님');
  const mail = await ctx.owner.ok('GET', '/api/sales/digest?preview=text');
  assert.match(JSON.stringify(mail), /다시 찾은 공고/);
  // 다시 돌려도 refound_at 은 그대로(매일 다시 뜨지 않음) · 올릴 것 없음
  const again = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.equal(again.raised, 0); assert.equal((await sql`select row from sales_src_rows where src_id = ${open}`)[0].row.refound_at, o.refound_at);
  // days 를 넓히면 오래된 줄도
  assert.equal((await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true, days: 365 })).raised, 1);
  assert.equal((await sql`select row from sales_src_rows where src_id = ${old}`)[0].row.related, true);
  const aud = await sql`select count(*)::int n from audit_logs where action = 'platform.sales_notices.refit'`;
  assert.equal(aud[0].n, 3);
});

test('A5: 목록 읽기는 최근순 + 공고 3년 창 — 4년 전 처음 본 공고는 목록에서 빠짐', async () => {
  const add = async (ext, title, firstSeen) => { const id = randomUUID();
    await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'g2b_bid', source_external_id: ext, source_url: 'https://www.g2b.go.kr/x', title, related: true, fit_business: '다짐',
      matched_keywords: ['피트니스'], current_status: '진행중', deadline_at: `${plus(20)}T17:00:00+09:00`, posted_date: firstSeen.slice(0, 10), first_seen_at: firstSeen })}, 'workin')`; };
  await add('W-OLD', '창 시험 오래된 피트니스 위탁운영', new Date(Date.now() - 4 * 365 * 864e5).toISOString());
  await add('W-NEW', '창 시험 새 피트니스 위탁운영', new Date(Date.now() - 864e5).toISOString());
  const v = await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent('창 시험')}`);
  assert.deepEqual(v.items.map((i) => i.title), ['창 시험 새 피트니스 위탁운영']);
});
