// #1181 상업화 마감 1(로컬 코드 점검 11/26 '공용 입찰 수집 검색어가 다짐 업종으로 고정'): 나라장터 정기 수집 = 다짐 검색어 + 입찰을 켠 다른 회사 검색어
// ① 다른 회사 검색어로도 4대상 검색 ② 그 공고는 그 회사 입찰 목록에 보이고 다짐 판정(관련)은 그대로 아님 ③ 다짐 검색어 검색은 그대로 ④ 입찰을 끈 회사·검색어 없는 회사 낱말은 안 씀
// 구조 시험(가짜 나라장터 서버) — 실제 나라장터 공고 수는 운영에서 확인해야 '완료'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3302;
let srv, ctx, sql, fake; const words = [];
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const dataGo = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
const bid = (no, title) => ({ bidNtceNo: no, bidNtceOrd: '000', bidNtceNm: title, ntceInsttNm: '시험1181시', dminsttNm: '시험1181시', bidNtceDt: `${plus(-1)} 09:00:00`, bidClseDt: `${plus(9)} 10:00:00`, opengDt: `${plus(9)} 11:00:00` });
const agree = { terms: true, age14: true, privacy: true, ai: true };

async function company(email, name, industry) {
  const c = new Client(email);
  const r = await c.ok('POST', '/api/auth/signup', { email, password: 'signup-pass-1234', name: '대표', mode: 'team', company: name, industry, agree });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const [t] = await sql`select tenant from users where email = ${email}`;
  await sql`update tenants set signup_status = 'approved' where id = ${t.tenant}`;
  await c.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  return { c, tenant: t.tenant };
}

before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, `http://localhost:${PORT}`); const send = (b) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(b); };
    const w = u.searchParams.get('bidNtceNm') ?? ''; if (u.pathname.includes('BidPublicInfoService/getBidPblancListInfo')) words.push(`${u.pathname.split('/').pop()}|${w}`);
    if (u.pathname.endsWith('getBidPblancListInfoServcPPSSrch') && w === '홈페이지') return send(dataGo([bid('R26BK1181001', '시험1181 시청 홈페이지 유지보수 용역')]));
    return send(dataGo([]));
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'test-key', PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50', SIGNUP_IP_PER_HOUR: '50' });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('다른 회사 검색어로도 받음 → 그 회사 입찰 목록에만 · 다짐 검색어·판정 그대로 · 입찰 끈 회사 낱말은 안 씀', async () => {
  const it = await company('ceo@it-1181.test', '아이티1181', 'IT·소프트웨어');
  await it.c.ok('PUT', '/api/sales/options', { bids: true });
  await it.c.ok('PUT', '/api/sales/digest/prefs', { keywords: ['홈페이지', '피트니스'], excludes: [], regions: [], issuers: [], itemCodes: [], amountMin: null, amountMax: null });
  await sql`delete from signup_attempts`;
  const off = await company('ceo@off-1181.test', '꺼둔회사1181', '제조');
  await off.c.ok('PUT', '/api/sales/options', { bids: false });
  await off.c.ok('PUT', '/api/sales/digest/prefs', { keywords: ['금형가공'], excludes: [], regions: [], issuers: [], itemCodes: [], amountMin: null, amountMax: null });

  const r = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.notEqual(r.status, 'failed', r.summary);
  assert.match(r.summary, /회사 검색어 1개 1건/, r.summary);
  for (const op of ['getBidPblancListInfoServcPPSSrch', 'getBidPblancListInfoThngPPSSrch', 'getBidPblancListInfoCnstwkPPSSrch']) assert.ok(words.includes(`${op}|홈페이지`), `${op} 회사 검색어`);
  assert.ok(words.includes('getBidPblancListInfoServcPPSSrch|피트니스'), '다짐 검색어는 그대로');
  assert.equal(words.filter((x) => x === 'getBidPblancListInfoServcPPSSrch|피트니스').length, 1, '다짐 검색어와 같은 회사 낱말은 한 번만');
  assert.ok(!words.some((x) => x.endsWith('|금형가공')), '입찰을 끈 회사 낱말은 안 씀');

  const [row] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = 'R26BK1181001-000'`;
  assert.ok(row, '공용 줄로 저장'); assert.equal(row.row.related ?? false, false, '다짐 판정(관련)은 그대로 아님');
  const list = (await it.c.ok('GET', '/api/sales/src?view=bids&tab=all')).items; const mine = list.map((x) => x.title);
  assert.ok(mine.includes('시험1181 시청 홈페이지 유지보수 용역'), `그 회사 입찰 목록: ${JSON.stringify(mine)}`);
  // #1181 상업화 마감 2: 그 회사 낱말 판정 — 제목에 검색어 = 즉시 검토 · 점수 60 · 영업 포인트
  const h = list.find((x) => x.title === '시험1181 시청 홈페이지 유지보수 용역');
  assert.deepEqual([h.category, h.fit, h.salesPoint], ['검토', 60, "제목에 '홈페이지'"]); // 로컬 11/26 기준 좁힘: 제목에 낱말 하나만 = 검토(즉시 검토는 한 가지 더 맞을 때)
  const base = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.map((x) => x.title);
  assert.ok(!base.includes('시험1181 시청 홈페이지 유지보수 용역'), '다짐(기본 회사) 목록에는 안 보임');
});
