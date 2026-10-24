// 137차(로컬 10/24 23:55 135차 ③ 화원): 나라장터 사전규격 → 본 공고 = 같은 사업 — 같은 발주·수요기관 + 표시를 뺀 같은 제목 + 사전규격이 본 공고보다 앞(120일 안).
// 둘 중 하나를 '대상 아님'으로 넘기면 다른 쪽도 모든 목록·숫자·당일 메일에서 빠짐(다른 쪽에 미검토 말고 진행 기록이 있으면 그대로) · [대상 아님] 탭은 한 장 · 되돌리기도 함께
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const d = (n) => addDays(today, n);
const at = (day, hm = '09:00') => `${day}T${hm}:00+09:00`;
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${row.id}, ${sql.json({ related: true, fit_business: '다짐', notice_kind: 'new', current_status: '진행중', ...row })})`;
const bid = (id, ext, o) => put({ id, source_type: 'g2b_bid', source_external_id: ext, ...o });
const pre = (id, o) => put({ id, source_type: 'g2b_prespec', source_external_id: `R26BD${id}`, notice_type: '사전규격', classification: '예정', ...o });
const bids = (tab) => ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=${tab}`);
const ids = (list) => list.items.map((n) => n.id);
const work = (id, body) => ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id, ...body });
const HW = '화원 복합커뮤니티센터 위탁운영 용역';

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // 화원: 사전규격(발주기관 = 군) → 20일 뒤 본 공고(공고기관 = 조달청, 수요기관 = 군) · 본 공고 제목엔 [긴급]
  await pre('P1', { title: HW, issuer: '시험군', demand_agency: '시험군', posted_date: d(-20), first_seen_at: at(d(-20)), deadline_at: at(d(-14), '18:00') });
  await bid('B1', 'R26BK0100-000', { title: `[긴급] ${HW}`, issuer: '조달청 시험지방조달청', demand_agency: '시험군', posted_date: d(-3), first_seen_at: at(d(-3)), deadline_at: at(d(6), '10:00') });
  // 잇지 않는 것: 다른 기관 · 120일보다 앞 · 사전규격이 본 공고보다 뒤
  await pre('Q1', { title: HW, issuer: '다른군', demand_agency: '다른군', posted_date: d(-20), first_seen_at: at(d(-20)) });
  await pre('Q2', { title: '시험시 체육관 헬스장 위탁운영', issuer: '시험시', posted_date: d(-200), first_seen_at: at(d(-200)) });
  await bid('B2', 'R26BK0200-000', { title: '시험시 체육관 헬스장 위탁운영', issuer: '시험시', posted_date: d(-2), first_seen_at: at(d(-2)), deadline_at: at(d(7), '10:00') });
  await pre('Q3', { title: '시험읍 수영장 헬스장 위탁운영 용역', issuer: '시험읍', posted_date: d(-1), first_seen_at: at(d(-1)) });
  await bid('B3', 'R26BK0300-000', { title: '시험읍 수영장 헬스장 위탁운영 용역', issuer: '시험읍', posted_date: d(-5), first_seen_at: at(d(-5)), deadline_at: at(d(8), '10:00') });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('따로 보임(아무도 넘기지 않음) · 잇지 않는 사전규격(다른 기관·120일 전·본 공고 뒤)은 넘겨도 본 공고 그대로', async () => {
  const all = await bids('all');
  for (const id of ['P1', 'B1', 'Q1', 'Q2', 'B2', 'Q3', 'B3']) assert.ok(ids(all).includes(id), `${id} ${JSON.stringify(ids(all))}`);
  assert.ok(!ids(await bids('open')).includes('P1'), '진행 중 탭은 사전규격 빼고(그대로)');
  for (const id of ['Q1', 'Q2', 'Q3']) await work(id, { status: '대상아님' });
  const after = ids(await bids('all'));
  for (const id of ['P1', 'B1', 'B2', 'B3']) assert.ok(after.includes(id), `${id} 그대로 ${JSON.stringify(after)}`);
  const sk = await bids('skip');
  assert.deepEqual(sk.items.map((n) => [n.id, n.linked.length]).sort(), [['Q1', 0], ['Q2', 0], ['Q3', 0]]);
});

test('본 공고를 대상 아님 → 같은 사업 사전규격도 모든 목록·숫자에서 빠짐 · [대상 아님] 탭 한 장(함께 숨긴 사전규격) · 되돌리면 둘 다', async () => {
  const s0 = await ctx.owner.ok('GET', '/api/sales/src?view=summary'); const k0 = (await bids('all')).skipCount;
  await work('B1', { status: '대상아님', reason: '우리 사업 아님' });
  for (const tab of ['all', 'open', 'today', 'prep', 'working']) { const l = ids(await bids(tab)); assert.ok(!l.includes('B1') && !l.includes('P1'), `${tab} ${JSON.stringify(l)}`); }
  const s1 = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.equal(s1.kpi.relatedNotices, s0.kpi.relatedNotices - 2, '영업 홈 관련 공고 수에서 둘 다 빠짐');
  const sk = await bids('skip');
  assert.equal(sk.skipCount, k0 + 1, '[대상 아님] 탭은 한 장');
  const c = sk.items.find((n) => n.id === 'B1');
  assert.deepEqual([c.skip.reason, c.linked.map((l) => [l.id, l.own, l.sourceLabel])], ['우리 사업 아님', [['P1', false, '나라장터 사전규격']]]);
  assert.ok(!sk.items.some((n) => n.id === 'P1'), '사전규격은 따로 카드로 안 냄');
  const back = await work('B1', { restore: true });
  assert.deepEqual([back.status, back.together], ['미검토', undefined], '사전규격은 자기 기록이 없어 따로 되돌릴 것 없음');
  const all = ids(await bids('all'));
  assert.ok(all.includes('B1') && all.includes('P1'), '둘 다 다시 목록에');
});

test('사전규격을 대상 아님 → 본 공고도 빠짐(본 공고 기록이 미검토뿐이면) · 둘 다 넘겼으면 본 공고 한 장 · 되돌리기 = 함께(감사 기록 둘)', async () => {
  await work('P1', { status: '대상아님', reason: '사전규격 단계에서 제외' });
  const all = ids(await bids('all'));
  assert.ok(!all.includes('P1') && !all.includes('B1'), JSON.stringify(all));
  let sk = await bids('skip'); const k1 = sk.skipCount;
  assert.deepEqual(sk.items.find((n) => n.id === 'P1').linked.map((l) => [l.id, l.own]), [['B1', false]], '사전규격 카드 아래 본 공고');
  await work('B1', { status: '대상아님' });
  sk = await bids('skip');
  assert.equal(sk.skipCount, k1, '둘 다 넘겨도 한 장');
  assert.ok(!sk.items.some((n) => n.id === 'P1'));
  assert.deepEqual(sk.items.find((n) => n.id === 'B1').linked.map((l) => [l.id, l.own]), [['P1', true]], '본 공고 카드 아래 사전규격(따로 넘긴 것)');
  const back = await work('B1', { restore: true });
  assert.deepEqual(back.together, ['P1'], '이어진 사전규격도 함께 되돌림');
  const after = ids(await bids('all'));
  assert.ok(after.includes('P1') && after.includes('B1'), JSON.stringify(after));
  const [p] = await sql`select status from sales_work_records where tenant = 'default' and ref_id = 'P1'`;
  assert.equal(p.status, '미검토');
  const logs = (await sql`select target_id from audit_logs where action = 'sales_work.unskip' and target_id in ('B1', 'P1') order by id`).map((l) => l.target_id);
  assert.deepEqual(logs.slice(-2).sort(), ['B1', 'P1']);
});

test('이어진 쪽에 진행 기록(검토중)이 있으면 그대로 보임', async () => {
  await work('P1', { status: '검토중', memo: '사전규격 의견 검토' });
  await work('B1', { status: '대상아님' });
  const all = (await bids('all')).items;
  assert.deepEqual([all.some((n) => n.id === 'B1'), all.find((n) => n.id === 'P1')?.work], [false, '검토중']);
  assert.deepEqual((await bids('skip')).items.find((n) => n.id === 'B1').linked, []);
  await work('B1', { restore: true });
});

test('당일 메일: 대상 아님 사전규격과 같은 사업인 오늘 새 본 공고는 빠짐 · 본 공고에 진행 기록이 있으면 그대로', async () => {
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${d(-1)}, '[]', '{}', 1, 1, ${new Date(at(d(-1), '08:00'))})`;
  await pre('P4', { title: '시험면 커뮤니티센터 헬스장 위탁운영', issuer: '시험면', posted_date: d(-10), first_seen_at: at(d(-10)) });
  await bid('B4', 'R26BK0400-000', { title: '시험면 커뮤니티센터 헬스장 위탁운영', issuer: '시험면', posted_date: today, first_seen_at: ago(2), updated_at: ago(2), deadline_at: at(d(9), '10:00') });
  await pre('P5', { title: '시험리 다목적체육관 헬스장 위탁운영', issuer: '시험리', posted_date: d(-10), first_seen_at: at(d(-10)) });
  await bid('B5', 'R26BK0500-000', { title: '시험리 다목적체육관 헬스장 위탁운영', issuer: '시험리', posted_date: today, first_seen_at: ago(2), updated_at: ago(2), deadline_at: at(d(9), '10:00') });
  const g0 = await ctx.owner.ok('GET', '/api/sales/digest');
  assert.ok(['B4', 'B5'].every((id) => g0.items.some((i) => i.id === id)), JSON.stringify(g0.items.map((i) => i.id)));
  await work('P4', { status: '대상아님' });
  await work('B5', { status: '검토중', memo: '본 공고 검토' });
  await work('P5', { status: '대상아님' });
  const g = await ctx.owner.ok('GET', '/api/sales/digest');
  assert.ok(!g.items.some((i) => i.id === 'B4'), '대상 아님 사전규격과 같은 사업');
  assert.ok(g.items.some((i) => i.id === 'B5'), '진행 기록이 있는 본 공고는 그대로');
  assert.ok((g.counts.skipped['대상 아님'] ?? 0) >= 1);
});
