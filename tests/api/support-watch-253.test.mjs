// 253차 #787(로컬 10/29 00:50, 대표 승인 세 기관 감시): 기관 게시판 읽기 — 상세가 자바스크립트 함수인 곳(체육공단 fn_noticeView·용인 fn_viewDetail)의 상세 주소 ·
// 메뉴 글자 거르기 · 행 안의 신청 기간·기관·분류 · 주석 속 꼬리표(NIPA '<!-- [사업화] -->') 지움 · '용역'·설문 제외 · 새 글은 본문에서 신청 기간·대상 · 예전 꼬리표 글은 같은 번호로 고침 · 출처별 숫자 줄
// (구조 시험 — 가짜 게시판은 10/29 실제 화면 모양 그대로. 실제 세 기관 수집은 운영에서 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

const PORT = 3283; const BASE = `http://localhost:${PORT}`;
const today = seoulToday(); const d = (n) => addDays(today, n); const dot = (n) => d(n).replace(/-/g, '.');
let srv, ctx, sql, fake;
// 체육공단 꼴: 표 · 상세 = javascript:fn_noticeView('n') · 메뉴는 날짜 없는 li
const KSPO = `<html><ul class="gnb"><li><a href="/kspo/list">지원사업공고</a></li><li><a href="/kspo/guide">지원사업안내</a></li></ul><table><tbody>
<tr><td class="notice">공지</td><td><span class="sorting-normal">일반</span></td><td class="title"><a href="javascript:fn_noticeView('1675');">시험체육 스포츠테크 신기술 통합공모(상시)</a></td><td>${dot(-30)} ~ ${dot(60).replace(/\.(\d+)\.(\d+)$/, '. $1. $2')}&nbsp;00시 까지 </td><td>${dot(-30)}</td><td>3829</td></tr>
<tr><td>3</td><td><span class="sorting-urgency">긴급</span></td><td class="title"><a href="javascript:fn_noticeView('1696');">2026년 시험 우수 스포츠용품 선정 모집 </a></td><td>${dot(-2)} ~ ${dot(5)}&nbsp;18시 까지 </td><td>${dot(-2)}</td><td>1575</td></tr>
</tbody></table></html>`;
// 용인 꼴: li · <a href="javascript:void(0)" onclick="javascript:fn_viewDetail('RGS_…')"> · 기관·분류 칸 · 기간만(게시일 없음) · 메뉴 #none · 설문
const YBS = `<html><ul><li><a href="#none">용인시 지원사업</a></li><li><a href="javascript:void(0)">지원사업 공고</a></li></ul><ul class="list">
<li><a href="javascript:void(0)" onclick="javascript:fn_viewDetail('RGS_0000000000000677')"><p class="radi_box"><span class="colorbox">시험시산업진흥원(판로지원팀)</span><span class="linebox">수출·내수</span></p>
<strong class="pjtit">2026년 시험 수출 대행 서비스 지원사업 추가 모집 공고</strong><p class="date_box"><span>${dot(-3)} 09:00 ~ ${dot(8)} 18:00</span><strong class="dday">D-8</strong></p></a></li>
<li><a href="javascript:void(0)" onclick="javascript:fn_viewDetail('RGS_0000000000000679')"><p class="radi_box"><span class="colorbox">시험시(기업지원팀)</span><span class="linebox">컨설팅·멘토링</span></p>
<strong class="pjtit">[설문조사] 기업지원 정보 이용실태 수요조사</strong><p class="date_box"><span>${dot(-1)} 09:00 ~ ${dot(3)} 18:00</span></p></a></li></ul></html>`;
// NIPA 꼴: 주석 속 [사업화] 꼬리표 · 신청기간 · 용역 모집 · 기간 없는 글(본문에서 채움)
const row = (no, title, period) => `<tr><td>${no}</td><td class="tl"><div class="co"><div><a href="/nipa/view/${no}">
 <!-- <span class="fc_blue mgr5 cate3">[사업화]</span> -->
 ${title}</a></div><div><span class="box bluebox">사업명</span><span class="bco">${period ? `신청기간 : ${d(-1)} 09:00 ~ ${d(9)} 18:00` : ''}</span></div></div></td><td><span class="bco">${d(-1)}</span></td></tr>`;
const NIPA = `<html><table>${row(16974, '「시험의 AI」 정책브랜드 대국민 공모전 공고', true)}${row(16969, '2026년 한-시험 AI 포럼 운영 용역 모집', true)}${row(16960, '2026년 시험 SW 고도화 지원사업 참여기업 모집', false)}</table></html>`;
const NIPA_VIEW = `<html><body><nav>주요사업 사업공고 입찰공고</nav><article><h2>2026년 시험 SW 고도화 지원사업 참여기업 모집</h2><p>신청기간 : ${d(0)} 10:00 ~ ${d(14)} 17:00</p><p>지원대상 : 경기도 소재 SW 중소기업</p><p>기업당 최대 5,000만원</p></article></body></html>`;
const PAGES = [{ name: '시험 체육공단 스포츠산업지원', url: `${BASE}/kspo/list`, detail: '/kspo/detail.do?suppBusiInfoSeq={id}', all: true },
  { name: '시험 용인기업지원시스템', url: `${BASE}/ybs/application.do`, detail: '/poratlAppFormDtl.do?regNo={id}', all: true, region: '경기' },
  { name: '시험 정보통신산업진흥원(NIPA) 사업공고', url: `${BASE}/nipa/list`, all: true }];
const run = () => ctx.owner.ok('POST', '/api/sales/collectors/support_watch/run', {});
const watch = () => sql`select * from support_programs where source = 'watch' order by title`;

before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const html = (s) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(s); };
    if (u.pathname === '/kspo/list') return html(KSPO);
    if (u.pathname === '/ybs/application.do') return html(YBS);
    if (u.pathname === '/nipa/list') return html(NIPA);
    if (u.pathname === '/nipa/view/16960') return html(NIPA_VIEW);
    if (/detail|Dtl|view/.test(u.pathname)) return html('<html><body><article>첨부 공고문 참조</article></body></html>');
    res.statusCode = 404; res.end('nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: BASE, SUPPORT_AUTO_AI: 'off' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into app_settings (key, value) values ('support_watch_pages', ${sql.json(PAGES)}) on conflict (key) do update set value = excluded.value`;
  // 예전 수집(꼬리표가 붙은 제목)으로 들어온 글 · 거르기 규칙 전의 용역 글
  await sql`insert into support_programs (source, source_id, title, agency, url, regions, nationwide, apply_end) values
    ('watch', 'old-1', '[사업화] --> 「시험의 AI」 정책브랜드 대국민 공모전 공고', '시험 정보통신산업진흥원(NIPA) 사업공고', ${`${BASE}/nipa/view/16974`}, '{}', true, ${d(9)}),
    ('watch', 'old-2', '[사업화] --> 2026년 한-시험 AI 포럼 운영 용역 모집', '시험 정보통신산업진흥원(NIPA) 사업공고', ${`${BASE}/nipa/view/16969`}, '{}', true, ${d(9)})`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('세 게시판: 자바스크립트 상세 → 상세 주소 · 메뉴·설문·용역 거름 · 행 안 신청 기간·기관·분류 · 주석 꼬리표 지움 · 예전 꼬리표 글은 같은 번호로 고침 · 기간 없는 새 글은 본문에서 기간·대상', async () => {
  const r = await run();
  assert.equal(r.status, 'success', JSON.stringify(r));
  const w = await watch(); const by = (t) => w.find((x) => x.title === t);
  assert.deepEqual(w.map((x) => x.title).sort(), ['2026년 시험 SW 고도화 지원사업 참여기업 모집', '2026년 시험 수출 대행 서비스 지원사업 추가 모집 공고', '2026년 시험 우수 스포츠용품 선정 모집', '[사업화] --> 2026년 한-시험 AI 포럼 운영 용역 모집',
    '시험체육 스포츠테크 신기술 통합공모(상시)', '「시험의 AI」 정책브랜드 대국민 공모전 공고'].sort(), '메뉴·설문·용역은 안 들어옴(예전 용역 글은 지우지 않고 화면에서만 뺌 — 아래 시험)');
  const k = by('2026년 시험 우수 스포츠용품 선정 모집');
  assert.equal(k.url, `${BASE}/kspo/detail.do?suppBusiInfoSeq=1696`);
  assert.equal(String(by('시험체육 스포츠테크 신기술 통합공모(상시)').url), `${BASE}/kspo/detail.do?suppBusiInfoSeq=1675`);
  const day = (v) => (v == null ? null : typeof v === 'string' ? v.slice(0, 10) : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(v));
  assert.deepEqual([day(k.apply_start), day(k.apply_end)], [d(-2), d(5)]);
  const y = by('2026년 시험 수출 대행 서비스 지원사업 추가 모집 공고');
  assert.deepEqual([y.url, y.executor, y.category, y.regions, day(y.apply_end)], [`${BASE}/poratlAppFormDtl.do?regNo=RGS_0000000000000677`, '시험시산업진흥원(판로지원팀)', '수출·내수', ['경기'], d(8)]);
  const n1 = w.find((x) => x.url === `${BASE}/nipa/view/16974`);
  assert.deepEqual([n1.source_id, n1.title, day(n1.apply_end)], ['old-1', '「시험의 AI」 정책브랜드 대국민 공모전 공고', d(9)], '같은 상세 주소 = 같은 글(번호 그대로, 제목만 고침)');
  assert.equal(w.filter((x) => x.url === `${BASE}/nipa/view/16974`).length, 1);
  const n3 = by('2026년 시험 SW 고도화 지원사업 참여기업 모집');
  assert.deepEqual([day(n3.apply_start), day(n3.apply_end), n3.target], [d(0), d(14), '경기도 소재 SW 중소기업'], '목록에 기간이 없던 글은 본문에서');
  assert.match(n3.summary, /기업당 최대 5,000만원/);
  assert.ok(!w.filter((x) => x.source_id !== 'old-2').some((x) => /-->|\[사업화\]/.test(x.title)), '주석 꼬리표 없음');
  // 다시 돌아도 본문을 다시 읽지 않고 그대로(바뀜 0)
  const r2 = await run();
  assert.equal(r2.updated, 0, JSON.stringify(r2));
});

test('지원사업 화면: 출처별 열린 공고 수 한 줄 · 거르기 전 들어온 용역 글은 안 보임 · 사업화 꼬리표로 돈 종류가 붙지 않음', async () => {
  const v = await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200&sort=new&dd=all&kind=all');
  const c = Object.fromEntries(v.bySource.counts.map((x) => [x.source, x.n]));
  assert.deepEqual([c.bizinfo, c.kstartup, c.watch, c.manual], [0, 0, 5, 0], JSON.stringify(v.bySource));
  assert.ok(v.bySource.lastAt, '마지막 수집 시각');
  assert.ok(!v.items.some((x) => /용역/.test(x.title)), '용역 글은 빼고 봄');
  const ai = v.items.find((x) => x.title === '「시험의 AI」 정책브랜드 대국민 공모전 공고');
  assert.ok(ai && !ai.kinds.includes('money'), JSON.stringify(ai?.kinds));
});
