// 381차 #1008(대표 11/07 "지자체·공공 시설 관리위탁 규칙을 켜 주세요 — 단 놀이터는 우리가 위탁하지 않음"): 372차 미리 보기 규칙을 판정(matchFit)에 넣음.
// 캠핑장·야영장·파크골프·체육공원 같은 공공 시설의 관리위탁·운영자 모집 = 다짐(즉시 검토) · 놀이터·조경·매점·카페는 아님 · 정기 수집도 이 검색어(용역·기타)로 받음
// 구조 시험(가짜 나라장터 서버) — 실제 나라장터 연동 확인이 아님
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3301;
let srv, ctx, sql, fake; const words = [];
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const dataGo = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
const bid = (no, title) => ({ bidNtceNo: no, bidNtceOrd: '000', bidNtceNm: title, ntceInsttNm: '시험1008시', dminsttNm: '시험1008시', bidNtceDt: `${plus(-1)} 09:00:00`, bidClseDt: `${plus(9)} 10:00:00`, opengDt: `${plus(9)} 11:00:00` });
// [제목, 지금 규칙 판정]
const T = {
  R26BK1008001: ['시험1008 오토캠핑장 관리위탁 운영자 모집', '다짐'],
  R26BK1008002: ['시험1008 엄마까투리 상상놀이터 관리위탁 운영자 모집', null],
  R26BK1008003: ['시험1008 어린이공원 놀이터 관리위탁 수탁자 모집', null],
  R26BK1008004: ['시험1008 근린공원 조경 관리위탁', null],
  R26BK1008005: ['시험1008 체육공원 매점 운영자 모집', null],
  R26BK1008006: ['시험1008 공원 카페 위탁운영자 모집', null],
  R26BK1008007: ['시험1008 강변 야영장 위탁운영자 모집 공고', '다짐'],
  R26BK1008008: ['시험1008 파크골프장 관리위탁 수탁기관 모집', '다짐'],
  R26BK1008009: ['시험1008 체육공원 수영장·놀이터 관리위탁', '다짐'],
  R26BK1008010: ['시험1008 캠핑장 관리운영 위탁 콜센터 용역', null],
};
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${PORT}`); const send = (b) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(b); };
    const w = u.searchParams.get('bidNtceNm') ?? ''; if (u.pathname.includes('BidPublicInfoService/getBidPblancListInfo')) words.push(`${u.pathname.split('/').pop()}|${w}`);
    if (u.pathname.endsWith('getBidPblancListInfoEtcPPSSrch') && w === '관리위탁') return send(dataGo(['R26BK1008001', 'R26BK1008002', 'R26BK1008004'].map((n) => bid(n, T[n][0]))));
    if (u.pathname.endsWith('getBidPblancListInfoServcPPSSrch') && w === '위탁운영자') return send(dataGo([bid('R26BK1008007', T.R26BK1008007[0])]));
    return send(dataGo([]));
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'test-key' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('지금 규칙(플랫폼 조회): 공공 시설 관리위탁·운영자 모집 = 다짐 · 놀이터·조경·매점·카페·콜센터는 아님', async () => {
  for (const [no, [title]] of Object.entries(T)) {
    const id = randomUUID();
    await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'g2b_bid', source_external_id: `${no}-000`, title, bid_category: '기타',
      current_status: '진행중', notice_kind: 'new', posted_date: plus(-2), deadline_at: `${plus(8)}T10:00:00+09:00`, first_seen_at: new Date(Date.now() - 2 * 864e5).toISOString(), related: false, fit_business: null, matched_keywords: [] })})`;
  }
  for (const [no, [title, want]] of Object.entries(T)) {
    const r = (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${no}-000`)).items[0].nowRule;
    assert.equal(r.fit, want, `${title} → ${JSON.stringify(r)}`);
    if (want) assert.equal(r.direct, true, `${title}: 운영을 맡기는 공고 = 즉시 검토`);
    if (/오토캠핑장|야영장/.test(title)) assert.equal(r.pub, true, `${title}: 공공 시설 위탁 규칙으로 잡힘`);
  }
  // 다시 판정(수집기 실행 때도 돎): 관련 아님으로 저장된 공공 시설 위탁 4건을 올림 · 놀이터 등은 그대로
  const rf = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.equal(rf.raised, 4, JSON.stringify(rf));
  const rows = await sql`select row from sales_src_rows where tbl = 'procurement_notices'`;
  for (const { row } of rows) assert.equal(row.fit_business ?? null, T[row.source_external_id.replace(/-000$/, '')][1], row.title);
  await sql`delete from sales_src_rows where tbl = 'procurement_notices'`;
});

test('정기 수집: 공공 시설 위탁 검색어(용역·기타, 놀이터 없음)로 받아 캠핑장·야영장은 관련 · 놀이터·조경은 받아도 관련 아님', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.notEqual(r.status, 'failed', r.summary);
  assert.match(r.summary, /공공 시설 위탁 검색 4건\(관련 2\)/, r.summary);
  for (const w of ['관리위탁', '위탁관리', '운영자 모집', '위탁운영자', '수탁자', '캠핑장', '야영장', '파크골프']) {
    assert.ok(words.includes(`getBidPblancListInfoEtcPPSSrch|${w}`) && words.includes(`getBidPblancListInfoServcPPSSrch|${w}`), `검색어 ${w} 용역·기타`);
  }
  assert.ok(!words.some((x) => x.endsWith('|놀이터')), "'놀이터'는 검색하지 않음");
  const rows = Object.fromEntries((await sql`select row from sales_src_rows where tbl = 'procurement_notices'`).map(({ row }) => [row.source_external_id.replace(/-000$/, ''), row]));
  assert.equal(rows.R26BK1008001?.related, true); assert.equal(rows.R26BK1008001.fit_business, '다짐');
  assert.equal(rows.R26BK1008007?.related, true); assert.equal(rows.R26BK1008007.fit_business, '다짐');
  assert.equal(rows.R26BK1008002?.related ?? false, false, '놀이터는 받아도 관련 아님');
  assert.equal(rows.R26BK1008004?.related ?? false, false, '조경 관리위탁은 관련 아님');
  // 영업기회 입찰 목록에 캠핑장·야영장이 보이고 놀이터는 안 보임
  const items = (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent('시험1008')}`)).items.map((x) => x.title);
  assert.ok(items.some((t) => /오토캠핑장/.test(t)) && items.some((t) => /야영장/.test(t)), JSON.stringify(items));
  assert.ok(!items.some((t) => /놀이터/.test(t)), JSON.stringify(items));
});
