// 대표 11/27(로컬 6~9·14 — "공고 제목으로만 판단하지 말고 공고문 내용까지 읽고 분석"):
// ① K-apt '관련 아님' 줄 중 분류 사업자-용역(시설 서비스 아님)·제목에 운영·위탁 말·마감 전 → 첨부 공고문 본문(목적·운영대상)으로 다시 판정 → '공고문 본문에서 찾음: …'
//    광고 자리 운영 본문(광고료·미디어보드)은 거름 · 경비 분류·공사 제목은 읽지 않음 · 다음 수집·다시 판정이 되돌리지 않음
// ② 공고문의 '현장설명 … 서명해야만 입찰 참여' → 현장설명 필수(K-apt 칸보다 먼저) ③ 서로 다른 값(입찰가 × 36개월 vs 24개월 vs 계약 2년 · 실적 800 vs 1,000세대) → 관리사무소에 물어볼 것
// ④ 운영자 조회 ?bodyfit=count — 날짜별 대상 수 (구조 시험 — 가짜 K-apt·글 파일. 실제 hwpx 공고문은 운영에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3298;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const plus = (n) => kst(new Date(Date.now() + n * 864e5));
// 강화 서희스타힐스 공고문 꼴(로컬이 읽은 본문 그대로의 구성 — 이름·숫자는 시험용)
const GOOD = `시험스타힐스 입주민 편의시설 위탁운영업체 선정 입찰공고
1. 목적: 본 단지 주민공동시설 위탁 운영업체를 선정하고자 합니다.
2. 운영대상: 커뮤니티 주민공동시설(피트니스, 독서실 등)
3. 입찰 참가자격
가. 자본금 5억원 이상 나. 최근 5년간 800세대 이상 주민공동시설 5개 이상 운영 완료 실적
4. 현장 설명회 일시 및 장소 : ${plus(5).slice(0, 4)}년 ${Number(plus(5).slice(5, 7))}월 ${plus(5).slice(8)}일(수) 09시 정각 (장소 : 관리사무소)\n   현장설명회 참석자는 명함을 제출하고 명단에 서명해야만 입찰에 참여할 수 있습니다.
5. 배치인원 : 3명(세부 내용은 산출 내역서 참조)
9. 마. 입찰서와 산출내역서를 함께 제출
9. 바. 입찰가는 인건비와 위탁수수료의 월간 산출 총금액에서 계약기간 36개월을 곱하여 산정함.
10. 계약기간 : 계약일로부터 2년
붙 임 : 1. 입찰서 양식 1부. 2. 일람표 1부. 4. 인건비 산출내역서 양식 1부.
붙임1) 입찰서
붙임4) 위탁운영 세부산출내역서
${'| 인건비 | 1 | 2,000,000 |\n'.repeat(20)}입 찰 금 액 | | 월청구금액 * 24개월
평가 비고: 최근 5년간 1,000세대 이상 단지 운영 실적 가점`;
const AD = `시험단지 공용시설 운영업체 선정 공고
1. 목적: 단지 커뮤니티 시설·승강기 미디어보드 광고 사업 운영업체 선정(최고가 낙찰)
2. 광고료는 36개월분을 선납`;
const B = { good: '20261127100000001', ad: '20261127100000002', guard: '20261127100000003', build: '20261127100000004', old: '20261127100000005', hil: '20261127100000006' };
const HIL = `시험단지 커뮤니티 출입 연동 시스템 용역\n1. 용역 범위: 주민공동시설 예약·결제 시스템(웹·모바일 앱·키오스크) 제공, 출입 통제 연동, 회원·이용료 정산, 유지보수\n2. 계약기간: 1년`;
const files = { [B.good]: [{ seq: 112701, fileName: '1. 입주민 편의시설 위탁운영업체 선정 입찰공고.txt', body: Buffer.from(GOOD) }], [B.ad]: [{ seq: 112702, fileName: '입찰공고.txt', body: Buffer.from(AD) }],
  [B.guard]: [{ seq: 112703, fileName: '입찰공고.txt', body: Buffer.from(GOOD) }], [B.build]: [{ seq: 112704, fileName: '입찰공고.txt', body: Buffer.from(GOOD) }], [B.hil]: [{ seq: 112706, fileName: '입찰공고.txt', body: Buffer.from(HIL) }] };
const detail = (cat) => `<table class="contTbl"><tbody><tr> <th scope="col">입찰분류</th> <td> ${cat} </td> <th scope="col">입찰종류</th> <td> 제한경쟁 </td> </tr></tbody></table>`;
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const TGOOD = '[인천] 시험스타힐스 공용시설 운영업체 선정 입찰공고';
let srv, ctx, sql, fake, kapt;
const rowOf = async (ext) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${ext}`)[0]?.row;
const put = async (ext, title, o = {}) => {
  const id = randomUUID();
  const row = { id, source_type: 'kapt_bid', source_external_id: ext, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${ext}`, title, issuer: '시험단지', facility_name: '시험단지', current_status: '진행중', notice_state: '신규공고', notice_kind: 'new',
    posted_date: plus(-1), deadline_at: `${plus(11)}T17:00:00+09:00`, first_seen_at: new Date().toISOString(), related: false, fit_business: null, matched_keywords: [], classification: '참고(비관련)', ...o };
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json(row)}, 'workin')`; return id;
};
const fileCalls = (bid) => kapt.calls.filter((c) => c.path === '/kapt/bid/bidFileListData.do' && String(c.body ?? '').includes(bid)).length + kapt.calls.filter((c) => c.path === '/kapt/cmm/file/BID/fileDownload.do' && files[bid]?.some((f) => String(f.seq) === c.q.key)).length;

before(async () => {
  kapt = fakeKapt({ files, detailHtml: (bid) => (bid === B.old ? detail('사업자 - 용역 - 기타') : '') });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? tr(B.good, ['1', 'K-apt', '적격심사', TGOOD, `${plus(11)} 17:00`, '신규공고', '시험스타힐스', `${plus(-1)} 10:25`]) : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    // 로컬 11/27 24번: kg2b_ 줄은 KG2B 상세(공고문 goLoad)를 먼저 읽고 그 공고문으로 본문 판정
    if (u.pathname === '/kg2b/user/bid_list/KaptBidView') return send(200, `<html><body><table><tr><th>공고번호</th><td>K-2026-1127</td></tr><tr><th>현장설명회 실시유무</th><td>필수</td></tr></table>
<a href="javascript:goLoad('20261127/','AB12CD.txt','bid','입찰공고문.txt');">입찰공고문.txt</a></body></html>`);
    if (u.pathname === '/kg2b/common/util/download') { res.statusCode = 200; res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent('입찰공고문.txt')}`); return res.end(Buffer.from(GOOD)); }
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await put(B.good, TGOOD, { bid_category: '사업자 - 용역 - 기타' });
  await put(B.ad, '[서울] 시험단지 공용시설 운영업체 선정(2)', { bid_category: '사업자 - 용역 - 기타' });
  await put(B.guard, '[서울] 시험단지 경비 운영업체 선정', { bid_category: '사업자 - 용역 - 경비' });
  await put(B.build, '[서울] 시험단지 운영업체 사무실 보수공사', { bid_category: '사업자 - 공사 - 기타' });
  await put(B.old, '[경기] 시험단지 공용시설 운영 사업자 선정', {});
  await put(B.hil, '[인천] 시험단지 커뮤니티 출입 연동 시스템 용역 사업자 선정', { bid_category: '사업자 - 용역 - 지능형홈네트워크' });
  await put('kg2b_143707', '[경기] 시험케이지단지 공용시설 운영업체 선정', { bid_category: '사업자 - 용역 - 기타' }); // 분류 빈 줄 — 상세에서 분류를 받고(파일 없음) 본문은 '첨부 공고문 없음'
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('순수 함수: 본문 판정·현장설명 필수·서로 다른 값', async () => {
  const F = await import('../../src/lib/sales/bodyFit.ts').catch(() => null);
  if (!F) return; // .ts 가 다른 모듈을 불러 Node 형식 제거로 못 읽으면 API 시험으로만(아래)
  assert.equal(F.docBriefing(GOOD).kind, '필수');
  assert.equal(F.docBriefing('4. 현장설명: 없음').kind, '없음');
});

test('공고문 본문 판정(운영자 [지금 읽기] = 정기 실행과 같은 일): 본문의 주민공동시설·피트니스로 다짐 즉시 검토 · 광고 본문·경비 분류·공사 제목은 그대로', async () => {
  const r = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true, body: true });
  assert.ok(r.bodyFit.done >= 3, JSON.stringify(r.bodyFit)); assert.equal(r.bodyFit.raised, 3, JSON.stringify(r.bodyFit));
  const g = await rowOf(B.good);
  assert.equal(g.related, true); assert.equal(g.fit_business, '다짐'); assert.equal(g.classification, '즉시 검토'); assert.ok(g.refound_at, '마감 전 = 다시 찾은 공고');
  assert.match(g.body_fit.why, /^공고문 본문에서 찾음: /); assert.ok(g.body_fit.words.some((w) => /주민공동|피트니스|독서실|커뮤니티/.test(w)), JSON.stringify(g.body_fit));
  assert.equal(g.doc_briefing_kind, '필수'); assert.match(g.doc_briefing_label, /서명해야만 입찰에 참여/);
  // 로컬 11/27 21번: 곱하는 개월 수는 출처별(본문·산출내역서), 계약 기간은 따로
  assert.ok(g.doc_checks.includes('입찰가·계약 개월 수가 서로 다름: 금액 곱하기 36개월(본문) · 금액 곱하기 24개월(산출내역서) · 계약 2년'), JSON.stringify(g.doc_checks));
  // 22번: 공고문 현장설명 일시·장소
  assert.equal(g.doc_briefing_at, `${plus(5)}T09:00:00+09:00`); assert.equal(g.doc_briefing_place, '관리사무소');
  assert.ok(g.doc_checks.some((x) => /실적 세대 기준이 서로 다름: 800세대 · 1,000세대/.test(x)), JSON.stringify(g.doc_checks));
  const a = await rowOf(B.ad); assert.equal(a.related, false); assert.match(a.body_fit.skip, /광고/);
  const gd = await rowOf(B.guard); assert.equal(gd.related, false); assert.equal(gd.body_fit, undefined, '경비 제목은 대상 아님');
  assert.equal(fileCalls(B.guard), 0); assert.equal(fileCalls(B.build), 0, '공사 제목·분류는 공고문을 받지 않음');
  const o = await rowOf(B.old); assert.equal(o.bid_category, '사업자 - 용역 - 기타', '분류 빈 줄은 상세에서 분류를 받음'); assert.equal(o.body_fit.error, '첨부 공고문 없음'); assert.equal(o.related, false);
  // 카드: 까닭·현장설명 필수·관리사무소에 물어볼 것
  const card = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => x.noticeNo === B.good);
  assert.ok(card, '입찰 목록에 보임'); assert.match(card.bodyWhy, /^공고문 본문에서 찾음/); assert.equal(card.briefing?.required, true); assert.equal(card.docChecks.length, 2);
  assert.equal(card.briefing?.at, `${plus(5)}T09:00:00+09:00`); assert.equal(card.briefing?.place, '관리사무소');
  // 23번 ③: 하이링크도 본문으로 — 제목은 '시스템' 때문에 다짐에서 빠지고 하이링크 낱말이 없던 공고
  const k = await rowOf('kg2b_143707'); assert.equal(k.related, true, JSON.stringify(k.body_fit)); assert.equal(k.fit_business, '다짐'); assert.ok(k.kg2b_read_at, 'KG2B 상세를 읽음'); assert.equal(k.kg2b_briefing_kind, '필수');
  assert.equal(k.attachment_urls?.[0]?.name, '입찰공고문.txt'); assert.equal(k.body_fit.file, '입찰공고문.txt');
  const h = await rowOf(B.hil); assert.equal(h.related, true, JSON.stringify(h.body_fit)); assert.equal(h.fit_business, '하이링크'); assert.match(h.body_fit.why, /예약·결제시스템|키오스크/);
  // 한 공고에 한 번 — 다시 돌려도 받지 않음
  const n = fileCalls(B.good); await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true, body: true }); assert.equal(fileCalls(B.good), n);
});

test('다음 수집·다시 판정이 본문으로 올린 공고를 되돌리지 않음 · 운영자 대상 수 조회', async () => {
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {}); // 목록에 같은 공고(제목만으로는 관련 아님)
  const g = await rowOf(B.good); assert.equal(g.related, true, '수집이 되돌리지 않음'); assert.equal(g.fit_business, '다짐');
  await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true, days: 60 });
  assert.equal((await rowOf(B.good)).related, true, '다시 판정이 되돌리지 않음');
  const c = (await ctx.owner.ok('GET', '/api/platform/sales-notices?bodyfit=count')).bodyFit;
  const today = c.find((x) => x.day === kst(new Date()));
  assert.ok(today && today.titles >= 5 && today.raised === 3, JSON.stringify(c));
});
