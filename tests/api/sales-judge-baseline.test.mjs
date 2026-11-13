// 영업 일반화(G-37~G-42) 안전장치 — 다짐 공고 판정 대조 시험.
// 대표 조건 "다짐 세팅은 절대 건들이지 않습니다": 영업 판정을 회사별로 나누는 작업 앞뒤로 다짐(기본 회사)의 결과가 한 글자도 달라지면 안 된다.
// 고정 표본(tests/fixtures/sales-judge-cases.json, 1,611건)에 대해
//   ① 규칙 판정: 적합 사업·맞은 낱말·즉시 검토 여부·빠진 까닭·공공 시설 관리위탁 판정
//   ② 수집 때 저장되는 값: 관련 여부·적합 사업·분류·공고 종류·'면허 업체 협력 필요'
//   ③ 다짐 화면: 입찰 목록(전체·오늘)에 나오는 공고와 표시 칸, 아침 메일에 들어가는 공고와 까닭·구역·사업 표시
// 를 기준값(tests/fixtures/sales-judge-baseline.json — 일반화 전 코드로 만든 것)과 견준다.
// 기준값을 다시 만드는 것은 다짐 판정 규칙을 대표 지시로 일부러 바꿀 때만: JUDGE_BASELINE_WRITE=1 node --test tests/api/sales-judge-baseline.test.mjs
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const CASES = JSON.parse(readFileSync(new URL('../fixtures/sales-judge-cases.json', import.meta.url), 'utf8')).cases;
const BASE_URL = new URL('../fixtures/sales-judge-baseline.json', import.meta.url);
const WRITE = process.env.JUDGE_BASELINE_WRITE === '1';
const BASE = existsSync(BASE_URL) ? JSON.parse(readFileSync(BASE_URL, 'utf8')) : null;
const out = { note: '다짐 공고 판정 기준값 — 영업 일반화 전 코드로 만든 것. 손으로 고치지 않는다.', pure: null, stored: null, api: null };
/** 화면 시험에 쓰는 표본 수(아침 메일이 300건에서 잘리므로 그 안쪽) */
const API_N = 420;
const NOW = new Date('2026-11-14T03:00:00Z'); // 판정 함수에 넘기는 고정 시각(상태 계산용)
const payload = (c, i) => ({ source_type: c.st ?? 'g2b_bid', source_external_id: `JB${String(i).padStart(5, '0')}`, source_url: `https://example.test/notice/${i}`, title: c.t, bid_category: c.c ?? null, task_scope: c.s ?? null,
  issuer: c.iss ?? '시험발주처', license_limit: c.lic ?? null, industry_code: c.ind ?? null, region: '경기' });
/** 차이를 사람이 읽게: 처음 12건만 */
function same(label, got, want) {
  if (WRITE) return;
  assert.ok(want, `${label}: 기준값이 없습니다 — JUDGE_BASELINE_WRITE=1 로 먼저 만드세요`);
  const g = Array.isArray(got) ? got : Object.entries(got), w = Array.isArray(want) ? want : Object.entries(want);
  const diff = [];
  for (let i = 0; i < Math.max(g.length, w.length); i++) if (JSON.stringify(g[i]) !== JSON.stringify(w[i])) diff.push(`#${i} ${JSON.stringify(CASES[i]?.t ?? '')}\n      지금: ${JSON.stringify(g[i])}\n      기준: ${JSON.stringify(w[i])}`);
  assert.equal(diff.length, 0, `${label}: 기준값과 다른 것 ${diff.length}건\n    ${diff.slice(0, 12).join('\n    ')}`);
}

let P; // 판정 함수 묶음(순수 함수 파일)
before(async () => { P = await import('../../src/lib/sales/collectors/procurement.ts'); });
after(() => { if (WRITE) { writeFileSync(BASE_URL, JSON.stringify(out)); console.log(`기준값 저장: ${BASE_URL.pathname}`); } });

describe('다짐 공고 판정 대조(영업 일반화 앞뒤 차이 0)', () => {
  test(`① 규칙 판정 ${CASES.length}건: 적합 사업·맞은 낱말·즉시 검토·빠진 까닭·공공 시설 관리위탁`, () => {
    out.pure = CASES.map((c) => {
      const f = P.matchFit(c.t, c.c ?? null, c.s ?? null); const pub = P.publicFacilityFit(c.t, c.c ?? null);
      return [f.fit, f.matched, f.direct, f.pub ?? null, f.dropped ?? null, [pub.hit, pub.ops, pub.facility, pub.why]];
    });
    assert.ok(out.pure.some((x) => x[0] === '다짐') && out.pure.some((x) => x[0] === '하이링크') && out.pure.some((x) => x[0] === '다짐·하이링크') && out.pure.some((x) => x[0] === null), '표본에 네 가지 판정이 모두 있음');
    same('규칙 판정', out.pure, BASE?.pure);
  });

  test('② 수집 때 저장되는 값: 관련 여부·적합 사업·낱말·분류·공고 종류·협력 표시', () => {
    const plan = P.planNoticeBatch(CASES.map(payload), new Map(), NOW);
    assert.equal(plan.invalid, 0); assert.equal(plan.inserts.length, CASES.length);
    out.stored = plan.inserts.map(({ row: r }) => [r.related, r.fit_business, r.matched_keywords, r.classification, r.notice_type, r.notice_kind, P.partnerNeed(r)]);
    assert.ok(out.stored.some((x) => x[6] === '면허 업체 협력 필요'), '표본에 협력 표시가 있음');
    assert.ok(out.stored.some((x) => /즉시/.test(String(x[3]))) && out.stored.some((x) => /참고/.test(String(x[3]))), '표본에 즉시 검토·참고가 있음');
    same('저장 값', out.stored, BASE?.stored);
  });

  test(`③ 다짐 화면: 입찰 목록(전체·오늘)·아침 메일 — 표본 앞 ${API_N}건을 수집한 것처럼 넣고 견줌`, async () => {
    await resetDb(); const srv = await startServer(); const sql = testDb();
    try {
      const ctx = await bootstrap();
      await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
      const t0 = Date.now(); const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
      const dl = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 9 * 864e5))}T10:00:00+09:00`;
      // 수집기 저장(store.upsertNotices)과 같은 모양: 판정 함수가 만든 줄 + id·처음 본 때
      const plan = P.planNoticeBatch(CASES.slice(0, API_N).map((c, i) => ({ ...payload(c, i), deadline_at: dl, posted_date: d })), new Map(), new Date());
      // 처음 본 때를 1/1000초씩 다르게, id 도 순서대로 — 같은 사업으로 묶이는 공고(제목이 거의 같은 것) 중 어느 줄이 대표가 되는지가 실행마다 같도록
      const rows = plan.inserts.map(({ row }, i) => { const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`; const t = new Date(t0 - (API_N - i)).toISOString();
        return { scope: 'global', tbl: 'procurement_notices', src_id: id, row: sql.json({ id, lead_id: null, ...row, first_seen_at: t, last_seen_at: t, last_seen_date: d, created_at: t, updated_at: t }), gone: false, synced_at: new Date(t0 - (API_N - i)), origin: 'workin' }; });
      for (let n = 0; n < rows.length; n += 200) await sql`insert into sales_src_rows ${sql(rows.slice(n, n + 200))}`;
      const no = (x) => String(x.noticeNo ?? '');
      const pickBid = (x) => [x.title, x.related, x.category ?? null, x.fitBusiness ?? null, x.partner ?? null, x.keywords ?? null, x.business ?? null, (x.businesses ?? []).map((b) => b.name), x.vendorRecruit];
      const list = async (tab) => (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=${tab}`)).items.filter((x) => /^JB\d{5}$/.test(no(x))).sort((a, b) => no(a).localeCompare(no(b)));
      const all = await list('all'), today = await list('today'), open = await list('open');
      const dg = await ctx.owner.ok('GET', '/api/sales/digest');
      const items = [...dg.items].sort((a, b) => String(a.noticeNo ?? a.title).localeCompare(String(b.noticeNo ?? b.title)) || String(a.title).localeCompare(String(b.title)));
      out.api = {
        all: Object.fromEntries(all.map((x) => [no(x), pickBid(x)])),
        today: today.map(no), open: open.map(no),
        digest: items.map((x) => [x.noticeNo ?? null, x.title, x.kind, x.fit ?? null, x.why ?? null, x.section ?? null, x.keywords ?? [], (x.biz ?? []).map((b) => b.name), x.badges ?? [], x.tags ?? []]),
        counts: Object.fromEntries(['total', 'new', 'now', 'review', 'soon', 'result', 'ref', 'amend', 'cancel'].map((k) => [k, dg.counts?.[k] ?? null])),
      };
      assert.ok(all.length > 50 && all.length < API_N, `입찰 목록 ${all.length}건(관련만)`);
      assert.ok(dg.items.length > 20 && dg.items.length < 300, `아침 메일 ${dg.items.length}건(300건 자르기 안쪽)`);
      if (!WRITE) {
        assert.ok(BASE?.api, '기준값이 없습니다 — JUDGE_BASELINE_WRITE=1 로 먼저 만드세요');
        for (const k of ['all', 'today', 'open', 'digest', 'counts']) assert.deepEqual(out.api[k], BASE.api[k], `다짐 화면 '${k}' 가 기준값과 다름`);
      }
    } finally { srv?.proc.kill(); await sql.end(); }
  });
});
