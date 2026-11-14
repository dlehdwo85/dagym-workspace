// 414차 영업 일반화(G-37~G-42, 노트북 11/14 안 표 A~F 가안 · 대표 11/13 "회사별로, 사용자가 설정할 수 있도록, 다짐 세팅은 절대 건드리지 않는다")
// 공용 공고 줄에 저장된 판정(관련·적합 사업·분류)은 기본 회사 전용. 다른 회사는
//   C 입찰 목록·아침 메일 = 회사 검색어(맞춤 검색어 + 관심 사업 낱말) + 제외어, 검색어가 없으면 '관심 검색어를 넣어 주세요'
//   E '적합 사업'·분류·'면허 업체 협력 필요'·맞은 낱말(기본 회사 판정)이 안 보임
//   F 협력사 모집(건설사 공지 감시) 줄이 목록·메일에 없음
//   A 준공·입주 시설 탭, D 입찰: 영업 용어 묶음이 시설 운영·위탁/건설일 때만 기본 켜짐(그 밖은 직접 켜면 보임)
//   D 아침 메일은 검색어를 넣은 회사만, B 주간 후속조사 자동 묶음은 기본 회사만
// 기본 회사(다짐)는 예전 그대로 — 넓은 대조는 sales-judge-baseline.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql, cafe, con;
const today = seoulToday(); const now = new Date().toISOString();
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)}, 'workin')`;
const notice = (id, title, extra = {}) => ({ id, title, source_type: 'g2b_bid', source_external_id: `TJ-${id}`, source_url: `https://example.test/${id}`, issuer: '시험시청', region: '경기', first_seen_at: now, created_at: now, updated_at: now,
  posted_date: today, deadline_at: `${addDays(today, 7)}T10:00:00+09:00`, current_status: '공고중', notice_kind: 'new', related: false, fit_business: null, matched_keywords: [], classification: '참고(비관련)', ...extra });
async function join(email, company, industry) {
  await sql`delete from signup_attempts`;
  const c = new Client(email);
  const r = await c.ok('POST', '/api/auth/signup', { email, password: 'signup-pass-1234', name: '새대표', mode: 'team', company, industry, agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  await c.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  return { c, tenant: me.user.tenant, id: me.user.id };
}
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return r.json(); };
const bids = async (c, tab = 'all') => (await c.ok('GET', `/api/sales/src?view=bids&tab=${tab}`));
const LEAK = /"다짐"|"하이링크"|즉시 검토|중장기 영업리드|면허 업체 협력|영업 포인트 메모|부족 자격 메모/;

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SALES_RESEARCH_WEEKLY: 'any', SALES_RESEARCH_MAX: '3' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: now, daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // 공용 공고: 기본 회사 판정이 저장된 줄(관련·적합 사업·분류·영업 메모) + 관련 아닌 줄 + 협력사 모집
  await put('procurement_notices', notice('N1', '시험아파트 헬스장 위탁운영 업체 선정 입찰공고', { related: true, fit_business: '다짐', matched_keywords: ['헬스장', '위탁운영'], classification: '즉시 검토', facility_name: '시험아파트', sales_point: '영업 포인트 메모', qualification_gap: '부족 자격 메모' }));
  await put('procurement_notices', notice('N2', '시험시 학교 급식 식자재 납품 업체 선정'));
  await put('procurement_notices', notice('N3', '[시험건설] 협력업체 모집 공고', { source_type: 'vendor_recruit', related: true, classification: '중장기 영업리드', posted_checked: true }));
  await put('procurement_notices', notice('N4', '시험구청 청사 카페 운영자 모집 공고'));
  await put('procurement_notices', notice('N5', '시험단지 출입통제 시스템 교체 공사', { related: true, fit_business: '하이링크', matched_keywords: ['출입통제'], classification: '중장기 영업리드' }));
  await put('procurement_notices', notice('N6', '시험시 식자재 보관 창고 임대'));
  await put('operating_facility_prospects', { id: 'F1', name: '시험아파트', households: 1500, facility_type: '아파트', region: '경기', first_seen_at: today });
  cafe = await join('ceo@cafe-tj.test', '모퉁이카페', '외식·카페');        // 영업 용어 묶음 '일반'
  con = await join('ceo@con-tj.test', '튼튼건설', '건설·시설관리');          // 영업 용어 묶음 '건설·시공'
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('414차 영업 일반화 — 다른 회사 경로', () => {
  test('A·D 기본값: 일반 묶음 회사는 입찰·시설 탭이 꺼져 있고 직접 켜면 보임 · 건설 묶음 회사는 기본 켜짐', async () => {
    const o = await cafe.c.ok('GET', '/api/sales/options');
    assert.deepEqual([o.template.code, o.bids, o.bidsAuto], ['general', false, true]);
    assert.equal((await cafe.c.req('GET', '/api/sales/src?view=bids&tab=all')).status, 404, '입찰을 안 쓰는 회사');
    const hub = await cafe.c.ok('GET', '/api/sales/src?view=hub&tab=facilities');
    assert.ok(!hub.tabs.includes('bids') && !hub.tabs.includes('facilities') && !hub.tabs.includes('contracts'), hub.tabs.join(','));
    assert.ok(hub.tabs.includes('prospects') && hub.tabs.includes('regions'));
    // 데이터 설정: 시설 수집기는 꺼진 것으로, 입찰 수집기는 켜진 것으로(입찰 기능 자체가 꺼져 있음) 보인다
    const cv = await cafe.c.ok('GET', '/api/sales/collectors');
    const fac = cv.collectors.filter((x) => ['kapt_new_complexes', 'public_sports_facilities', 'operating_from_kapt'].includes(x.slug));
    assert.ok(fac.length >= 2 && fac.every((x) => x.enabled === false), JSON.stringify(fac.map((x) => [x.slug, x.enabled])));
    // 시설 수집기 하나를 켜면 시설 탭이 생긴다 · 입찰을 켜면 입찰 탭이 생긴다
    await cafe.c.ok('PUT', '/api/sales/collectors', { slug: fac[0].slug, enabled: true });
    await cafe.c.ok('PUT', '/api/sales/options', { bids: true });
    const hub2 = await cafe.c.ok('GET', '/api/sales/src?view=hub&tab=facilities');
    assert.ok(hub2.tabs.includes('facilities') && hub2.tabs.includes('bids'), hub2.tabs.join(','));
    assert.ok(hub2.items.some((x) => x.id === 'F1'));
    assert.ok(!hub2.items.find((x) => x.id === 'F1').notices, "시설 줄의 '관련 공고 n건'(기본 회사 판정)은 다른 회사에 없음");
    // 건설 묶음 회사: 고르지 않아도 입찰·시설이 켜져 있음
    const oc = await con.c.ok('GET', '/api/sales/options');
    assert.deepEqual([oc.template.code, oc.bids, oc.bidsAuto], ['construction', true, true]);
    const hubC = await con.c.ok('GET', '/api/sales/src?view=hub&tab=facilities');
    assert.ok(hubC.tabs.includes('bids') && hubC.tabs.includes('facilities'), hubC.tabs.join(','));
    // 기본 회사: 예전 그대로(전부 켜짐) · 시설 줄의 관련 공고 수도 그대로
    const od = await ctx.owner.ok('GET', '/api/sales/options');
    assert.deepEqual([od.bids, od.bidsAuto], [true, true]);
    const hubD = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities');
    assert.deepEqual(hubD.tabs, ['bids', 'buildings', 'facilities', 'vendors', 'contracts', 'prospects', 'regions']);
    assert.equal(hubD.items.find((x) => x.id === 'F1').notices, 1, '기본 회사는 관련 공고 수 그대로');
  });

  test('C 입찰 목록: 검색어가 없으면 빈 목록 + 안내, 검색어·관심 사업 낱말을 넣으면 그 낱말 공고만(기본 회사 판정 공고는 안 나옴) · E 판정 표시 없음 · F 협력사 모집 없음', async () => {
    const b0 = await bids(cafe.c);
    assert.deepEqual([b0.items.length, b0.needKeywords], [0, true]);
    await cafe.c.ok('PUT', '/api/sales/digest/prefs', { keywords: ['식 자재'] }); // 띄어 써도 맞음(빈칸 무시)
    const b1 = await bids(cafe.c);
    assert.deepEqual(b1.items.map((x) => x.title).sort(), ['시험시 식자재 보관 창고 임대', '시험시 학교 급식 식자재 납품 업체 선정']);
    assert.ok(!b1.needKeywords);
    const n2 = b1.items.find((x) => /납품/.test(x.title));
    assert.deepEqual([n2.related, n2.category, n2.fitBusiness, n2.partner, n2.keywords], [true, null, null, null, '식 자재']);
    // 관심 사업 낱말도 검색어 — 사업 배지가 붙는다
    await cafe.c.ok('PUT', '/api/sales/business-categories', { items: [{ name: '카페 운영', keywords: ['카페'], color: '#2563EB' }] });
    const b2 = await bids(cafe.c);
    const n4 = b2.items.find((x) => /카페/.test(x.title));
    assert.ok(n4, '관심 사업 낱말로 잡힘'); assert.deepEqual(n4.businesses.map((x) => x.name), ['카페 운영']);
    assert.equal(b2.items.length, 3);
    // 제외어
    await cafe.c.ok('PUT', '/api/sales/digest/prefs', { excludes: ['창고'] });
    const b3 = await bids(cafe.c);
    assert.deepEqual(b3.items.map((x) => x.title).sort(), ['시험구청 청사 카페 운영자 모집 공고', '시험시 학교 급식 식자재 납품 업체 선정']);
    // 기본 회사 판정 공고(N1·N5)·협력사 모집(N3)·판정 글자·영업 메모가 어디에도 없다
    for (const tab of ['all', 'open', 'today']) { const r = await bids(cafe.c, tab); assert.ok(!LEAK.test(JSON.stringify(r)), `${tab}: ${JSON.stringify(r).match(LEAK)?.[0]}`); assert.ok(!r.items.some((x) => /헬스장|출입통제|협력업체/.test(x.title)), tab); }
    const home = await cafe.c.ok('GET', '/api/sales/src?view=summary');
    assert.equal(home.kpi.relatedNotices, 2); assert.ok(!LEAK.test(JSON.stringify(home)), JSON.stringify(home).match(LEAK)?.[0]);
    // 진행 기록을 남긴 공고는 검색어 밖이어도 목록에 남는다 — 그래도 기본 회사 판정은 안 붙는다
    await cafe.c.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '검토중', memo: '직접 찾은 공고' });
    const w = (await bids(cafe.c, 'working')).items.find((x) => x.id === 'N1');
    assert.ok(w, '진행 기록 있는 공고'); assert.deepEqual([w.related, w.category, w.fitBusiness, w.keywords, w.salesPoint ?? null], [false, null, null, null, null]);
  });

  test('C·D·F 아침 메일: 다른 회사는 검색어에 맞은 공고만(검토 구역)·협력사 모집 없음·구역 설명이 검색어 기준 · 검색어 없는 회사는 정시 발송 안 함', async () => {
    const d = await cafe.c.ok('GET', '/api/sales/digest');
    assert.equal(d.plain, true);
    assert.deepEqual(d.items.map((x) => [x.title, x.section, x.fit, x.why]).sort(), [['시험구청 청사 카페 운영자 모집 공고', 'review', null, '검색어 카페'], ['시험시 학교 급식 식자재 납품 업체 선정', 'review', null, '검색어 식 자재']]);
    assert.deepEqual(d.items.find((x) => /카페/.test(x.title)).biz.map((b) => b.name), ['카페 운영']);
    assert.deepEqual([d.counts.total, d.counts.now, d.counts.review, d.counts.ref], [2, 0, 2, 0]);
    assert.ok(!LEAK.test(JSON.stringify(d)), JSON.stringify(d).match(LEAK)?.[0]);
    const html = await (await cafe.c.req('GET', '/api/sales/digest?preview=html')).body;
    assert.ok(/관심 검색어에 맞는 공고/.test(html) && !/관련 사업이지만|다짐|하이링크|협력사 모집/.test(html), '메일 본문');
    // 정시 발송(tick): 검색어를 넣고 입찰을 켠 회사(카페)는 보냄 · 검색어 없는 회사(건설)는 안 보냄 · 기본 회사는 보냄
    await sql`insert into sales_bid_prefs (tenant, digest_hour) values ('default', 0) on conflict (tenant) do update set digest_hour = 0`;
    await sql`update sales_bid_prefs set digest_hour = 0 where tenant = ${cafe.tenant}`;
    await sql`insert into sales_bid_prefs (tenant, digest_hour) values (${con.tenant}, 0) on conflict (tenant) do update set digest_hour = 0`;
    await tick();
    const sent = (await sql`select tenant from sales_digests where day = ${today}`).map((r) => r.tenant);
    assert.ok(sent.includes('default') && sent.includes(cafe.tenant), sent.join(','));
    assert.ok(!sent.includes(con.tenant), '검색어가 없는 회사는 정시 메일 없음');
    // 기본 회사 메일: 예전처럼 적합 판정·협력사 모집이 들어 있음
    const [dd] = await sql`select items from sales_digests where tenant = 'default' and day = ${today}`;
    const byTitle = Object.fromEntries(dd.items.map((x) => [x.title, [x.section, x.fit]]));
    assert.deepEqual(byTitle['시험아파트 헬스장 위탁운영 업체 선정 입찰공고'], ['now', '다짐']);
    assert.deepEqual(byTitle['시험단지 출입통제 시스템 교체 공사'], ['review', '하이링크']);
    assert.ok(byTitle['[시험건설] 협력업체 모집 공고'], '기본 회사 메일에는 협력사 모집');
    assert.ok(!byTitle['시험시 학교 급식 식자재 납품 업체 선정'], '기본 회사 메일에 다른 회사 검색어 공고는 없음');
  });

  test('기본 회사 입찰 목록은 그대로: 저장된 판정대로(관련 공고·분류·적합 사업·협력 표시·협력사 모집)', async () => {
    const b = await bids(ctx.owner);
    const t = Object.fromEntries(b.items.map((x) => [x.id, x]));
    assert.deepEqual(Object.keys(t).sort(), ['N1', 'N3', 'N5']);
    assert.deepEqual([t.N1.related, t.N1.category, t.N1.fitBusiness, t.N1.keywords, t.N1.salesPoint], [true, '즉시 검토', '다짐', '헬스장, 위탁운영', '영업 포인트 메모']);
    assert.deepEqual([t.N5.fitBusiness, t.N5.partner], ['하이링크', '면허 업체 협력 필요']);
    assert.equal(t.N3.vendorRecruit, true); assert.ok(!b.needKeywords);
  });

  test('B 주간 후속조사 자동 묶음은 기본 회사만 — 다른 회사는 관리자가 [지금 만들기]를 눌러야 생김', async () => {
    const d = await tick();
    const out = d.salesResearch?.out ?? {};
    assert.ok(!(cafe.tenant in out) && !(con.tenant in out), JSON.stringify(Object.keys(out)));
    const rows = await sql`select tenant from sales_research_weekly`;
    assert.ok(rows.every((r) => r.tenant === 'default'), rows.map((r) => r.tenant).join(','));
    const ov = await con.c.ok('GET', '/api/sales/research');
    assert.equal(ov.auto, false, '다른 회사는 자동 묶음 꺼짐으로 보임');
    assert.equal(ov.canRun, true);
  });
});
