// 252차 #786(대표 10/29 00:20 "입찰 참가자격 요건(자본금·기술인력·실적 등)이 공고상에 적혀 있다 — 그걸 표기, 지금은 적격심사 같은 입찰 종류가 적혀 있음"):
// 첨부 공고문에서 '참가자격' 절 자르기(원문 그대로) · 요건 항목 뽑기(AI 없음) · 목록 '참가자격' 한 줄 + 원문 · '입찰 방식' 따로 · 못 찾은 이유 · 정기 실행 채우기 · 정정(첨부 바뀜) 다시 읽기 · 당일 메일·공고 조회 같은 말
// (구조 시험 — 가짜 K-apt·가짜 파일 서버. 실제 공고문(hwp·pdf) 읽기는 운영에서 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const E = await import('../../src/lib/sales/eligibilityText.ts'); // 다른 모듈을 안 부르는 잎 모듈 — Node 22 형식 제거로 .ts 직접
const PORT = 3282;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
// 대표가 준 세 가지 꼴(K-apt 주민운동시설 공고 · 나라장터식 '입찰참가자격(입찰공고일 현재기준)' · 국토부 고시 + 현장설명 참가)
const A = `4. 입찰방법\n가. 적격심사 제한경쟁입찰\n5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n나. 공고일 현재 주민운동시설 위탁운영 등록업체로서 자본금 5억원 이상인 업체\n6. 제출서류\n가. 입찰서`;
const B = `7. 입찰방법 : 제한경쟁\n8. 입찰참가자격(입찰공고일 현재기준)\n‣ 선정지침 제26조 제1항 각 호에 해당하지 않는 자\n가. 사업실적 : 최근 5년간 공사 실적 5건\n나. 기술능력 : 소프트웨어사업자, 정보통신공사업 면허를 보유한 업체\n다. 공동도급은 불가함\n9. 현장설명회\n가. 일시`;
const C = `3. 현장설명 : 2026. 11. 2.\n4. 입찰 참가자격\n가. 국토교통부고시 제2024-196호 제26조 ①항에 해당하지 않는 업체\n나. 현장설명회에 참가한 업체\n5. 입찰서 제출`;
const COMMON = `5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n6. 제출서류`;
const LINE_A = '자본금 5억 이상 · 주민운동시설 위탁운영 등록업체';

test('자르기·뽑기(규칙): 세 가지 공고문 꼴 → 절(머리부터 다음 번호 앞까지, 원문 그대로) · 요건 항목 · 한 줄(공통 문구 제26조는 줄에서 빼고 원문엔 남김)', () => {
  const a = E.eligibilitySection(A);
  assert.equal(a, '5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n나. 공고일 현재 주민운동시설 위탁운영 등록업체로서 자본금 5억원 이상인 업체');
  assert.deepEqual(E.eligibilityItems(a), [{ k: 'capital', label: '자본금 5억 이상' }, { k: 'license', label: '주민운동시설 위탁운영 등록업체' }]);
  assert.equal(E.eligibilityLine(E.eligibilityItems(a), a), LINE_A);
  const flat = A.replace(/\n/g, ' '); // 한 줄로 이어진 공고문(hwp 표에서 뽑힌 글)
  assert.equal(E.eligibilityLine(E.eligibilityItems(E.eligibilitySection(flat)), E.eligibilitySection(flat)), LINE_A);
  const b = E.eligibilitySection(B);
  assert.ok(b.startsWith('8. 입찰참가자격(입찰공고일 현재기준)') && b.endsWith('다. 공동도급은 불가함') && !b.includes('현장설명회'), b);
  assert.deepEqual(E.eligibilityItems(b), [{ k: 'license', label: '소프트웨어사업자·정보통신공사업 면허' }, { k: 'perf', label: '실적 최근 5년 공사 5건' }, { k: 'joint', label: '공동도급 불가' }]);
  assert.equal(E.eligibilityLine(E.eligibilityItems(b), b), '실적 최근 5년 공사 5건 · 소프트웨어사업자·정보통신공사업 면허 · 공동도급 불가', '자본금 → 실적 → 면허 → … 순');
  const c = E.eligibilitySection(C);
  assert.equal(c, '4. 입찰 참가자격\n가. 국토교통부고시 제2024-196호 제26조 ①항에 해당하지 않는 업체\n나. 현장설명회에 참가한 업체', "앞의 '3. 현장설명'·뒤의 '5. 입찰서 제출'은 절 밖");
  assert.deepEqual(E.eligibilityItems(c), [{ k: 'briefing', label: '현장설명 참가 업체' }]);
  // 인력·신용·지역 · 본문 속 '참가자격이 없는 자'는 머리가 아님
  const d = E.eligibilitySection('입찰 유의사항: 참가자격이 없는 자의 입찰은 무효로 한다.\n□ 참가자격의 제한\n○ 생활체육지도자 2명 이상 보유, 신용평가등급 BB 이상, 경기도 내 본사 소재 업체\n□ 제출서류');
  assert.equal(E.eligibilityLine(E.eligibilityItems(d), d), '생활체육지도자 2명 이상 · 신용등급 BB 이상 · 경기도 소재');
  // 공통 문구만 있으면 뽑을 요건 없음 · 절이 없으면 null
  assert.deepEqual(E.eligibilityItems(E.eligibilitySection(COMMON)), []);
  assert.equal(E.eligibilityLine([], E.eligibilitySection(COMMON)), null);
  assert.equal(E.eligibilitySection('입찰 유의사항: 참가자격이 없는 자의 입찰은 무효로 한다.'), null);
  assert.ok(E.eligibilitySection('x\n'.repeat(5) + A + '\n' + '가나다 '.repeat(800)).length <= 1500);
  // 나라장터 API 칸 — 공고문에서 같은 종류를 뽑았으면 겹쳐 안 씀 · 코드 번호·같은 이름 한 번
  assert.deepEqual(E.apiExtra({ license_limit: '체육시설업(4993) / 체육시설업', region_restriction: '경기도 · 서울특별시' }, []), ['업종 체육시설업', '지역 경기도·서울특별시']);
  assert.deepEqual(E.apiExtra({ license_limit: '정보통신공사업(0036)', region_restriction: '경기도' }, E.eligibilityItems(b)), ['지역 경기도']);
  assert.equal(E.eligSay({ error: '첨부 공고문 없음' }), '공고문에서 참가자격을 못 찾음 — 원문 확인(이유: 첨부 공고문 없음)');
  assert.equal(E.eligSay({ line: '업종 체육시설업', error: '글 뽑기 오류' }), '업종 체육시설업 · 공고문에서 참가자격을 못 찾음 — 원문 확인(이유: 글 뽑기 오류)');
});

// ---- 공고문 읽기(정기 실행·다시 읽기) ----
const N = {
  KA: { id: '00000000-0000-4000-8000-000000252001', bid: 'E252001', files: [{ seq: 25201, fileName: '과업지시서.txt', body: Buffer.from('과업 내용\n1. 헬스장 운영\n2. 참가자격 확인 서류 제출') }, { seq: 25202, fileName: '입찰공고문.txt', body: Buffer.from(A) }] },
  KB: { id: '00000000-0000-4000-8000-000000252002', bid: 'E252002', files: [{ seq: 25203, fileName: '입찰공고문.hwp' }] }, // 가짜 hwp — 글을 못 뽑음
  KC: { id: '00000000-0000-4000-8000-000000252003', bid: 'E252003', files: [] },
  KD: { id: '00000000-0000-4000-8000-000000252004', bid: 'E252004', files: [{ seq: 25204, fileName: '입찰공고문.txt', body: Buffer.from(COMMON) }] },
  CLOSED: { id: '00000000-0000-4000-8000-000000252005', bid: 'E252005', files: [{ seq: 25205, fileName: '입찰공고문.txt', body: Buffer.from(A) }], closed: true },
  OTHER: { id: '00000000-0000-4000-8000-000000252006', bid: 'E252006', files: [{ seq: 25206, fileName: '입찰공고문.txt', body: Buffer.from(A) }], unrelated: true },
};
const G = { id: '00000000-0000-4000-8000-000000252010', no: 'R26BK252010-000' };
const docs = { '/g2b/notice-b.txt': B, '/g2b/notice-c.txt': C };
let srv, ctx, sql, fake;
const rowOf = async (id) => (await sql`select row from sales_src_rows where src_id = ${id}`)[0]?.row;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); };
const put = (id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, ...row })}, 'workin')`;

before(async () => {
  const files = Object.fromEntries(Object.values(N).map((o) => [o.bid, o.files]));
  const kapt = fakeKapt({ files });
  fake = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const u = new URL(req.url, 'http://x');
    if (docs[u.pathname]) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('입찰공고서.txt')}` }); return res.end(Buffer.from(docs[u.pathname])); }
    if (kapt.handle(req, res, body)) return;
    res.writeHead(404); res.end('nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, SALES_ELIGIBILITY: 'on' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${plus(-1)}, '[]', '{}', 1, 1, ${new Date(`${plus(-1)}T08:00:00+09:00`)})`;
  for (const [k, o] of Object.entries(N)) await put(o.id, { source_type: 'kapt_bid', source_external_id: o.bid, title: `[경기] 시험252 ${k} 단지 주민운동시설 위탁운영 사업자 선정`, issuer: `시험252 ${k} 단지`, related: !o.unrelated, fit_business: '다짐', classification: '검토',
    current_status: '공고중', notice_kind: 'new', posted_date: today, deadline_at: `${o.closed ? plus(-2) : plus(10)}T17:00:00+09:00`, first_seen_at: new Date().toISOString(), award_method: '적격심사', contract_method: '제한경쟁' });
  await put(G.id, { source_type: 'g2b_bid', source_external_id: G.no, title: '시험252 체육센터 출입통제 시스템 구축 공사', issuer: '시험252 시청', related: true, fit_business: '하이링크', classification: '검토', current_status: '공고중', notice_kind: 'new',
    posted_date: today, deadline_at: `${plus(8)}T10:00:00+09:00`, first_seen_at: new Date().toISOString(), license_limit: '정보통신공사업(0036)', region_restriction: '경기도',
    attachment_urls: [{ name: '입찰공고서.txt', url: `http://127.0.0.1:${PORT}/g2b/notice-b.txt` }, { name: '과업지시서.hwp', url: `http://127.0.0.1:${PORT}/g2b/task.hwp` }] });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('정기 실행: 열린 관련 공고만 읽음(마감 지남·관련 아님 제외) · 공고문일 법한 파일 먼저 · 원문·항목·한 줄·파일 이름 저장 · 나라장터는 API 지역을 합침 · 못 찾으면 이유', async () => {
  await tick();
  const ka = (await rowOf(N.KA.id)).eligibility;
  assert.equal(ka.text, E.eligibilitySection(A)); assert.equal(ka.line, LINE_A); assert.equal(ka.error, null);
  assert.equal(ka.file?.name, '입찰공고문.txt', '과업지시서보다 공고문 먼저'); assert.ok(ka.text.includes('제26조'), '원문엔 공통 문구 그대로');
  const g = (await rowOf(G.id)).eligibility;
  assert.equal(g.line, '실적 최근 5년 공사 5건 · 소프트웨어사업자·정보통신공사업 면허 · 공동도급 불가 · 지역 경기도', '공고문에서 면허를 뽑았으니 API 업종은 겹쳐 안 씀, 지역은 합침');
  const kb = (await rowOf(N.KB.id)).eligibility;
  assert.equal(kb.text, null); assert.ok(kb.error && kb.tries === 1, JSON.stringify(kb));
  assert.equal((await rowOf(N.KC.id)).eligibility.error, '첨부 공고문 없음');
  assert.equal((await rowOf(N.KD.id)).eligibility.line, '공통 자격(사업자선정지침)만 적힘 — 별도 요건 없음');
  assert.equal((await rowOf(N.CLOSED.id)).eligibility, undefined, '마감 지난 공고는 안 읽음');
  assert.equal((await rowOf(N.OTHER.id)).eligibility, undefined, '관련 아닌 공고는 안 읽음');
  // 다시 돌아도 같은 공고는 안 읽음(못 읽은 것도 20시간 뒤에)
  const at = ka.readAt; await tick();
  assert.equal((await rowOf(N.KA.id)).eligibility.readAt, at); assert.equal((await rowOf(N.KB.id)).eligibility.tries, 1);
  await sql`update sales_src_rows set row = jsonb_set(row, '{eligibility,readAt}', to_jsonb(${new Date(Date.now() - 21 * 36e5).toISOString()}::text)) where src_id = ${N.KB.id}`;
  await tick();
  assert.equal((await rowOf(N.KB.id)).eligibility.tries, 2, '못 읽은 공고는 20시간 뒤 다시(3번까지)');
});

test('정정(첨부가 바뀜) → 다시 읽음 · [공고문 다시 읽기] API', async () => {
  await sql`update sales_src_rows set row = row || ${sql.json({ attachment_urls: [{ name: '정정 입찰공고서.txt', url: `http://127.0.0.1:${PORT}/g2b/notice-c.txt` }] })} where src_id = ${G.id}`;
  await tick();
  const g = (await rowOf(G.id)).eligibility;
  assert.equal(g.line, '현장설명 참가 업체 · 업종 정보통신공사업 · 지역 경기도', '정정 공고문으로 다시 — 면허를 못 뽑았으니 API 업종을 합침');
  const r = await ctx.owner.ok('POST', '/api/sales/eligibility', { id: N.KC.id });
  assert.deepEqual([r.eligibility.text, r.eligibility.error], [null, '첨부 공고문 없음']);
  assert.equal((await ctx.owner.req('POST', '/api/sales/eligibility', { id: '00000000-0000-4000-8000-0000002520ff' })).status, 404);
});

test("화면 자료·공고 조회·당일 메일: '참가자격' 한 줄과 원문 · '입찰 방식'(적격심사·제한경쟁)은 따로 · 못 찾음은 이유와 함께 같은 말", async () => {
  const items = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items;
  const ka = items.find((x) => x.noticeNo === N.KA.bid), kc = items.find((x) => x.noticeNo === N.KC.bid);
  assert.deepEqual([ka.elig.line, ka.elig.file, ka.terms], [LINE_A, '입찰공고문.txt', '적격심사 · 제한경쟁']);
  assert.equal(ka.elig.text, E.eligibilitySection(A)); assert.equal(ka.detail.qualification, ka.elig.text);
  assert.deepEqual([kc.elig.line, kc.elig.error], [null, '첨부 공고문 없음']);
  const it = (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${N.KA.bid}`)).items[0];
  assert.deepEqual([it.eligibility?.say, it.eligibility?.file?.name, it.eligibility?.due, it.terms], [LINE_A, '입찰공고문.txt', false, '적격심사 · 제한경쟁']);
  const d = await ctx.owner.ok('GET', '/api/sales/digest');
  const da = d.items.find((x) => x.noticeNo === N.KA.bid), dc = d.items.find((x) => x.noticeNo === N.KC.bid);
  assert.ok(da && dc, JSON.stringify(d.items.map((x) => x.noticeNo)));
  assert.equal(da.elig, LINE_A); assert.equal(dc.elig, '공고문에서 참가자격을 못 찾음 — 원문 확인(이유: 첨부 공고문 없음)');
  const text = (await ctx.owner.req('GET', '/api/sales/digest?preview=text')).body;
  assert.ok(text.includes(`참가자격: ${LINE_A}`), text);
  const html = (await ctx.owner.req('GET', '/api/sales/digest?preview=html')).body;
  assert.ok(html.includes('data-digest-elig="1"') && html.includes(LINE_A));
});
