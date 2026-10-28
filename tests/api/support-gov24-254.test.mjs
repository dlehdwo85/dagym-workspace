// 254차 #788(로컬 10/29 00:40, 대표 00:50 승인): 정부24 '대한민국 공공서비스(혜택) 정보'(공공데이터포털 15113968, api.odcloud.kr gov24 v3) → 지원사업 원천 gov24
// · 사용자구분 소상공인·법인/시설/단체만 · 신청기한 상시 = 마감 없음 · 지원유형 → 종류 · 지자체 → 지역 · 처음엔 전체(쪽마다 저장), 그 뒤엔 수정일시 이후만 · supportConditions JA 코드 → 1차 규칙
// · 대상 칩(중소기업·법인 / 소상공인 / 고용 지원금 — 소상공인 칩은 해당 없음도 이유와 함께) · 기업마당 같은 사업과 하나로 · 키 활용신청 전 안내
// (구조 시험 — 가짜 응답은 명세 칸 이름 그대로. 실제 정부24 수집은 운영에서 키 활용신청 뒤 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

const PORT = 3284; const BASE = `http://localhost:${PORT}`;
const today = seoulToday(); const d = (n) => addDays(today, n);
let srv, ctx, sql, fake; let mode = 'ok'; const calls = [];
const svc = (o) => ({ 서비스ID: o.id, 서비스명: o.name, 서비스목적요약: `${o.name} 요약`, 지원유형: o.kind ?? '현금', 서비스분야: o.field ?? '고용·창업', 사용자구분: o.users, 소관기관명: o.agency ?? '시험중소벤처기업부', 소관기관유형: o.agencyType ?? '중앙행정기관',
  부서명: '시험과', 지원대상: o.target ?? '중소기업', 선정기준: o.criteria ?? null, 지원내용: o.content ?? '사업비 지원', 신청방법: '온라인 신청', 신청기한: o.deadline ?? '상시신청', 신청기한유형: o.dtype ?? '상시',
  상세조회URL: `https://www.gov.kr/portal/rcvfvrSvc/dtlEx/${o.id}`, 접수기관: '시험센터', 전화문의: '1357', 등록일시: '20260101090000', 수정일시: o.mod ?? '20261020101010', 조회수: 10 });
const LIST = [
  svc({ id: 'G1', name: '시험 소상공인 경영안정자금', users: '소상공인', kind: '현금(융자)', content: '업체당 최대 7천만원 융자', target: '상시근로자 5인 미만 소상공인' }),
  svc({ id: 'G2', name: '시험 중소기업 정보통신 바우처', users: '법인/시설/단체', content: '최대 3,000만원 바우처' }),
  svc({ id: 'G3', name: '시험 제조 중소기업 스마트 설비 지원', users: '법인/시설/단체', field: '농림축산어업' }),
  svc({ id: 'G4', name: '시험 출산 축하금', users: '개인||가구', field: '임신·출산' }),
  svc({ id: 'G5', name: '시험 청년 채용 장려금', users: '소상공인||법인/시설/단체', target: '청년을 정규직으로 신규 채용한 기업', content: '1인당 월 60만원' }),
  svc({ id: 'G6', name: '2026년 시험 수출바우처 지원사업', users: '법인/시설/단체', agency: '시험산업통상자원부' }),
  svc({ id: 'G7', name: '시험 용인 중소기업 육성자금', users: '법인/시설/단체', agency: '경기도 용인시', agencyType: '지방자치단체', deadline: `${d(-5).replace(/-/g, '.')} ~ ${d(25).replace(/-/g, '.')}`, dtype: '기간' }),
  svc({ id: 'G8', name: '시험 사회복지시설 운영비 지원', users: '법인/시설/단체', field: '보호·돌봄' }),
];
const cond = (id, ...ys) => ({ 서비스ID: id, 서비스명: id, JA0101: 'Y', ...Object.fromEntries(['JA1101', 'JA1102', 'JA1103', 'JA1201', 'JA1202', 'JA1299', 'JA2101', 'JA2102', 'JA2103', 'JA2201', 'JA2202', 'JA2203', 'JA2299'].map((k) => [k, ys.includes(k) ? 'Y' : null])) });
let CONDS = [cond('G1', 'JA1102'), cond('G2', 'JA2101', 'JA2203'), cond('G3', 'JA2101', 'JA2201'), cond('G4'), cond('G5', 'JA1102', 'JA2101'), cond('G6', 'JA2101'), cond('G7', 'JA2101'), cond('G8', 'JA2102')];
const odc = (all, q) => { const page = Number(q.get('page') ?? 1), per = Number(q.get('perPage') ?? 10); const data = all.slice((page - 1) * per, page * per);
  return { page, perPage: per, totalCount: all.length, currentCount: data.length, matchCount: all.length, data }; };
const run = () => ctx.owner.ok('POST', '/api/sales/collectors/gov24_support/run', {});
const gov = () => sql`select source_id, title, conditions, regions, nationwide, apply_end, apply_text, category, url from support_programs where source = 'gov24' order by source_id`;
const list = (p) => ctx.owner.ok('GET', `/api/sales/support?limit=200&dd=all&kind=all&${p}`);

before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const q = u.searchParams; calls.push({ path: u.pathname, q: Object.fromEntries(q) });
    const json = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
    if (mode === 'unregistered') return json({ code: -4, msg: '등록되지 않은 인증키 입니다.' }, 401); // odcloud 실제 응답 꼴
    if (u.pathname === '/agency/gov24_support/serviceList') { const since = q.get('cond[수정일시::GTE]'); return json(odc(since ? LIST.filter((x) => x.수정일시 >= since) : LIST, q)); }
    if (u.pathname === '/agency/gov24_support/supportConditions') { const id = q.get('cond[서비스ID::EQ]'); return json(odc(id ? CONDS.filter((x) => x.서비스ID === id) : CONDS, q)); }
    res.writeHead(404); res.end('nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: BASE, DATA_GO_KR_SERVICE_KEY: 'gov24-test-key', SUPPORT_AUTO_AI: 'off', SUPPORT_WEEKLY_AI_MAX: '0' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시', founded: d(-1735), size: '소기업', employees: 12, industries: ['운동·피트니스', '소프트웨어·SaaS'], keywords: ['바우처'], certs: [], brands: [], interests: [], excludes: [], memo: null });
  // 기업마당에 같은 사업 공고(정부24 상시 서비스와 하나로 보여야 함)
  await sql`insert into support_programs (source, source_id, title, agency, target, regions, nationwide, apply_end, hashtags, attachments) values ('bizinfo', 'B-254', '시험 수출바우처 지원사업 참여기업 모집', '시험산업통상자원부', '중소기업', '{}', true, ${d(20)}, '{}', '[]')`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('수집: 소상공인·법인 대상만 · 상시 = 마감 없음 · 지원유형·분야 → 분류 · 지자체 → 지역 · 지원 조건 코드 · 처음 채움 건수와 예상 비용 · 키는 주소에만', async () => {
  const r = await run();
  assert.equal(r.status, 'success', JSON.stringify(r));
  assert.match(r.summary, /^정부24\(바뀐 것만\(마지막 전체 \d{4}-\d{2}-\d{2}\)\): 2번 호출 · 받은 8건 중 소상공인·법인 대상 7건 · 신규 7 · 바뀜 0 · 변화없음 0 · 조건 7 · 처음 채움 끝: 소상공인·법인 대상 7건 — 자동 AI 판단은 회사 AI 예산 안에서 한 번에 10건씩, 많아야 약 14원/, r.summary);
  const rows = await gov(); const by = Object.fromEntries(rows.map((x) => [x.source_id, x]));
  assert.deepEqual(rows.map((x) => x.source_id), ['G1', 'G2', 'G3', 'G5', 'G6', 'G7', 'G8'], '개인·가구(G4)는 안 받음');
  assert.deepEqual([by.G1.apply_end, by.G1.apply_text, by.G1.category, by.G1.url], [null, '상시 신청', '현금(융자) · 고용·창업', 'https://www.gov.kr/portal/rcvfvrSvc/dtlEx/G1']);
  assert.deepEqual([by.G7.regions, by.G7.nationwide, by.G7.apply_end], [['경기'], false, d(25)], '지자체 서비스는 그 지역 · 기간 서비스는 마감일');
  assert.deepEqual([by.G1.regions, by.G1.nationwide], [[], true]);
  assert.deepEqual(by.G2.conditions, ['JA2101', 'JA2203']); assert.deepEqual(by.G1.conditions, ['JA1102']); assert.deepEqual(by.G8.conditions, ['JA2102'], '개인 조건(JA0101)은 버림');
  const sl = calls.filter((c) => c.path.endsWith('/serviceList')), sc = calls.filter((c) => c.path.endsWith('/supportConditions'));
  assert.deepEqual([sl.length, sl[0].q.perPage, sl[0].q.serviceKey, sc.length, sc[0].q.perPage], [1, '500', 'gov24-test-key', 1, '1000']);
  const runRow = (await sql`select summary, error_log from sales_collector_runs where slug = 'gov24_support' order by started_at desc limit 1`)[0];
  assert.ok(!JSON.stringify(runRow).includes('gov24-test-key'), '키는 기록에 안 남김');
  assert.deepEqual((await sql`select value from app_settings where key = 'gov24_sync'`)[0].value.phase, 'idle');
});

test('1차 규칙(지원 조건 코드): 소상공인만 → 상시근로자 12명이라 해당 없음 · 중소기업+정보통신업 → 맞음 · 제조업만 → 해당 없음 · 사회복지시설 → 해당 없음 · 소상공인·중소기업 둘 다 → 맞음', async () => {
  const all = Object.fromEntries((await list('tab=all&aud=all')).items.filter((x) => x.source === 'gov24').map((x) => [x.title, x]));
  const t = (name) => all[name]?.rule.flags.map((f) => `${f.level}:${f.text}`);
  assert.equal(all['시험 소상공인 경영안정자금'].final.verdict, 'no'); assert.ok(t('시험 소상공인 경영안정자금').includes('no:소상공인 대상 — 우리 회사는 상시근로자 12명이라 소상공인 아님'), t('시험 소상공인 경영안정자금'));
  assert.equal(all['시험 중소기업 정보통신 바우처'].rule.verdict, 'fit'); assert.ok(t('시험 중소기업 정보통신 바우처').includes('ok:대상 업종 정보통신업 — 우리 업종'), t('시험 중소기업 정보통신 바우처'));
  assert.equal(all['시험 제조 중소기업 스마트 설비 지원'].final.verdict, 'no'); assert.ok(t('시험 제조 중소기업 스마트 설비 지원').includes('no:제조업 대상(우리 운동·피트니스·소프트웨어·SaaS)'), t('시험 제조 중소기업 스마트 설비 지원'));
  assert.equal(all['시험 사회복지시설 운영비 지원'].final.verdict, 'no'); assert.ok(t('시험 사회복지시설 운영비 지원').includes('no:사회복지시설·기관/단체 대상'));
  assert.notEqual(all['시험 청년 채용 장려금'].final.verdict, 'no', t('시험 청년 채용 장려금')); assert.ok(t('시험 청년 채용 장려금').includes('ok:중소기업 대상'));
  assert.equal(all['시험 용인 중소기업 육성자금'].dday, 25);
  assert.equal(all['시험 소상공인 경영안정자금'].sourceLabel, '정부24 지원금');
});

test("대상 칩: 중소기업·법인 / 소상공인(해당 없음도 이유와 함께) / 고용 지원금 · 칩 숫자 · 사람별 기억 · 기업마당 같은 사업은 하나로('정부24 지원금'에도)", async () => {
  const fit = await list('tab=fit&aud=all'); const names = (v) => v.items.filter((x) => x.source === 'gov24').map((x) => x.title).sort();
  assert.deepEqual(names(fit), ['시험 용인 중소기업 육성자금', '시험 중소기업 정보통신 바우처', '시험 청년 채용 장려금'], '맞춤 탭은 해당 없음 빼고 · 수출바우처는 기업마당 공고로 합쳐짐');
  assert.deepEqual(fit.audLabel, { corp: '중소기업·법인', small: '소상공인', job: '고용 지원금' });
  const small = await list('tab=fit&aud=small');
  assert.deepEqual(names(small), ['시험 소상공인 경영안정자금', '시험 청년 채용 장려금'], '소상공인 칩은 우리 회사에 해당 없는 것도 보임');
  assert.equal(small.items.find((x) => x.title === '시험 소상공인 경영안정자금').final.verdict, 'no');
  assert.equal(fit.chips.aud.small, 2, '소상공인 칩 숫자도 해당 없음까지'); assert.equal(fit.chips.aud.job, 1);
  assert.deepEqual(names(await list('tab=fit&aud=job')), ['시험 청년 채용 장려금']);
  assert.ok(names(await list('tab=fit&aud=corp')).includes('시험 중소기업 정보통신 바우처'));
  await ctx.owner.ok('PUT', '/api/sales/support/view', { aud: 'job' }); assert.equal((await ctx.owner.ok('GET', '/api/sales/support?tab=fit')).view.aud, 'job', '마지막에 고른 칩 기억');
  assert.equal((await ctx.owner.req('PUT', '/api/sales/support/view', { aud: 'gov' })).status, 400);
  await ctx.owner.ok('PUT', '/api/sales/support/view', { aud: 'all' });
  const biz = (await list('tab=all&aud=all')).items.filter((x) => /수출바우처/.test(x.title));
  assert.deepEqual(biz.map((x) => [x.source, x.alsoOn]), [['bizinfo', ['정부24 지원금']]], '정부24 줄은 숨기고 기업마당 공고에 출처 표시');
  const src = (await list('tab=fit&aud=all')).bySource.counts.find((x) => x.source === 'gov24');
  assert.deepEqual([src.label, src.n], ['정부24 지원금', 6], '기업마당 공고와 합친 1건은 기업마당 쪽에서 셈');
});

test('두 번째부터는 수정일시 이후만 · 바뀐 서비스의 지원 조건만 다시 · 활용신청 전 키는 알아보기 쉬운 말', async () => {
  calls.length = 0;
  LIST[1] = { ...LIST[1], 서비스명: '시험 중소기업 정보통신 바우처(2차)', 수정일시: '20261028090000' }; CONDS = CONDS.map((c) => (c.서비스ID === 'G2' ? cond('G2', 'JA2101', 'JA2201') : c));
  const r = await run();
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.match(r.summary, /^정부24\(바뀐 것만.*: 1번 호출 · 받은 8건 중 소상공인·법인 대상 7건 · 신규 0 · 바뀜 1 · 변화없음 6 · 조건 1$/, r.summary);
  assert.equal(calls.find((c) => c.path.endsWith('/serviceList')).q['cond[수정일시::GTE]'], '20261020101010', '지난번 마지막 수정일시부터');
  assert.deepEqual(calls.filter((c) => c.path.endsWith('/supportConditions')).map((c) => c.q['cond[서비스ID::EQ]']), ['G2'], '그 뒤에 바뀐 서비스의 지원 조건만');
  const g2 = (await gov()).find((x) => x.source_id === 'G2'); assert.deepEqual([g2.title, g2.conditions], ['시험 중소기업 정보통신 바우처(2차)', ['JA2101', 'JA2201']]);
  mode = 'unregistered';
  const bad = await run(); mode = 'ok';
  assert.equal(bad.status, 'failed'); assert.equal(bad.summary, '정부24: 공공데이터포털 활용신청 필요(서비스 15113968) — 키는 그대로 두고 포털(data.go.kr)에서 [활용신청]');
  const col = (await ctx.owner.ok('GET', '/api/sales/collectors')).collectors.find((c) => c.slug === 'gov24_support');
  assert.deepEqual([col.label, col.needs[0].present], ['지원사업 · 정부24 지원금', true]);
});
