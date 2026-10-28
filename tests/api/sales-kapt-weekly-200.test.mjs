// 200차(대표 10/26 #699·#678): 신규 공동주택 단지 1순위 원천 — K-apt 자료실 「관리비공개의무단지 기본정보」 주 1회 엑셀 수집기 · 한국부동산원 줄과 합치기 · 원본 기준일
// 가짜 K-apt 화면 서버(세션 쿠키·CSRF·글 보기 뒤에만 파일 목록)와 K-apt 와 같은 꼴(인라인 문자열·한글 &#NNNNN;)의 엑셀로 보는 구조 시험 — 실제 K-apt 화면 동작은 운영에서 따로 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { deflateRawSync } from 'node:zlib';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3271;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const plus = (n) => kst(new Date(Date.now() + n * 864e5));
const ymd8 = (s) => s.replace(/-/g, '');
let srv, ctx, sql, fake; const hits = [];

// ---- K-apt 꼴 엑셀(xlsx) 만들기: 1줄 안내 · 2줄 칸 이름 · 3줄부터 단지(글자는 &#NNNNN;) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), comp = deflateRawSync(f.data), crc = crc32(f.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const ent = (s) => [...String(s)].map((ch) => (ch.charCodeAt(0) > 127 ? `&#${ch.codePointAt(0)};` : ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch)).join('');
const col = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const HEAD = ['시도', '시군구', '읍면', '동리', '단지코드', '단지명', '단지분류', '법정동주소', '우편번호', '도로명주소', '분양형태', '사용승인일', '가입일', '동수', '세대수', '관리방식', '시공사', '주택관리업자', '관리사무소 연락처', '부대복리시설', '주민운동시설', '최고층수'];
function xlsx(rows, head = HEAD) {
  const all = [['해당 자료는 매주 금요일에 추출한 자료이며, 단지 기본정보는 주 1회 갱신되고 있습니다.'], head, ...rows.map((r) => head.map((h) => r[h] ?? ''))];
  const sheet = `<?xml version="1.0" encoding="UTF-8"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData>\n` +
    all.map((r, ri) => `<row r="${ri + 1}">\n${r.map((v, ci) => `<c r="${col(ci)}${ri + 1}"${v === '' ? '></c>' : ` t="inlineStr"><is><t>${ent(v)}</t></is></c>`}`).join('')}</row>\n`).join('') + '</sheetData></worksheet>';
  return zip([{ name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="sheet1" r:id="rId3" sheetId="1"/></sheets></workbook>') }, { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst count="0" uniqueCount="0"/>') }, { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) }]);
}
const C = (o) => ({ 시도: '경기도', 시군구: '구리시', 동리: '인창동', 단지분류: '아파트', 분양형태: '분양', 관리방식: '위탁관리', 시공사: '좋은건설', ...o });
const K1 = C({ 단지코드: 'A10000001', 단지명: '구리새단지시그니처아파트', 법정동주소: '경기도 구리시 인창동 100 구리새단지시그니처아파트', 도로명주소: '경기도 구리시 인창로 1', 사용승인일: ymd8(plus(-60)), 가입일: ymd8(plus(-50)), 동수: '7', 세대수: '752.0', 주택관리업자: '(주)좋은관리', '관리사무소 연락처': '0315551234', 부대복리시설: '관리사무소, 주민공동시설', 주민운동시설: '헬스장, 골프연습장', 최고층수: '39' });
const K2 = C({ 단지코드: 'A10000002', 단지명: '수택예정단지', 법정동주소: '경기도 구리시 수택동 5 수택예정단지', 도로명주소: '경기도 구리시 수택로 5', 사용승인일: ymd8(plus(90)), 동수: '3', 세대수: '300.0', 관리방식: '자치관리', 주택관리업자: '', '관리사무소 연락처': '021234567' });
const K3 = C({ 단지코드: 'A10000003', 단지명: '오래된단지', 법정동주소: '경기도 구리시 교문동 9 오래된단지', 사용승인일: '20040517', 세대수: '500.0' });
// 한국부동산원 줄로 먼저 들어와 있는 같은 단지(부동산원 단지 번호 키) — 지역 + 단지명 + 사용승인일이 같음
const K4 = C({ 단지코드: 'A10000004', 단지명: '역삼같은단지아파트', 시도: '서울특별시', 시군구: '강남구', 동리: '역삼동', 법정동주소: '서울특별시 강남구 역삼동 5 역삼같은단지아파트', 도로명주소: '서울특별시 강남구 역삼로 5', 사용승인일: ymd8(plus(-200)), 세대수: '512.0', 주택관리업자: '한빛관리(주)', '관리사무소 연락처': '0234561234' });
const posts = [{ seq: '900002', day: '2026.10.26.', file: '20261026_단지_기본정보.xlsx', rows: [K1, K2, K3, K4] }, { seq: '900001', day: '2026.10.23.', file: '20261023_단지_기본정보.xlsx', rows: [K3] }];
const sessions = new Map(); let sid = 0; let csrfOff = false;
const REB_CSV = () => `﻿단지고유번호,주소,단지명_공시가격,단지종류,세대수,동수,사용승인일,도로명주소\nR-77,서울특별시 강남구 역삼동 5,역삼같은단지,1,500,5,${plus(-200)},서울특별시 강남구 역삼로 5\n`;
const run = (slug = 'kapt_weekly_complexes') => ctx.owner.ok('POST', `/api/sales/collectors/${slug}/run`, {});
const H = (p) => hits.filter((h) => h.path === p).length;
const fac = async (where) => (await sql`select src_id, row from sales_src_rows where tbl = 'operating_facility_prospects' and not gone`).map((r) => ({ id: r.src_id, ...r.row })).filter(where);

before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString('utf8');
    hits.push({ path: u.pathname, method: req.method });
    const cookie = /JSESSIONID=(\w+)/.exec(req.headers.cookie ?? '')?.[1]; const s = cookie ? sessions.get(cookie) : null;
    const html = (b) => { res.setHeader('content-type', 'text/html;charset=UTF-8'); res.end(b); };
    const page = (tok) => `<html><head><meta id="_csrf" name="_csrf" content="${tok}" /><meta id="_csrf_header" name="_csrf_header" content="X-CSRF-TOKEN" /></head><body>자료실</body></html>`;
    if (u.pathname === '/kapt-web/web/board/webReference/boardList.do') {
      const id = `s${++sid}`; sessions.set(id, { tok: `tok-${id}`, viewed: null }); res.setHeader('set-cookie', `JSESSIONID=${id}; Path=/; HttpOnly`);
      return html(csrfOff ? '<html><body>점검 중</body></html>' : page(`tok-${id}`));
    }
    if (u.pathname === '/kapt-web/web/board/webReference/boardListAjax.do') {
      const f = new URLSearchParams(body);
      if (!s || f.get('_csrf') !== s.tok || req.headers['x-csrf-token'] !== s.tok) { res.statusCode = 403; return html('forbidden'); }
      return html(`<table>${posts.map((p) => `<tr><td>${p.seq}</td><td><a href="#" onclick="javascript:goCheck(${p.seq}, 0);">K-apt 관리비공개의무단지 기본정보(${p.day})</a></td><td>관리자</td></tr>`).join('')}
        <tr><td><a onclick="javascript:goCheck(800001, 1);">K-apt 관리비공개의무단지 기본정보(2030.01.01.)</a></td></tr></table>`);
    }
    if (u.pathname === '/kapt-web/web/board/webReference/boardView.do') {
      const f = new URLSearchParams(body); if (!s || f.get('_csrf') !== s.tok) { res.statusCode = 403; return html('forbidden'); }
      s.viewed = f.get('seq'); return html(page(s.tok));
    }
    if (u.pathname === '/kapt-web/web/board/webReference/fileListData.do') {
      res.setHeader('content-type', 'application/xml;charset=UTF-8');
      const j = JSON.parse(body || '{}'); const p = posts.find((x) => x.seq === j.seq);
      if (!s || req.headers['x-csrf-token'] !== s.tok || s.viewed !== j.seq || !p) return res.end('<Res><code>ERR</code><msg>잘못된 접근입니다.</msg></Res>');
      s.listed = p.seq; return res.end(`<Res><code>SCC</code><msg>정상적으로 처리되었습니다.</msg><data><boardSeq>${p.seq}</boardSeq><seq>1</seq><fileName>${p.file}</fileName><regDate>1</regDate><consultGbn></consultGbn></data></Res>`);
    }
    if (u.pathname === '/kapt-web/cmm/file/BOARD/fileDownload.do') {
      const p = posts.find((x) => x.seq === s?.listed);
      if (!p || u.searchParams.get('key') !== '1' || u.searchParams.get('fileName') !== p.file) { res.statusCode = 500; res.setHeader('content-type', 'application/xml'); return res.end('<Res><code>500</code><msg>오류가 발생하였습니다.</msg></Res>'); }
      res.setHeader('content-type', 'application/octet-stream;charset=UTF-8'); return res.end(xlsx(p.rows, p.head));
    }
    if (u.pathname === '/files/reb-page.html') { res.setHeader('content-type', 'text/html'); return res.end('<script type="application/ld+json">{"dateModified": "2026-09-01"}</script>'); }
    if (u.pathname === '/files/reb.csv') { res.setHeader('content-type', 'text/csv'); return res.end(REB_CSV()); }
    res.statusCode = 404; res.end('');
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('K-apt 자료실 주간 엑셀: 목록 → 글 보기 → 파일 목록 → 내려받기(같은 세션·CSRF) · 사용승인 18개월 전~1년 뒤만 · 한국부동산원 줄에 합침 · 새 글 없으면 안 받음 · 원본 기준일', async () => {
  // 한국부동산원(연 1회 파일)이 먼저 같은 단지를 넣어 둔 상태 — 부동산원 단지 번호 키
  const reb = await run('reb_recent_complexes');
  assert.equal(reb.status, 'success', JSON.stringify(reb));
  const [r0] = await fac((x) => x.source_external_id === 'R-77'); assert.ok(r0); assert.equal(r0.household_count, 500);

  const r1 = await run();
  assert.equal(r1.status, 'success', JSON.stringify(r1));
  assert.match(r1.summary, /K-apt 자료실 10\. 26\.\(월\) 추출분 · 전국 4곳 중 사용승인 18개월 전 ~ 1년 뒤 3곳 → 신규 2 · 갱신 1 · 변화없음 0 · 한국부동산원 줄로 이미 있던 1곳은 그 줄에 합침/);
  assert.deepEqual(['/kapt-web/web/board/webReference/boardList.do', '/kapt-web/web/board/webReference/boardListAjax.do', '/kapt-web/web/board/webReference/boardView.do', '/kapt-web/web/board/webReference/fileListData.do', '/kapt-web/cmm/file/BOARD/fileDownload.do'].map(H), [1, 1, 1, 1, 1], '화면과 같은 순서로 한 번씩');
  assert.deepEqual(r1.sources.kapt_web, { label: 'K-apt 자료실 기본정보', ok: true, calls: 5, received: 4, kept: 3 });
  const [a] = await fac((x) => x.dedupe_key === '아파트|code:A10000001');
  assert.deepEqual([a.name, a.operating_status, a.completion_date, a.household_count, a.office_phone, a.management_company, a.region, a.source_slug],
    ['구리새단지시그니처아파트', '입주중', plus(-60), 752, '031-555-1234', '(주)좋은관리', '경기 구리시', 'kapt_weekly_complexes'], '한글(&#NNNNN;)·전화 하이픈·관리회사');
  assert.match(a.amenities, /관리사무소, 주민공동시설 · 주민운동시설: 헬스장, 골프연습장/); assert.match(a.scale_note, /아파트 · 752세대 · 7개 동 · 최고 39층 · 관리 위탁관리 · 시공 좋은건설 · 분양/);
  assert.equal(a.address, '경기도 구리시 인창동 100 구리새단지시그니처아파트 (경기도 구리시 인창로 1)'); assert.equal(a.source_observed_at, '2026-10-26T00:00:00+09:00');
  const [b] = await fac((x) => x.dedupe_key === '아파트|code:A10000002');
  assert.deepEqual([b.operating_status, b.completion_date, b.management_company, b.office_phone], ['입주예정', plus(90), null, '02-123-4567'], '1년 안 예정 · 자치관리는 관리회사 없음');
  assert.equal((await fac((x) => x.source_external_id === 'A10000003')).length, 0, '사용승인 18개월 밖은 안 넣음');
  // 한국부동산원 줄에 합침(새 줄 아님) — K-apt 값이 먼저, K-apt 단지 코드 키는 별칭
  const same = await fac((x) => x.name?.startsWith('역삼같은단지'));
  assert.equal(same.length, 1, JSON.stringify(same.map((x) => [x.id, x.dedupe_key])));
  assert.equal(same[0].id, r0.id, '부동산원 줄 그대로(진행 기록이 걸린 줄을 살림)');
  assert.deepEqual([same[0].household_count, same[0].source_slug, same[0].management_company], [512, 'kapt_weekly_complexes', '한빛관리(주)']);
  assert.deepEqual(same[0].alias_keys, ['아파트|code:A10000004']);

  // 같은 글이면 내려받지 않음
  const r2 = await run();
  assert.match(r2.summary, /새 글 없음 — 10\. 26\.\(월\) 추출분 반영됨\(사용승인 18개월 전 ~ 1년 뒤 3곳\)/);
  assert.equal(H('/kapt-web/cmm/file/BOARD/fileDownload.do'), 1, '새 글이 없으면 엑셀을 다시 받지 않음');
  assert.equal((await fac((x) => x.name?.startsWith('역삼같은단지'))).length, 1, 'K-apt 다음 실행도 별칭으로 같은 줄');

  // 한국부동산원 다음 실행: 별칭으로 같은 줄을 찾고 빈 칸만 채움(K-apt 값을 덮지 않음)
  const reb2 = await run('reb_recent_complexes');
  assert.equal(reb2.status, 'success', JSON.stringify(reb2));
  const after2 = await fac((x) => x.name?.startsWith('역삼같은단지'));
  assert.equal(after2.length, 1, '부동산원이 같은 단지를 다시 만들지 않음');
  assert.deepEqual([after2[0].household_count, after2[0].source_slug], [512, 'kapt_weekly_complexes'], '낮은 원천은 빈 칸만');
  assert.equal(after2[0].contract_scope, '공동주택 관리·경비·청소 위탁', '비어 있던 칸은 부동산원이 채움');

  // 원본 기준일 한 줄(준공·입주 시설 탭) — K-apt 자료실 추출일 · 한국부동산원 파일 수정일
  const hub = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities');
  assert.deepEqual(hub.sourceAsOf, [{ slug: 'kapt_weekly_complexes', label: 'K-apt 자료실', day: '2026-10-26', note: '추출(주 1회)' }, { slug: 'reb_recent_complexes', label: '한국부동산원', day: '2026-09-01', note: '파일(연 1회, 전년도 사용승인분)' }]);
  const card = hub.items.find((x) => x.name === '구리새단지시그니처아파트'); assert.ok(card);
  assert.deepEqual([card.phone, card.households, card.operator, card.mgmt], ['031-555-1234', 752, null, '(주)좋은관리'], '243차 #760 관리회사(주택관리업자)는 운영사가 아니라 따로');

  // 새 글(다음 주) → 다시 받아 갱신
  K2['세대수'] = '320.0'; posts.unshift({ seq: '900003', day: '2026.10.30.', file: '20261030_단지_기본정보.xlsx', rows: [K1, K2, K4] });
  const r3 = await run();
  assert.match(r3.summary, /10\. 30\.\(금\) 추출분 · 전국 3곳 중 사용승인 18개월 전 ~ 1년 뒤 3곳 → 신규 0 · 갱신 1 · 변화없음 2/);
  assert.equal((await fac((x) => x.dedupe_key === '아파트|code:A10000002'))[0].household_count, 320);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities')).sourceAsOf[0].day, '2026-10-30');
});

test('K-apt 자료실: 화면 형식이 바뀌면 실패로 남김(보안 값 없음 · 필수 칸 없음) — 다음 실행이 다시 받음', async () => {
  csrfOff = true;
  const r = await run();
  assert.equal(r.status, 'failed'); assert.match(r.summary, /보안 값\(CSRF\)을 찾지 못함 — 화면 형식 변경 의심/);
  csrfOff = false;
  posts.unshift({ seq: '900004', day: '2026.11.06.', file: '20261106_단지_기본정보.xlsx', rows: [K1], head: ['단지명', '사용승인일', '세대수'] });
  const r2 = await run();
  assert.equal(r2.status, 'failed'); assert.match(r2.summary, /엑셀 형식 변경 의심 — 필수 칸 없음: 단지코드/);
  const [st] = await sql`select row from sales_src_rows where tbl = 'kapt_weekly_state' and src_id = 'state'`;
  assert.equal(st.row.seq, '900003', '실패한 글은 반영됨으로 남기지 않음');
});
