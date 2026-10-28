// #450 영업실 '지원사업' — 구조 시험(가짜 원천: 기업마당·공공데이터포털 15157820·K-Startup·기관 공지 게시판, 가짜 AI). 실제 원천 연동 완료가 아님(인증키 발급 뒤 운영에서 확인).
// 수집(칸 매핑·지역 해시태그·키 없을 때 대체 경로·키 가림) → 회사 프로필 → 1차 규칙(지역·시·군·업력·근로자·소상공인·연구소·SW사업자·기출원 경고) → 같은 공고 하나로
// → AI 판단(프롬프트·브랜드 제한·사용량) → 관심·신청 준비(담당 업무·체크리스트) → 신청·선정 기록 → 직접 입력(지난 신청) → 마감 7일·3일 전 알림 → 영업 홈 카드
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, tick, FAKE, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const PORT = 3236;
let srv, ctx, sql, src, fg; const hits = [];
const today = seoulToday(); const d = (n) => addDays(today, n); const d8 = (n) => d(n).replace(/-/g, '');
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const biz = (id, title, o = {}) => ({ pblancId: id, pblancNm: title, pblancUrl: `/sii/siia/selectSIIA200Detail.do?pblancId=${id}`, jrsdInsttNm: '중소벤처기업부', trgetNm: '중소기업', hashTags: '기술', reqstBeginEndDe: `${d(0)} ~ ${d(30)}`, bsnsSumryCn: `<p>${title} 개요</p>`, creatPnttm: `${d(0)} 09:00:00`, ...o });
const B = {
  b1: biz('PBLN_T1', '[경기] 2026년 용인IP지원센터 IP 전략수립 지원사업 모집공고', { jrsdInsttNm: '경기도', excInsttNm: '경기테크노파크', hashTags: '경기,용인,지식재산', reqstBeginEndDe: `${d(0)} ~ ${d(10)}`,
    bsnsSumryCn: '<p>용인시 소재 중소기업 IP 전략수립 컨설팅(기업당 최대 1,000만원)</p><p>※ 기출원 건은 지원 불가</p>', flpthNm: '/cmm/fms/getImageFile.do?atchFileId=FILE_1', fileNm: '공고문.hwp', reqstMthPapersCn: '온라인 신청', refrncNm: '031-000-0000' }),
  b2: biz('PBLN_T2', '2026년 소상공인 온라인 판로 지원사업', { excInsttNm: '소상공인시장진흥공단', trgetNm: '소상공인', hashTags: '내수,판로', reqstBeginEndDe: `${d(0)} ~ ${d(20)}`, bsnsSumryCn: '<p>소상공인 온라인 마케팅·판로 지원</p>' }),
  b3: biz('PBLN_T3', '[부산] 2026년 부산 수출기업 해외 마케팅 지원', { jrsdInsttNm: '부산광역시', hashTags: '부산,수출' }),
  b4: biz('PBLN_T4', '[경기] 2026년 화성시 지식재산 긴급지원 사업 모집공고', { jrsdInsttNm: '경기도', excInsttNm: '경기테크노파크', hashTags: '경기,화성,지식재산' }),
  b5: biz('PBLN_T5', '2026년 초기창업패키지 창업기업 모집 공고', { excInsttNm: '창업진흥원', trgetNm: '창업기업', hashTags: '창업', reqstBeginEndDe: `${d(0)} ~ ${d(15)}` }),
  b6: biz('PBLN_T6', '2026년 연구개발 바우처 지원', { bsnsSumryCn: '<p>기업부설연구소 또는 연구개발전담부서 보유 기업. 상시근로자 5인 이상</p>' }),
  b7: biz('PBLN_T7', '2026년 SW사업자 클라우드 전환 지원', { trgetNm: 'SW사업자 신고 기업', reqstBeginEndDe: `${d(0)} ~ ${d(25)}` }),
  b8: biz('PBLN_T8', '[경기] 2026년 경기도 중소기업 마케팅 지원사업', { jrsdInsttNm: '경기도', excInsttNm: '경기도경제과학진흥원', hashTags: '경기,마케팅', reqstBeginEndDe: `${d(0)} ~ ${d(6)}` }),
};
const K = {
  k1: { pbanc_sn: 175001, biz_pbanc_nm: '2026년 초기창업패키지 창업기업 모집 공고', supt_biz_clsfc: '사업화', supt_regin: '전국', aply_trgt: '일반기업', biz_enyy: '예비창업자,1년미만,2년미만,3년미만,5년미만,7년미만',
    pbanc_rcpt_bgng_dt: d8(0), pbanc_rcpt_end_dt: d8(15), pbanc_ntrp_nm: '창업진흥원', sprv_inst: '중소벤처기업부', detl_pg_url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=175001',
    biz_aply_url: 'https://www.k-startup.go.kr/apply/175001', pbanc_ctnt: '창업기업 사업화 자금 최대 1억원 지원', rcrt_prgs_yn: 'Y' },
  k2: { pbanc_sn: 175002, biz_pbanc_nm: '2026년 경남 로컬크리에이터 지원', supt_biz_clsfc: '사업화', supt_regin: '경남', aply_trgt: '일반기업', pbanc_rcpt_bgng_dt: d8(0), pbanc_rcpt_end_dt: d8(12), pbanc_ntrp_nm: '경남창조경제혁신센터', rcrt_prgs_yn: 'Y' },
};
const BOARD = `<html><table>
<tr><td>1</td><td><a href="/support/view/1">[모집] 2026년 하반기 지식재산 바우처 참여기업 모집 공고</a></td><td>${d(-1)}</td></tr>
<tr><td>2</td><td><a href="/support/view/2">2026년 지식재산 바우처 선정 결과 발표</a></td><td>${d(-2)}</td></tr>
<tr><td>3</td><td><a href="/support/view/3">센터 직원 채용 모집 안내</a></td><td>${d(-3)}</td></tr></table></html>`;
const json = (res, o) => { res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
const p = (title) => sql`select * from support_programs where title = ${title}`.then((r) => r[0]);

before(async () => {
  src = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const q = Object.fromEntries(u.searchParams); hits.push({ path: u.pathname, q });
    if (u.pathname === '/agency/bizinfo_support') return json(res, { jsonArray: q.hashtags === '경기' ? [B.b8, B.b1] : [B.b1, B.b2, B.b3, B.b4, B.b5, B.b6, B.b7] });
    // 운영(로컬 10/23): 활용신청 안 한 서비스는 HTTP 403 + 본문 SERVICE_KEY_IS_NOT_REGISTERED_ERROR
    if (u.pathname === '/agency/bizinfo_datago_support' && q.serviceKey === 'bad-key') { res.statusCode = 403; return res.end('SERVICE_KEY_IS_NOT_REGISTERED_ERROR'); }
    if (u.pathname === '/agency/bizinfo_datago_support') return json(res, { response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: { item: [B.b1, B.b2] }, totalCount: 2 } } });
    if (u.pathname === '/agency/kstartup_support') {
      if (q.serviceKey === 'bad-key') { res.setHeader('content-type', 'application/xml'); return res.end('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'); }
      return json(res, { currentCount: 2, data: [K.k1, K.k2], matchCount: 2, page: 1, perPage: 100, totalCount: 2 });
    }
    if (u.pathname === '/support/board') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(BOARD); }
    if (u.pathname === '/support/view/1') { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<html><body><article><h1>지식재산 바우처</h1><p>경기도 소재 중소기업 대상. 상표·디자인 출원 비용 지원(최대 300만원).</p><p>제출 서류: 신청서, 사업자등록증 사본</p></article></body></html>'); }
    res.statusCode = 404; res.end('nope');
  }).listen(PORT);
  await resetDb(); fg = await startFakeGoogle();
  // 기업마당 키는 일부러 없음 → 처음엔 공공데이터포털(15157820) 경로, 플랫폼 설정에 키를 넣으면 기업마당 직접
  srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'dg-key', SUPPORT_REMIND_HOURS: '0-24', SUPPORT_WEEKLY: 'any', SUPPORT_WEEKLY_AI_MAX: '5', SUPPORT_AUTO_AI: 'off' }); // 주간 묶음의 자동 판단은 여기서 · 250차 새 공고 자동 판단은 support-auto-250 에서(여기서는 끔)
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.managerA.id, spaces: ['sales'] });
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); src?.close(); fg?.server.close(); await sql?.end(); });

test('수집기 15개(지원사업 3개 · 08·14시 두 번) · 회사 프로필: 기본값 → 관리자만 저장 · 시·도는 목록에서', async () => {
  const v = await ctx.owner.ok('GET', '/api/sales/collectors');
  assert.equal(v.collectors.length, 18); // 186차 신규 공동주택 단지 · 200차 K-apt 자료실 주간 엑셀 수집기 · 254차 정부24 지원금 포함
  const bz = v.collectors.find((c) => c.slug === 'bizinfo_support');
  assert.deepEqual([bz.support, bz.hourKst, bz.againKst], [true, 8, 14]);
  assert.equal(bz.needs[0].present, true, '기업마당 키가 없어도 공공데이터포털 키로 대체 경로가 있으면 준비됨');
  assert.equal(v.collectors.find((c) => c.slug === 'kstartup_support').needs[0].present, true);
  const p0 = await ctx.owner.ok('GET', '/api/sales/support/profile');
  assert.equal(p0.saved, false); assert.equal(p0.canEdit, true); assert.ok(p0.interestOptions.includes('IP')); assert.ok(p0.certOptions.includes('SW사업자'));
  const prof = { regionSido: '경기', regionSigungu: '용인시', founded: d(-2200), size: '소기업', employees: 12, industries: ['소프트웨어'], keywords: ['출입'], certs: ['벤처기업'], brands: ['다짐', '하이링크', '워크인'], interests: ['IP', '마케팅'], excludes: ['농업'], memo: '시험 회사 소개' };
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/support/profile', prof)).status, 403, '프로필은 관리자만');
  assert.equal((await ctx.owner.req('PUT', '/api/sales/support/profile', { ...prof, regionSido: '도쿄' })).status, 400);
  const p1 = await ctx.owner.ok('PUT', '/api/sales/support/profile', prof);
  assert.equal(p1.saved, true); assert.deepEqual([p1.profile.region_sido, p1.profile.region_sigungu, p1.profile.employees, p1.profile.interests], ['경기', '용인시', 12, ['IP', '마케팅']]);
  const st = await ctx.staffA.client.ok('GET', '/api/sales/support/profile');
  assert.equal(st.canEdit, false); assert.equal(st.profile.region_sigungu, '용인시');
});

test('기업마당: 키가 없으면 공공데이터포털(15157820) → 플랫폼 설정에 키를 넣으면 직접(전체 + 본점 지역 해시태그) · 칸 매핑 · 키는 안 보임 · 다시 돌리면 변화없음', async () => {
  hits.length = 0;
  const r0 = await ctx.owner.ok('POST', '/api/sales/collectors/bizinfo_support/run', {});
  assert.equal(r0.status, 'success', JSON.stringify(r0)); assert.equal(r0.inserted, 2); assert.match(r0.summary, /공공데이터포털/);
  const dg = hits.filter((h) => h.path === '/agency/bizinfo_datago_support');
  assert.ok(dg.length >= 1); assert.equal(dg[0].q.serviceKey, 'dg-key'); assert.equal(dg[0].q.dataType, 'json');
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/sales-collectors')).status, 404, '플랫폼 운영자만');
  const s = await ctx.owner.ok('PUT', '/api/platform/sales-collectors', { supportKeys: { bizinfo: 'biz-key-1234' } });
  assert.deepEqual(s.supportKeys.bizinfo, { present: true, from: 'settings', hint: 'biz-…' });
  assert.ok(!JSON.stringify(s).includes('biz-key-1234'), '키 값은 응답에 없음');
  assert.ok(!JSON.stringify((await sql`select value from app_settings where key = 'support_api_keys'`)[0].value).includes('biz-key-1234'), '키는 암호화해 저장');
  hits.length = 0;
  const r1 = await ctx.owner.ok('POST', '/api/sales/collectors/bizinfo_support/run', {});
  assert.equal(r1.status, 'success', JSON.stringify(r1)); assert.deepEqual([r1.inserted, r1.unchanged], [6, 2]); assert.match(r1.summary, /직접: 전체·경기/);
  const calls = hits.filter((h) => h.path === '/agency/bizinfo_support');
  assert.deepEqual(calls.map((h) => [h.q.crtfcKey, h.q.dataType, h.q.searchCnt, h.q.hashtags ?? null]), [['biz-key-1234', 'json', '500', null], ['biz-key-1234', 'json', '300', '경기']]);
  const b1 = await p(B.b1.pblancNm);
  assert.deepEqual([b1.source, b1.source_id, b1.agency, b1.executor, b1.regions, b1.nationwide, b1.amount], ['bizinfo', 'PBLN_T1', '경기도', '경기테크노파크', ['경기'], false, '최대 1,000만원']);
  assert.equal(b1.url, 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=PBLN_T1');
  assert.deepEqual(b1.attachments, [{ name: '공고문.hwp', url: 'https://www.bizinfo.go.kr/cmm/fms/getImageFile.do?atchFileId=FILE_1' }]);
  assert.deepEqual(b1.hashtags, ['경기', '용인', '지식재산']);
  assert.match(b1.summary, /^용인시 소재 중소기업 IP 전략수립 컨설팅\(기업당 최대 1,000만원\)\n※ 기출원 건은 지원 불가\n\n신청 방법: 온라인 신청\n\n문의: 031-000-0000$/);
  assert.equal((await sql`select apply_start::text s, apply_end::text e from support_programs where id = ${b1.id}`)[0].e, d(10));
  assert.equal((await p(B.b8.pblancNm)).source_id, 'PBLN_T8', '지역 해시태그로만 오는 공고도 받음');
  const r2 = await ctx.owner.ok('POST', '/api/sales/collectors/bizinfo_support/run', {});
  assert.deepEqual([r2.inserted, r2.updated, r2.unchanged], [0, 0, 8]);
});

test('K-Startup: 모집 중·접수 마감 오늘 이후만 요청 · 업력·지역·상세/신청 링크 · 활용신청 안 한 키는 \'공공데이터포털 활용신청 필요(서비스 번호)\' 요약·플랫폼 설정(키는 가림)', async () => {
  hits.length = 0;
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kstartup_support/run', {});
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.equal(r.inserted, 2);
  const q = hits.find((h) => h.path === '/agency/kstartup_support').q;
  assert.deepEqual([q.serviceKey, q.returnType, q['cond[rcrt_prgs_yn::EQ]'], q['cond[pbanc_rcpt_end_dt::GTE]'], q.page, q.perPage], ['dg-key', 'json', 'Y', d8(0), '1', '100']);
  const k1 = (await sql`select *, apply_start::text s, apply_end::text e from support_programs where source = 'kstartup' and source_id = '175001'`)[0];
  assert.deepEqual([k1.title, k1.agency, k1.executor, k1.regions, k1.nationwide, k1.s, k1.e, k1.amount], [K.k1.biz_pbanc_nm, '중소벤처기업부', '창업진흥원', [], true, d(0), d(15), '최대 1억원']);
  assert.equal(k1.biz_years, K.k1.biz_enyy); assert.equal(k1.url, K.k1.detl_pg_url); assert.equal(k1.apply_url, K.k1.biz_aply_url);
  assert.deepEqual((await sql`select regions from support_programs where source_id = '175002'`)[0].regions, ['경남']);
  await ctx.owner.ok('PUT', '/api/platform/sales-collectors', { supportKeys: { datago: 'bad-key' } });
  const bad = await ctx.owner.ok('POST', '/api/sales/collectors/kstartup_support/run', {});
  assert.equal(bad.status, 'failed'); assert.ok(!bad.errorLog.includes('bad-key'), '키는 가림');
  assert.equal(bad.summary, 'K-Startup: 공공데이터포털 활용신청 필요(서비스 15125364) — 키는 그대로 두고 포털(data.go.kr)에서 [활용신청]', '카드 아래 줄 = 원인(로컬 10/23)');
  // 기업마당 키가 없으면 포털(15157820) 경로 — 운영처럼 HTTP 403 본문만 와도 같은 안내
  await ctx.owner.ok('PUT', '/api/platform/sales-collectors', { supportKeys: { bizinfo: null } });
  const bb = await ctx.owner.ok('POST', '/api/sales/collectors/bizinfo_support/run', {});
  assert.equal(bb.status, 'failed'); assert.equal(bb.summary, '기업마당: 공공데이터포털 활용신청 필요(서비스 15157820) — 키는 그대로 두고 포털(data.go.kr)에서 [활용신청]');
  assert.ok(!JSON.stringify(bb).includes('bad-key'), '키는 가림');
  const ps = await ctx.owner.ok('GET', '/api/platform/sales-collectors');
  assert.deepEqual(ps.supportRuns.filter((r) => r.slug !== 'support_watch').map((r) => [r.slug, r.status, r.summary.match(/서비스 (\d+)/)?.[1]]), [['bizinfo_support', 'failed', '15157820'], ['kstartup_support', 'failed', '15125364']]);
  await ctx.owner.ok('PUT', '/api/platform/sales-collectors', { supportKeys: { bizinfo: 'biz-key-1234' } });
  const s = await ctx.owner.ok('PUT', '/api/platform/sales-collectors', { supportKeys: { datago: null } });
  assert.equal(s.supportKeys.datago.from, 'env', '지우면 환경 변수 키로');
});

test('기관 공지 게시판: 지원·모집 글만(선정 결과 발표·채용 빼고) · 감시 페이지 지역', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/support_watch/run', {});
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.equal(r.inserted, 1);
  const w = (await sql`select * from support_programs where source = 'watch'`);
  assert.equal(w.length, 1); assert.equal(w[0].title, '[모집] 2026년 하반기 지식재산 바우처 참여기업 모집 공고');
  assert.deepEqual([w[0].agency, w[0].regions, w[0].url], ['시험 지식재산센터', ['경기'], `http://localhost:${PORT}/support/view/1`]);
});

const find = (items, title) => items.find((x) => x.title === title);
const P = {};
test('맞춤 목록: 1차 규칙(지역·시·군·업력·근로자·소상공인·연구소·SW사업자·기출원 경고) · 맞는 순 · 같은 공고 하나로 · 해당 없음 빼기/보기 · 숨기기 · 찾기', async () => {
  const v = await ctx.staffA.client.ok('GET', '/api/sales/support');
  const t = (x) => x.rule.flags.map((f) => `${f.level}:${f.text}`);
  const b1 = find(v.items, B.b1.pblancNm); P.b1 = b1.id;
  assert.equal(b1.rule.verdict, 'fit');
  for (const f of ['ok:경기 지역 공고', 'ok:용인시 공고', 'warn:이미 출원한 건은 지원 불가 — 선정·협약 전에 출원하지 않기', 'ok:관심: IP']) assert.ok(t(b1).includes(f), `${f} ∈ ${t(b1)}`);
  assert.deepEqual([b1.dday, b1.amount, b1.sourceLabel, b1.isNew], [10, '최대 1,000만원', '기업마당', true]);
  assert.ok(t(find(v.items, B.b2.pblancNm)).includes('ok:소상공인 대상'));
  assert.equal(find(v.items, B.b8.pblancNm).rule.verdict, 'fit');
  const k1 = find(v.items, K.k1.biz_pbanc_nm); P.k1 = k1.id;
  assert.equal(k1.source, 'kstartup', '같은 공고(공고명+마감일)는 K-Startup 하나로'); assert.deepEqual(k1.alsoOn, ['기업마당']);
  assert.equal(v.items.filter((x) => x.title === B.b5.pblancNm).length, 1);
  assert.ok(t(k1).some((f) => /^ok:업력 7년 미만 — 우리 6(\.\d)?년$/.test(f)), t(k1).join(' | '));
  const b6 = find(v.items, B.b6.pblancNm);
  assert.ok(t(b6).includes('warn:기업부설연구소·연구개발전담부서 보유 기업 대상(또는 우대)')); assert.ok(t(b6).includes('ok:상시근로자 5인 이상 — 우리 12명')); assert.equal(b6.rule.verdict, 'maybe');
  assert.ok(t(find(v.items, B.b7.pblancNm)).includes('warn:SW사업자 신고 필요'));
  const w = find(v.items, '[모집] 2026년 하반기 지식재산 바우처 참여기업 모집 공고'); P.watch = w.id;
  assert.equal(w.rule.verdict, 'fit'); assert.equal(w.dday, null);
  for (const no of [B.b3.pblancNm, B.b4.pblancNm, K.k2.biz_pbanc_nm]) assert.ok(!find(v.items, no), `${no} 는 자격 안 맞아 빠짐`);
  assert.equal(v.hiddenNo, 3);
  const lastFit = Math.max(...v.items.map((x, i) => (x.rule.verdict === 'fit' ? i : -1))); const firstMaybe = v.items.findIndex((x) => x.rule.verdict === 'maybe');
  assert.ok(lastFit < firstMaybe, '맞는 것(✅)이 확인 필요(⚠)보다 위');
  assert.deepEqual([v.counts.fit, v.counts.closing], [v.items.length, 2], 'D-14 안: 경기 마케팅(D-6)·용인 IP(D-10)');
  assert.equal(v.profile.region, '경기'); assert.equal(v.keys.datago, true);
  const all = await ctx.staffA.client.ok('GET', '/api/sales/support?showNo=1');
  assert.equal(all.counts.fit, v.counts.fit, '로컬 158차 확인: 해당 없음 보기를 켜도 탭 숫자(맞춤 n)는 그대로'); assert.equal(all.items.length, v.items.length + 3, '목록에는 해당 없음 3건이 더 보임');
  assert.ok(find(all.items, B.b3.pblancNm).rule.flags.some((f) => f.level === 'no' && f.text === '부산 기업 대상(우리 경기)'));
  assert.ok(find(all.items, B.b4.pblancNm).rule.flags.some((f) => f.level === 'no' && f.text === '화성시 공고(우리 용인시)'));
  const hit = await ctx.staffA.client.ok('GET', `/api/sales/support?showNo=1&q=${encodeURIComponent('화성')}`);
  assert.deepEqual(hit.items.map((x) => x.title), [B.b4.pblancNm]);
  const b2 = find(v.items, B.b2.pblancNm);
  await ctx.staffA.client.ok('POST', `/api/sales/support/${b2.id}/hide`, { hidden: true });
  assert.ok(!find((await ctx.staffA.client.ok('GET', '/api/sales/support')).items, B.b2.pblancNm), '숨기면 맞춤에서 빠짐');
  assert.equal(find((await ctx.staffA.client.ok('GET', '/api/sales/support?tab=all')).items, B.b2.pblancNm).hidden, true, '전체 탭에는 남음');
  await ctx.staffA.client.ok('POST', `/api/sales/support/${b2.id}/hide`, { hidden: false });
});

test('AI 판단: 회사 프로필·공고·자격 항목이 프롬프트에 · 브랜드는 회사 목록 안에서만 · 사용량 sales_support · 맞춤 맨 위 · 기관 공지는 본문을 읽어 판단', async () => {
  await queue([say({ verdict: 'fit', reasons: ['용인시 소재 중소기업 대상 — 본점 용인시라 해당', '기출원 건 지원 불가 — 출원 전에 신청'], brands: ['하이링크', '없는브랜드'], docs: ['사업자등록증', '중소기업 확인서'], use: ['IP 전략 컨설팅으로 앱 상표·특허 포트폴리오를 정리', '출원 비용 지원은 신규 브랜드 상표 등록에'], schedule: '신청 마감 D-10 · 선정 뒤 협약 체결 후 출원', summary: 'IP 전략 컨설팅 지원', amount: '최대 1,000만원' })]);
  const r = await ctx.staffA.client.ok('POST', `/api/sales/support/${P.b1}/analyze`, {});
  assert.deepEqual([r.ai.verdict, r.ai.brands, r.ai.docs], ['fit', ['하이링크'], ['사업자등록증', '중소기업 확인서']]); assert.ok(r.costKrw >= 1);
  assert.deepEqual([r.ai.use.length, r.ai.schedule], [2, '신청 마감 D-10 · 선정 뒤 협약 체결 후 출원'], '#568 접목할 점·마감 한 줄');
  const req = (await fakeState()).anthropic.at(-1).body;
  assert.match(req.system, /기출원 건 지원 불가/); assert.match(req.system, /접목할 점 2~4줄/); assert.match(req.system, /다짐, 하이링크, 워크인/); assert.match(req.system, /SW사업자 신고/);
  const text = req.messages[0].content[0].text;
  assert.match(text, /\[회사 프로필\]\n본점: 경기 용인시/); assert.match(text, /보유 인증: 벤처기업/); assert.match(text, /\[공고\]\n공고명: \[경기\] 2026년 용인IP지원센터/); assert.match(text, /용인시 소재 중소기업 IP 전략수립/);
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_support'`)[0].n, 1);
  const v = await ctx.staffA.client.ok('GET', '/api/sales/support');
  assert.equal(v.items[0].id, P.b1, 'AI 가 ✅ 로 본 공고가 맨 위'); assert.equal(v.items[0].ai.verdict, 'fit'); assert.equal(v.items[0].ai.use[0], 'IP 전략 컨설팅으로 앱 상표·특허 포트폴리오를 정리'); assert.equal(v.items[0].ai.auto, false);
  await queue([say({ verdict: 'maybe', reasons: ['경기도 소재 중소기업 대상 — 해당'], brands: [], docs: ['신청서', '사업자등록증 사본'], summary: '상표·디자인 출원 비용 지원', amount: '최대 300만원' })]);
  const w = await ctx.owner.ok('POST', `/api/sales/support/${P.watch}/analyze`, {});
  assert.equal(w.ai.verdict, 'maybe');
  assert.match((await fakeState()).anthropic.at(-1).body.messages[0].content[0].text, /경기도 소재 중소기업 대상\. 상표·디자인 출원 비용 지원/, '기관 공지는 본문을 읽어 보냄');
  assert.match((await sql`select summary from support_programs where id = ${P.watch}`)[0].summary, /제출 서류: 신청서/);
  const dt = await ctx.owner.ok('GET', `/api/sales/support/${P.watch}`);
  assert.equal(dt.item.amount, '최대 300만원', 'AI 가 읽은 지원 규모');
});

test('[관심] → 담당 업무(검토·마감 7일 전) → [신청 준비] → 같은 업무에 서류 체크리스트·마감 = 신청 마감 → 담당 넘김 → 신청 완료(업무 완료) → 선정 기록', async () => {
  assert.equal((await ctx.staffA.client.req('POST', `/api/sales/support/${P.k1}/work`, {})).status, 400, '상태 없이 처음 기록 불가');
  const a = await ctx.staffA.client.ok('POST', `/api/sales/support/${P.b1}/work`, { status: 'interest' });
  assert.deepEqual([a.item.work.status, a.item.work.ownerId], ['interest', ctx.staffA.id]);
  const task = async () => (await sql`select t.id, t.title, t.status, t.due_date::text due, t.assignee_id, t.space, t.sales_ref, (select array_agg(text order by sort) from task_checklist_items where task_id = t.id) items from tasks t where t.sales_ref->>'id' = ${P.b1} and t.deleted_at is null`);
  const [t1] = await task();
  assert.equal(t1.title, `[지원사업] ${B.b1.pblancNm} — 검토`); assert.deepEqual([t1.due, t1.assignee_id, t1.space, t1.sales_ref.kind], [d(3), ctx.staffA.id, 'sales', 'support']);
  assert.deepEqual(t1.items, ['공고문·자격 요건 확인', '신청 여부 결정(신청 준비로 바꾸기)']);
  const b = await ctx.staffA.client.ok('POST', `/api/sales/support/${P.b1}/work`, { status: 'preparing' });
  assert.equal(b.task.id, t1.id, '같은 업무');
  const [t2] = await task();
  assert.deepEqual([t2.title, t2.due], [`[지원사업] ${B.b1.pblancNm} — 신청 준비`, d(10)]);
  assert.deepEqual(t2.items, [...t1.items, '서류: 사업자등록증', '서류: 중소기업 확인서', '공고문·신청 양식 내려받기', '신청서 작성', '온라인 제출·접수 확인'], 'AI 가 읽은 준비 서류가 체크리스트로');
  assert.equal((await ctx.owner.req('POST', `/api/sales/support/${P.b1}/work`, { ownerId: ctx.staffB.id })).status, 400, '영업 공간 밖 사람은 담당 불가');
  await ctx.owner.ok('POST', `/api/sales/support/${P.b1}/work`, { ownerId: ctx.managerA.id });
  assert.equal((await task())[0].assignee_id, ctx.managerA.id, '담당을 바꾸면 열린 업무도 넘김');
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.managerA.id} and link = ${`/s/sales/support?id=${P.b1}`}`)[0].n, 1);
  assert.deepEqual((await ctx.staffA.client.ok('GET', `/api/sales/support/${P.b1}`)).people.map((x) => x.name).sort(), ['김대표', '이직원', '최매니저'].sort(), '담당 고르기 = 영업 공간 사람');
  const c = await ctx.staffA.client.ok('POST', `/api/sales/support/${P.b1}/work`, { status: 'applied' });
  assert.deepEqual([c.item.work.status, c.item.work.appliedAt], ['applied', today]); assert.equal((await task())[0].status, 'done', '신청하면 업무 완료');
  const s = await ctx.staffA.client.ok('POST', `/api/sales/support/${P.b1}/work`, { status: 'selected', amountAwarded: '700만원', resultMemo: '선정 통보 메일' });
  assert.deepEqual([s.item.work.status, s.item.work.resultAt, s.item.work.amountAwarded, s.item.work.resultMemo], ['selected', today, '700만원', '선정 통보 메일']);
  assert.deepEqual(s.log.map((l) => l.to_status), ['selected', 'applied', 'preparing', 'interest']);
  const res = await ctx.staffA.client.ok('GET', '/api/sales/support?tab=results');
  assert.equal(find(res.items, B.b1.pblancNm).work.statusLabel, '선정');
  assert.ok(!find((await ctx.staffA.client.ok('GET', '/api/sales/support?tab=mine')).items, B.b1.pblancNm));
});

test('직접 추가: 지난 신청 이력(신청 완료·신청일·결과 메모) → 신청·결과 탭 · 고치기·지우기는 넣은 사람·관리자만 · 다른 회사 공고는 404', async () => {
  const m = await ctx.owner.ok('POST', '/api/sales/support', { title: 'E2E 시 지식재산 긴급지원 사업(3차)', agency: '경기지식재산센터', applyStart: '2026-09-08', applyEnd: '2026-09-15', amount: '상표 42만원 이내', region: '경기',
    status: 'applied', appliedAt: '2026-09-12', resultMemo: '결과 대기 — 개별 통보' });
  assert.deepEqual([m.item.manual, m.item.work.status, m.item.work.appliedAt, m.item.work.resultMemo, m.item.regions], [true, 'applied', '2026-09-12', '결과 대기 — 개별 통보', ['경기']]);
  assert.equal(m.task, null, '이미 신청한 이력은 업무를 만들지 않음');
  assert.ok(find((await ctx.staffA.client.ok('GET', '/api/sales/support?tab=results')).items, 'E2E 시 지식재산 긴급지원 사업(3차)'), '마감이 지나도 신청·결과 탭에');
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/sales/support/${m.item.id}`, { amount: 'x' })).status, 403);
  assert.equal((await ctx.owner.ok('PATCH', `/api/sales/support/${m.item.id}`, { amount: '상표 42만원·디자인 48만원 이내' })).item.amount, '상표 42만원·디자인 48만원 이내');
  assert.equal((await ctx.owner.req('POST', '/api/sales/support', { title: 'x' })).status, 400);
  await sql`insert into tenants (id, name) values ('o_sup', '남의회사') on conflict do nothing`;
  const [o] = await sql`insert into support_programs (tenant, source, source_id, title) values ('o_sup', 'manual', 'o-1', '남의 회사 비공개 공고') returning id`;
  assert.equal((await ctx.owner.req('GET', `/api/sales/support/${o.id}`)).status, 404);
  assert.equal((await ctx.owner.req('POST', `/api/sales/support/${o.id}/work`, { status: 'interest' })).status, 404);
  assert.ok(!find((await ctx.owner.ok('GET', '/api/sales/support?tab=all')).items, '남의 회사 비공개 공고'));
  assert.equal((await ctx.staffA.client.req('DELETE', `/api/sales/support/${m.item.id}`)).status, 403);
  await ctx.owner.ok('DELETE', `/api/sales/support/${m.item.id}`);
  assert.equal((await ctx.owner.req('GET', `/api/sales/support/${m.item.id}`)).status, 404);
  assert.equal((await ctx.owner.req('DELETE', `/api/sales/support/${P.b1}`)).status, 403, '수집한 공고는 못 지움');
});

test('마감 알림: 7일 안 → D-7 한 번 · 3일 안에 처음 잡힌 건은 D-3 하나만 · 다시 돌려도 그대로 · 3일 안으로 들어오면 D-3 · 영업 홈 카드', async () => {
  const r1 = await ctx.owner.ok('POST', '/api/sales/support', { title: 'E2E 알림 시험 1', applyEnd: d(5), status: 'interest' });
  await ctx.owner.ok('POST', '/api/sales/support', { title: 'E2E 알림 시험 2', applyEnd: d(2), status: 'preparing' });
  const notes = async () => (await sql`select title from notifications where user_id = ${ctx.ownerId} and type = 'support_deadline' order by title`).map((x) => x.title);
  await tick();
  assert.deepEqual(await notes(), ['지원사업 마감 D-2: E2E 알림 시험 2', '지원사업 마감 D-5: E2E 알림 시험 1']);
  await tick();
  assert.equal((await notes()).length, 2, '다시 돌려도 그대로');
  await sql`update support_programs set apply_end = ${d(3)} where id = ${r1.item.id}`;
  await tick();
  assert.deepEqual(await notes(), ['지원사업 마감 D-2: E2E 알림 시험 2', '지원사업 마감 D-3: E2E 알림 시험 1', '지원사업 마감 D-5: E2E 알림 시험 1']);
  const h = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  // #649 ③(대표 10/25 23:20): '맞춤'은 AI 가 판정한 것만 — 1차 규칙만 맞는 '경기 마케팅 D-6'은 '확인 중'(pending)으로 따로
  assert.deepEqual([h.support.closing, h.support.mine, h.support.fit], [2, 2, 0], '7일 안: 관심·준비 2(알림 시험) · AI 판정 전 맞춤은 안 셈');
  assert.ok(h.support.pending >= 1, `1차 맞춤(AI 확인 중) ${JSON.stringify(h.support)}`);
  assert.ok(h.support.fitOpen >= h.support.fit && h.support.mineOpen >= h.support.mine, `#647 홈 고정 카드: 신청 가능 맞춤·관심 수 ${JSON.stringify(h.support)}`);
});

test('#568 주 1회 묶음: 1차 ✅·AI 판단 없는 공고를 자동 판단(최대 5, 접목할 점 포함) → 이번 주 맞는 공고 묶음 기록 + 관리자·담당 알림 1건(주마다 한 번) · 목록 응답 weekly · [지금 다시 묶기]는 관리자만', async () => {
  await sql`delete from support_weekly`; await sql`delete from notifications where type = 'support_weekly'`; // 앞 시험의 tick 이 만든 묶음(가짜 AI 답 없음 → 판단 실패)은 치움
  const before = await ctx.owner.ok('GET', '/api/sales/support?limit=200');
  const todo = before.items.filter((x) => !x.ai && x.rule.verdict === 'fit').slice(0, 5);
  assert.ok(todo.length >= 1, '자동 판단할 1차 ✅ 공고가 있어야');
  await ctx.staffA.client.ok('POST', `/api/sales/support/${todo[0].id}/work`, { status: 'interest' }); // 관심·준비 담당(staffA)도 묶음 알림을 받는지(앞 시험에서 staffA 의 열린 건은 모두 닫힘)
  await queue(todo.map((x, i) => say({ verdict: i === 0 ? 'fit' : 'maybe', reasons: ['경기 소재 중소기업 — 해당'], brands: ['워크인'], docs: ['신청서'], summary: `요약 ${i}`, amount: null, use: [`접목 ${i}: 온라인 광고비로`], schedule: `마감 ${x.applyEnd ?? '미정'}` })));
  const r = await tick();
  assert.ok(r.detail?.supportWeekly?.tenants >= 1, JSON.stringify(r.detail?.supportWeekly));
  const rows = await sql`select week::text as week, items, ai_count, ai_failed, sent_to from support_weekly`;
  assert.equal(rows.length, 1); const w = rows[0];
  assert.deepEqual([w.ai_count, w.ai_failed], [todo.length, 0]);
  assert.ok(w.items.length >= 1 && w.items.length <= 10);
  const first = w.items.find((x) => x.id === todo[0].id);
  assert.deepEqual([first?.by, first?.auto, first?.use], ['ai', true, '접목 0: 온라인 광고비로'], JSON.stringify(w.items));
  assert.ok(w.items.every((x) => x.by === 'rule' || x.by === 'ai'));
  assert.equal((await sql`select ai_auto from support_matches where program_id = ${todo[0].id}`)[0].ai_auto, true, '자동 판단 표시');
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_support' and user_id = ${ctx.ownerId}`)[0].n >= todo.length, true, '자동 판단 사용량은 관리자(대표) 이름으로');
  const n = await sql`select user_id, title, body, link from notifications where type = 'support_weekly'`;
  assert.ok(n.some((x) => x.user_id === ctx.ownerId), '대표에게'); assert.ok(n.some((x) => x.user_id === ctx.staffA.id), '관심·준비 담당(staffA)에게도');
  assert.match(n[0].title, /^이번 주 맞는 지원사업 \d+건$/); assert.match(n[0].body, /AI 세일즈가 새로 판단 \d+건/); assert.equal(n[0].link, '/s/sales/support?tab=fit');
  assert.ok(w.sent_to >= 2);
  const v = await ctx.staffA.client.ok('GET', '/api/sales/support');
  assert.deepEqual([v.weekly.week, v.weekly.aiCount, v.weekly.items.length], [w.week, todo.length, w.items.length]);
  await tick();
  assert.equal((await sql`select count(*)::int n from support_weekly`)[0].n, 1, '같은 주엔 한 번');
  assert.equal((await sql`select count(*)::int n from notifications where type = 'support_weekly' and user_id = ${ctx.ownerId}`)[0].n, 1);
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/support/weekly', {})).status, 403, '관리자만');
  const m = await ctx.owner.ok('POST', '/api/sales/support/weekly', {});
  assert.equal(m.week, w.week); assert.ok(m.weekly.items.length >= 1); assert.equal(m.aiCount, 0, '다시 묶어도 이미 판단한 건은 다시 안 돌림');
  assert.equal((await sql`select count(*)::int n from notifications where type = 'support_weekly' and user_id = ${ctx.ownerId}`)[0].n, 1, '수동으로 다시 만들어도 알림은 주마다 한 번');
});

test('#649·#651(대표 10/25 23:20): 대상 업종 ≠ 우리 업종 → 해당 없음(전 업종·우대 문구는 예외, 제목에만 있으면 확인 필요) · 관심 키워드만으로는 맞춤 아님 · 1차 맞춤은 AI 판정 전 "확인 중" · 깨진 제목은 맞춤·마감 임박에서 숨김 · 해독기(charset 우선·한글 비율)', async () => {
  const { decodeKoreanText, koreanScore, garbledText } = await import('../../src/lib/sales/collectors/koreanText.ts'); // Node 22 형식 제거로 .ts 직접 불러옴(잎 모듈)
  // 해독기 — UTF-8 응답에 깨진 바이트가 하나 섞여도 전체를 EUC-KR 로 읽지 않음(143건 원인) · EUC-KR 응답은 EUC-KR · charset 헤더가 있으면 그대로
  const ko = '2026년 하반기 중점산업 창업 중소기업 육성';
  const utf = new TextEncoder().encode(JSON.stringify({ title: ko }));
  const mixed = new Uint8Array([...utf.slice(0, 12), 0xff, ...utf.slice(12)]);
  assert.deepEqual([decodeKoreanText(utf).encoding, decodeKoreanText(utf).by], ['utf-8', 'clean']);
  const m1 = decodeKoreanText(mixed); assert.deepEqual([m1.encoding, m1.by], ['utf-8', 'score']); assert.ok(m1.text.includes('중소기업 육성'), m1.text);
  const euc = new Uint8Array([0xc1, 0xdf, 0xbc, 0xd2, 0xb1, 0xe2, 0xbe, 0xf7, 0x20, 0xc1, 0xf6, 0xbf, 0xf8]); // '중소기업 지원' EUC-KR
  const e1 = decodeKoreanText(euc); assert.deepEqual([e1.encoding, e1.by, e1.text], ['euc-kr', 'score', '중소기업 지원']);
  assert.deepEqual([decodeKoreanText(euc, 'text/html; charset=EUC-KR').by, decodeKoreanText(utf, 'application/json; charset=utf-8').by], ['charset', 'charset']);
  assert.ok(koreanScore(ko) > 0.5 && koreanScore('以��議� �뱁 Multi AI Agent 媛諛(R&D) ��� Track ��怨� 怨듦') < 0);
  assert.deepEqual([garbledText('以��議� �뱁 Multi AI Agent 媛諛(R&D) ��� Track ��怨� 怨듦'), garbledText(ko), garbledText('Multi AI Agent R&D Track'), garbledText(''), garbledText(null)], [true, false, false, false, false]);
  // 규칙 — 프로필 업종 소프트웨어·피트니스, 관심 IP·마케팅
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시', founded: d(-2200), size: '소기업', employees: 12, industries: ['소프트웨어', '피트니스'], keywords: ['출입'], certs: ['벤처기업'], brands: ['다짐', '하이링크', '워크인'], interests: ['IP', '마케팅'], excludes: [], memo: '시험 회사 소개' });
  const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: [], nationwide: true, hashtags: [], attachments: sql.json([]), apply_end: d(20), ...o })} returning id`.then((r) => r[0].id);
  const g = '以��議� �뱁 Multi AI Agent 媛諛(R&D) ��� Track ��怨� 怨듦';
  const [t1, t2, t3, t4, t5, t6, t7] = await Promise.all([
    ins({ source_id: 'IND-1', title: '[시험] 로컬 인디브랜드 성장 프로그램', target: '식품제조가공업·즉석판매제조가공업 기업', biz_years: '3년미만,5년미만,7년미만', summary: '마케팅·판로 지원' }),
    ins({ source_id: 'IND-2', title: '[시험] 제조·IT 중소기업 디지털 전환', target: '제조업, 정보통신업 등 전 업종 중소기업', summary: '마케팅 지원' }),
    ins({ source_id: 'IND-3', title: '[시험] 중소기업 수출 바우처', target: '중소기업(제조업 우대)', summary: '해외 마케팅 지원' }),
    ins({ source_id: 'IND-4', title: '[시험] 빅웨이브 IR 초격차 반도체 분야', target: '중소기업', summary: 'IR 지원' }),
    ins({ source_id: 'IND-5', title: '[시험] 온라인 마케팅 바우처', target: '중소기업', summary: '온라인 광고·홍보 지원' }),
    ins({ source_id: 'IND-6', title: '[경기] [시험] 체육시설 운영 기업 디지털 지원', target: '체육시설업 영위 중소기업', regions: ['경기'], nationwide: false, summary: '피트니스 시설 마케팅 지원' }),
    ins({ source_id: 'IND-7', title: g, target: '중소기업', summary: '깨진 글자' }),
  ]);
  const all = (await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200')).items;
  const by = (id) => all.find((x) => x.id === id);
  assert.equal(by(t1).rule.verdict, 'no'); assert.ok(by(t1).rule.flags.some((f) => f.level === 'no' && /식품 업종 대상\(우리 소프트웨어·피트니스\)/.test(f.text)), JSON.stringify(by(t1).rule.flags));
  assert.notEqual(by(t2).rule.verdict, 'no', '전 업종 문구'); assert.ok(!by(t2).rule.flags.some((f) => f.level === 'no'), JSON.stringify(by(t2).rule.flags));
  assert.notEqual(by(t3).rule.verdict, 'no', '우대 구절은 뺌'); assert.ok(!by(t3).rule.flags.some((f) => /업종/.test(f.text)), JSON.stringify(by(t3).rule.flags));
  assert.ok(by(t4).rule.flags.some((f) => f.level === 'warn' && /제목에 반도체소재 업종/.test(f.text)), JSON.stringify(by(t4).rule.flags));
  assert.equal(by(t5).rule.verdict, 'maybe', '관심 키워드(마케팅)만으로는 맞춤이 안 됨'); assert.ok(by(t5).rule.flags.some((f) => /^관심:/.test(f.text)));
  assert.equal(by(t6).rule.verdict, 'fit'); assert.ok(by(t6).rule.flags.some((f) => f.level === 'ok' && /대상 업종 스포츠 — 우리 업종/.test(f.text)), JSON.stringify(by(t6).rule.flags));
  assert.deepEqual([by(t6).pending, by(t6).ai, by(t6).garbled], [true, null, false], 'AI 판정 전 1차 맞춤 = 확인 중');
  assert.deepEqual([by(t7).rule.verdict, by(t7).garbled], ['no', true]); assert.ok(by(t7).rule.flags.some((f) => /글자가 깨져/.test(f.text)));
  const fit = (await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200')).items;
  assert.ok(fit.some((x) => x.id === t6) && !fit.some((x) => x.id === t7) && !fit.some((x) => x.id === t1), '맞춤 탭: 1차 맞춤(확인 중)은 보이고 깨진·업종 불일치는 안 보임');
  const cl = (await ctx.owner.ok('GET', '/api/sales/support?tab=closing&limit=200')).items;
  assert.ok(!cl.some((x) => x.id === t7), '마감 임박에도 깨진 건 없음');
  const h = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.ok(h.support.pending >= 1 && h.support.fit === 0, `홈 카드: AI 판정 전은 pending 으로 ${JSON.stringify(h.support)}`);
  await sql`delete from support_programs where source_id like 'IND-%'`;
});

test('#649 후속(로컬 10/25 157차 확인 거짓 해당 없음 3건): 제외 업종 목록(음식점·미용·부동산)·"홍보 경비"는 대상 업종이 아님 · 프로필 "공동주택 커뮤니티시설 위탁운영" = 시설관리·스포츠 · 여러 업종 나열은 하나만 겹쳐도 통과', async () => {
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시', founded: d(-2200), size: '소기업', employees: 12, industries: ['운동·피트니스', '공동주택 커뮤니티시설 위탁운영', '소프트웨어·SaaS'], keywords: ['출입'], certs: ['벤처기업'], brands: ['다짐', '하이링크', '워크인'], interests: ['IP', '마케팅'], excludes: [], memo: '시험 회사 소개' });
  const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: [], nationwide: true, hashtags: [], attachments: sql.json([]), apply_end: d(20), ...o })} returning id`.then((r) => r[0].id);
  const [t8, t9, t10, t11, t12] = await Promise.all([
    ins({ source_id: 'IND-8', title: '[시험] 스타트업 언론홍보·미디어 콘텐츠 확산 지원', target: '창업 7년 이내 중소기업 (단, 부동산업·유흥업 제외) ※ 홍보 경비 지원', summary: '언론 홍보 지원' }),
    ins({ source_id: 'IND-9', title: '[시험] 벤처확인 인증준비기업 맞춤형 무료 진단', target: '중소기업\n※ 제외 업종: 음식점업, 미용업, 부동산업 등', summary: '진단 지원' }),
    ins({ source_id: 'IND-10', title: '[시험] 공동주택 관리 업체 디지털 전환', target: '공동주택 위탁관리·시설관리 업체, 경비·청소 용역업', summary: '디지털 전환 지원' }),
    ins({ source_id: 'IND-11', title: '[시험] 식품·뷰티·시설관리 수출 바우처', target: '식품·화장품·시설관리 업종 중소기업', summary: '여러 업종 나열' }),
    ins({ source_id: 'IND-12', title: '[시험] 로컬 인디브랜드 성장 프로그램', target: '식품제조가공업·즉석판매제조가공업 기업', summary: '여전히 해당 없음' }),
  ]);
  const all = (await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200')).items;
  const by = (id) => all.find((x) => x.id === id);
  for (const id of [t8, t9]) assert.ok(!by(id).rule.flags.some((f) => f.level === 'no' || /업종 대상\(/.test(f.text)), `제외 목록·경비는 업종 판단에 안 씀(제목 낱말 경고는 그대로) ${JSON.stringify(by(id).rule.flags)}`);
  assert.notEqual(by(t8).rule.verdict, 'no'); assert.notEqual(by(t9).rule.verdict, 'no');
  assert.ok(by(t10).rule.flags.some((f) => f.level === 'ok' && /대상 업종 시설관리 — 우리 업종/.test(f.text)), JSON.stringify(by(t10).rule.flags)); assert.notEqual(by(t10).rule.verdict, 'no');
  assert.ok(by(t11).rule.flags.some((f) => f.level === 'ok' && /대상 업종 시설관리/.test(f.text)), `하나만 겹쳐도 통과 ${JSON.stringify(by(t11).rule.flags)}`); assert.notEqual(by(t11).rule.verdict, 'no');
  assert.equal(by(t12).rule.verdict, 'no'); assert.ok(by(t12).rule.flags.some((f) => f.level === 'no' && /식품 업종 대상/.test(f.text)));
  await sql`delete from support_programs where source_id like 'IND-%'`;
});
