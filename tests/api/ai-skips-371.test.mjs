// 371차 #994(대표 11/06 "AI 한도 혹은 클로드 크레딧을 모두 소진하여 … 정상으로 돌아왔을 때 비정상적이었던 날을 추적해서 다시"):
// 크레딧 소진(503 ai_credit) 동안 지원사업 자동 판단이 공고마다 실패(auto_fail)로 셈해 3번이면 차례에서 빠지던 것 →
// 멈춤으로 보고 '못 함(사유·날짜)' 기록 · 정상으로 돌아오면 다음 정기 실행이 그 공고부터 판단 → '다시 채움' · 운영 상태에 빠졌던 날 (가짜 Anthropic 서버)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb, tick, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fg;
const today = seoulToday(); const d = (n) => addDays(today, n);
const EFFECT = { receive: '마케팅 비용 지원', amount: null, selfPay: '공고문 확인', prepHours: 4, perBusiness: [], confirm: [] };
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify({ reasons: ['경기 소재 중소기업 — 해당'], brands: [], docs: [], summary: '요약', amount: null, use: [], schedule: null, effect: EFFECT, ...o }) }], stop_reason: 'end_turn' });
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: ['경기'], nationwide: false, hashtags: [], attachments: sql.json([]), apply_end: d(20), target: '중소기업', agency: '경기도', ...o })} returning id`.then((r) => r[0].id);
const PROFILE = { regionSido: '경기', regionSigungu: '용인시', founded: d(-1735), size: '소기업', employees: 8, industries: ['소프트웨어'], keywords: [], certs: [], brands: ['워크인'], interests: ['마케팅'], excludes: [], memo: '시험 회사' };
const auto = async () => (await tick()).detail?.supportAuto;
const fail = async (id) => (await sql`select coalesce((select auto_fail from support_matches where program_id = ${id}), 0) as n`)[0].n;

before(async () => {
  await resetDb(); fg = await startFakeGoogle(); srv = await startServer({ SUPPORT_WEEKLY: 'off' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { await sql`delete from app_settings where key = 'ai_credit_block'`.catch(() => {}); srv?.proc.kill(); fg?.server.close(); await sql?.end(); });

test('크레딧 막힘: 실패로 안 셈·못 함 기록(사유 ai_credit) → 풀리면 다음 정기 실행이 판단 → 다시 채움 · 운영 상태 빠졌던 날', async () => {
  const a = await ins({ source_id: 'S371A', title: '[경기] 용인시 중소기업 마케팅 지원 371' });
  const b = await ins({ source_id: 'S371B', title: '[경기] 경기도 소상공인 온라인 판로 지원 371' });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', PROFILE);
  // 크레딧 소진 차단(onAiError 가 1시간 거는 것과 같은 표시)
  await sql`insert into app_settings (key, value) values ('ai_credit_block', ${sql.json({ until: new Date(Date.now() + 3600e3).toISOString() })}) on conflict (key) do update set value = excluded.value`;
  await queue([]);
  for (let k = 0; k < 3; k++) {
    const r = await auto(); const t = Object.values(r.out)[0];
    assert.equal(t.stopped, 'ai_credit', `${k + 1}번째 정기 실행 멈춤 ${JSON.stringify(r)}`);
  }
  assert.deepEqual([await fail(a), await fail(b)], [0, 0], '크레딧 막힘은 공고 실패로 안 셈(예전: 3번이면 차례에서 빠짐)');
  const sk = await sql`select item_key, reason, skips, done_at from ai_skips where stage = 'support' order by item_key`;
  assert.deepEqual(sk.map((x) => [x.reason, x.done_at]), [['ai_credit', null], ['ai_credit', null]], JSON.stringify(sk));
  assert.ok(sk.every((x) => x.skips >= 3), '막힐 때마다 횟수');
  const ops = await ctx.owner.ok('GET', '/api/admin/ops');
  const g = ops.aiSkips.find((x) => x.stage === 'support');
  assert.deepEqual([g.label, g.total, g.done, g.left], ['지원사업 AI 판단', 2, 0, 2]);
  // 정상으로 돌아옴 → 다음 정기 실행이 남은 것부터 판단 → 다시 채움
  await sql`delete from app_settings where key = 'ai_credit_block'`;
  await queue([say({ verdict: 'fit' }), say({ verdict: 'maybe' })]);
  const r = await auto(); const t = Object.values(r.out)[0];
  assert.equal(t.done, 2, JSON.stringify(r));
  assert.equal((await sql`select count(*)::int n from ai_skips where stage = 'support' and done_at is not null`)[0].n, 2, '다시 채움 완료');
  const ops2 = await ctx.owner.ok('GET', '/api/admin/ops');
  const g2 = ops2.aiSkips.find((x) => x.stage === 'support');
  assert.deepEqual([g2.total, g2.done, g2.left], [2, 2, 0]);
});


test('아침 메일 배지 늦게 찾음: 공고일보다 이틀 넘게 늦게 처음 받은 공고만(다시 채운 공고 등)', async () => {
  const put = (id, no, posted) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'g2b_bid', source_external_id: no,
    title: `용인시 국민체육센터 위탁운영 ${no}`, issuer: '용인시청', region: '경기', related: true, fit_business: '다짐', current_status: '공고중', notice_kind: 'new',
    posted_date: posted, deadline_at: `${d(10)}T10:00:00+09:00`, first_seen_at: new Date().toISOString() })})`;
  await put('00000000-0000-4000-8000-000000371001', 'R26BK371001-000', d(-5));
  await put('00000000-0000-4000-8000-000000371002', 'R26BK371002-000', today);
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: [], excludes: [], regions: [], issuers: [], itemCodes: [], amountMin: null, amountMax: null });
  await sql`delete from sales_digests where tenant = 'default' and day = ${today}`;
  const items = (await ctx.owner.ok('GET', '/api/sales/digest')).items;
  const late = items.find((i) => i.noticeNo === 'R26BK371001-000'), fresh = items.find((i) => i.noticeNo === 'R26BK371002-000');
  assert.ok(late && fresh, JSON.stringify(items.map((i) => [i.noticeNo, i.section, i.badges])));
  assert.ok(late.badges.includes('늦게 찾음'), JSON.stringify(late.badges));
  assert.ok(!fresh.badges.includes('늦게 찾음'), JSON.stringify(fresh.badges));
});
