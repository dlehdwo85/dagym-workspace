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
  srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'dg-key', SUPPORT_REMIND_HOURS: '0-24' });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.managerA.id, spaces: ['sales'] });
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); src?.close(); fg?.server.close(); await sql?.end(); });

test('수집기 15개(지원사업 3개 · 08·14시 두 번) · 회사 프로필: 기본값 → 관리자만 저장 · 시·도는 목록에서', async () => {
  const v = await ctx.owner.ok('GET', '/api/sales/collectors');
  assert.equal(v.collectors.length, 15);
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

test('K-Startup: 모집 중·접수 마감 오늘 이후만 요청 · 업력·지역·상세/신청 링크 · 키 오류는 \'활용신청·인증키 확인 필요\'(키는 가림)', async () => {
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
  assert.equal(bad.status, 'failed'); assert.match(bad.errorLog, /활용신청·인증키 확인 필요/); assert.ok(!bad.errorLog.includes('bad-key'), '키는 가림');
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
  await queue([say({ verdict: 'fit', reasons: ['용인시 소재 중소기업 대상 — 본점 용인시라 해당', '기출원 건 지원 불가 — 출원 전에 신청'], brands: ['하이링크', '없는브랜드'], docs: ['사업자등록증', '중소기업 확인서'], summary: 'IP 전략 컨설팅 지원', amount: '최대 1,000만원' })]);
  const r = await ctx.staffA.client.ok('POST', `/api/sales/support/${P.b1}/analyze`, {});
  assert.deepEqual([r.ai.verdict, r.ai.brands, r.ai.docs], ['fit', ['하이링크'], ['사업자등록증', '중소기업 확인서']]); assert.ok(r.costKrw >= 1);
  const req = (await fakeState()).anthropic.at(-1).body;
  assert.match(req.system, /기출원 건 지원 불가/); assert.match(req.system, /다짐, 하이링크, 워크인/); assert.match(req.system, /SW사업자 신고/);
  const text = req.messages[0].content[0].text;
  assert.match(text, /\[회사 프로필\]\n본점: 경기 용인시/); assert.match(text, /보유 인증: 벤처기업/); assert.match(text, /\[공고\]\n공고명: \[경기\] 2026년 용인IP지원센터/); assert.match(text, /용인시 소재 중소기업 IP 전략수립/);
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_support'`)[0].n, 1);
  const v = await ctx.staffA.client.ok('GET', '/api/sales/support');
  assert.equal(v.items[0].id, P.b1, 'AI 가 ✅ 로 본 공고가 맨 위'); assert.equal(v.items[0].ai.verdict, 'fit');
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
  assert.deepEqual(h.support, { closing: 3, mine: 2, fit: 1 }, '7일 안: 관심·준비 2(알림 시험) + 맞춤 1(경기 마케팅 D-6)');
});
