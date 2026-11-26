// 대표 11/27(로컬 긴급 — K-apt 20261125102521723 강화 서희스타힐스 1,2단지 '입주민 편의시설 운영업체 선정 입찰공고'가 '관련 아님(우리 사업 낱말 없음)'으로 숨겨짐):
// ① 제목의 '편의시설'은 아파트·입주민 맥락 + 운영·위탁 낱말이 있을 때만 다짐 시설 낱말 — 이 제목 + 빈 분류 → 다짐 즉시 검토 · '편의시설물 광고'·'병원 편의시설 커피전문점'·본사 세탁소 → 관련 아님
// ② K-apt 목록 줄은 분류가 비어 제목만으로 판정 → 제목에 운영업체·위탁운영 같은 운영 맡김 말이 있는데 '관련 아님'이면 상세(bidDetail.do)에서 입찰분류를 받아 다시 판정
//    (분류 '사업자-용역-주민운동시설의 위탁' = 다짐 즉시 검토) · 경비·청소 위탁, 운영 맡김 말이 없는 줄은 상세를 읽지 않음
// ③ 규칙을 바꾼 뒤 한 번: 최근 60일 '관련 아님' K-apt 운영 공고 상세 읽기 + 다시 판정 → 새로 관련이 된 공고(단지·마감·마감 전 여부)를 남김(플랫폼 공고 조회 ?refit=last)
// (구조 시험 — 가짜 K-apt 화면은 실제 상세의 칸 이름 그대로. 실제 K-apt 연결·운영 공고 다시 판정은 운영에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3297;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const detail = (cat) => `<table class="contTbl"><tbody><tr> <th scope="col">입찰분류</th> <td> ${cat} </td> <th scope="col">입찰종류</th> <td> 제한경쟁 </td> </tr>
<tr> <th scope="col">현장설명</th> <td> 현장설명회없음 </td> </tr></tbody></table>`;
const GYM = '사업자 - 용역 - 주민운동시설의 위탁';
// 목록(이번 수집) — A: 서희스타힐스와 같은 제목(상세에 분류 없음) · B: 운영업체만(상세 분류 = 주민운동시설의 위탁) · C: 편의시설물 광고 · D: 경비 위탁
const A = '20261125102521723', B = '20261126100000001', C = '20261126100000002', D = '20261126100000003';
const TA = '[인천] 시험서희스타힐스 1,2단지 입주민 편의시설 운영업체 선정 입찰공고', TB = '[경기] 시험단지 운영업체 선정 입찰공고', TC = '[경남] 시험단지 편의시설물광고 사업자 선정', TD = '[서울] 시험단지 경비 위탁업체 선정';
// 저장된 예전 줄(규칙 바꾸기 전) — OLD: 10일 전 '관련 아님'·분류 빈 운영 공고(상세 분류 = 주민운동시설의 위탁) · FAR: 70일 전(60일 밖) · CAFE: 나라장터 병원 편의시설 커피전문점
const OLD = '20261117100000004', FAR = '20260918100000005';
const DETAILS = { [A]: '', [B]: detail(GYM), [C]: detail('사업자 - 용역 - 기타'), [D]: detail('사업자 - 용역 - 경비'), [OLD]: detail(GYM), [FAR]: detail(GYM) };
let srv, ctx, sql, fake, kapt;
const rowOf = async (ext) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${ext}`)[0]?.row;
const put = async (ext, title, o = {}) => {
  const id = randomUUID();
  const row = { id, source_type: 'kapt_bid', source_external_id: ext, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${ext}`, title, issuer: '시험단지', facility_name: '시험단지', current_status: '진행중', notice_state: '신규공고', notice_kind: 'new',
    posted_date: plus(-10), deadline_at: `${plus(5)}T17:00:00+09:00`, first_seen_at: ago(10), related: false, fit_business: null, matched_keywords: [], classification: '참고(비관련)', ...o };
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json(row)}, 'workin')`; return id;
};
const detailCalls = (bid) => kapt.calls.filter((c) => c.path === '/kapt/bid/bidDetail.do' && c.q.bidNum === bid).length;

before(async () => {
  kapt = fakeKapt({ detailHtml: (bid) => DETAILS[bid] ?? '' });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? [[A, TA], [B, TB], [C, TC], [D, TD]].map(([id, t], i) => tr(id, [String(i + 1), 'K-apt', '적격심사', t, `${plus(11)} 17:00`, '신규공고', '시험단지', `${plus(-1)} 10:25`])).join('') : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await put(OLD, '[충남] 시험단지 운영업체 선정 공고');
  await put(FAR, '[충남] 시험먼단지 운영업체 선정 공고', { first_seen_at: ago(70), posted_date: plus(-70), deadline_at: `${plus(-60)}T17:00:00+09:00` });
  await put('R26BK09990001-000', '시험의료원 병원 편의시설 커피전문점 운영업체 선정', { source_type: 'g2b_bid', source_url: 'https://www.g2b.go.kr/link/R26BK09990001-000', issuer: '시험의료원', facility_name: null, bid_category: '용역' });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('지금 규칙(플랫폼 공고 조회): 이 제목 + 빈 분류 = 다짐 즉시 검토 · 편의시설물 광고·병원 편의시설 커피전문점·본사 세탁소 = 관련 아님', async () => {
  await put('20261126100000010', '[경기] 시험단지 편의시설물 광고 운영업체 선정');
  await put('R26BK09990002-000', '시험공단 본사 편의시설(세탁소) 운영자 모집', { source_type: 'g2b_bid', source_url: 'https://www.g2b.go.kr/link/R26BK09990002-000', bid_category: '용역' });
  await put('20261126100000011', '[인천] 시험서희스타힐스 1,2단지 입주민 편의시설 운영업체 선정 입찰공고(규칙 확인)');
  const now = async (no) => (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${no}`)).items[0].nowRule;
  const a = await now('20261126100000011');
  assert.equal(a.fit, '다짐'); assert.equal(a.direct, true, '운영업체 선정 = 즉시 검토'); assert.ok(a.matched.includes('편의시설'), JSON.stringify(a));
  for (const no of ['20261126100000010', 'R26BK09990001-000', 'R26BK09990002-000']) assert.equal((await now(no)).fit, null, no);
});

test('규칙을 바꾼 뒤 한 번(운영자 [지금 다시 판정] = 정기 실행과 같은 일): 최근 60일 분류 빈 운영 공고 상세 읽기 → 주민운동시설의 위탁 = 다짐 즉시 검토로 올림 · 60일 밖·병원 카페는 그대로', async () => {
  const r = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true, rules: true });
  assert.equal(r.probed >= 1, true, JSON.stringify(r)); assert.equal(r.gym >= 1, true, JSON.stringify(r));
  assert.equal(detailCalls(OLD), 1, '60일 안 운영 공고는 상세를 읽음'); assert.equal(detailCalls(FAR), 0, '60일 밖은 읽지 않음');
  const o = await rowOf(OLD);
  assert.equal(o.bid_category, GYM); assert.ok(o.category_probed_at); assert.equal(o.related, true); assert.equal(o.fit_business, '다짐'); assert.equal(o.classification, '즉시 검토');
  assert.ok(o.refound_at, '마감 전 = 다시 찾은 공고(입찰 목록·당일 메일)');
  assert.equal((await rowOf(FAR)).related, false);
  assert.equal((await rowOf('R26BK09990001-000')).related, false, '병원 편의시설 커피전문점은 그대로 관련 아님');
  // 결과 목록(단지·마감·마감 전 여부) — 플랫폼 공고 조회 ?refit=last
  const last = (await ctx.owner.ok('GET', '/api/platform/sales-notices?refit=last')).fitRulesRefit;
  assert.equal(last.version, r.version); assert.equal(last.done, true, '후보를 다 읽음');
  const got = last.raised.find((x) => x.no === OLD);
  assert.ok(got, JSON.stringify(last.raised)); assert.equal(got.complex, '시험단지'); assert.equal(got.open, true); assert.equal(got.fit, '다짐'); assert.match(got.deadline, new RegExp(`^${plus(5)}`));
  // 한 줄에 한 번 — 다시 돌려도 같은 공고 상세를 또 읽지 않음
  await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true, rules: true });
  assert.equal(detailCalls(OLD), 1);
  // 운영자만
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/sales-notices?refit=last')).status, 404);
});

test('K-apt 수집: 서희스타힐스 제목(상세 분류 없음) = 다짐 즉시 검토 · 운영업체만 있는 줄은 상세 분류(주민운동시설의 위탁)로 올림 · 편의시설물 광고·경비 위탁은 상세도 안 읽고 관련 아님', async () => {
  const run = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.match(run.summary, /분류 빈 운영 공고 상세 1건\(분류 받음 1 · 주민운동시설의 위탁 1\)/, run.summary);
  const a = await rowOf(A);
  assert.equal(a.related, true); assert.equal(a.fit_business, '다짐'); assert.equal(a.classification, '즉시 검토'); assert.deepEqual([...a.matched_keywords].sort(), ['운영업체', '편의시설'].sort());
  const b = await rowOf(B);
  assert.equal(b.bid_category, GYM); assert.equal(b.related, true); assert.equal(b.fit_business, '다짐'); assert.equal(b.classification, '즉시 검토');
  assert.equal((await rowOf(C)).related, false); assert.equal((await rowOf(D)).related, false);
  assert.equal(detailCalls(C), 0, '운영 맡김 말이 없는 줄은 상세를 읽지 않음'); assert.equal(detailCalls(D), 0, '경비 위탁은 읽지 않음');
  // 다짐 입찰 목록(전체 탭)에 보임 — 대표가 찾던 화면
  const items = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.map((x) => x.noticeNo);
  assert.ok(items.includes(A), '서희스타힐스 제목 공고가 입찰 목록에'); assert.ok(items.includes(B), '분류로 올린 공고도 입찰 목록에');
  assert.ok(!items.includes(C) && !items.includes(D));
  // 다음 수집에서도 그대로(저장된 분류로 판정 — 목록 줄의 빈 분류가 지우지 않음)
  // (관련이 된 뒤에는 마감 전 관련 공고 다시 확인(241차)이 상세를 읽음 — 분류 빈 줄 읽기는 한 번만: category_probed_at 그대로)
  const probedAt = b.category_probed_at;
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  const b2 = await rowOf(B); assert.equal(b2.bid_category, GYM); assert.equal(b2.related, true); assert.equal(b2.category_probed_at, probedAt, '분류 빈 줄 읽기는 한 번만');
});
