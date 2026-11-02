// 328차(대표 11/02 12:4x 결정 ⓒ '입찰 관련 건은 입찰로, 영업 관련 건은 영업으로 — 공고로 올라온 것은 입찰'): 정기 실행이 한 번, 공고에서 시작한 열린 [영업] 업무 제목을 [입찰]로.
// 대상 = sales_ref.kind = 'bid'(예전 넘기기) · 공고에서 넘어온 리드(src.from = 'bid')의 자동 업무 / 그대로 = 영업 DB 시작(시설·리드) · 끝난 업무 · 다시 돌려도 한 번만(app_settings 기록)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const mk = (title, ref, extra = {}) => ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ctx.staffA.id, orgUnitId: ctx.hq, approvalRequired: false, space: 'sales', ...extra }).then(async (t) => { if (ref) await sql`update tasks set sales_ref = ${sql.json(ref)} where id = ${t.id}`; return t.id; });
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('공고에서 온 열린 [영업] 업무만 [입찰]로(태그에 입찰 보탬·활동 기록) · 영업 DB 시작·끝난 업무는 그대로 · 한 번만', async () => {
  const [lead] = await sql`insert into sales_leads (tenant, name, status, src) values ('default', '광명 공고 리드', '신규리드', ${sql.json({ from: 'bid', id: 'B-OLD', handoff: true })}) returning id`;
  const [plain] = await sql`insert into sales_leads (tenant, name, status, src) values ('default', '시설 영업 리드', '신규리드', ${sql.json({ from: 'facility', id: 'F1' })}) returning id`;
  const a = await mk('[영업] 광명푸르지오 센트베르 커뮤니티 위탁 운영 선정 공고(2차)', { kind: 'bid', id: 'B-OLD', name: '광명', handoff: true });
  const b = await mk('[영업] 한화포레나 평택화양 주민공동시설 위탁운영 공고 — 검토·첫 연락', { kind: 'bid', id: 'B-OLD2', name: '한화' });
  const c = await mk('[영업] 광명 공고 리드 — 다음 연락', { kind: 'lead', id: lead.id, name: '광명' }); await sql`update tasks set lead_id = ${lead.id} where id = ${c}`;
  const d = await mk('[영업] 시설 영업 리드 — 다음 연락', { kind: 'lead', id: plain.id, name: '시설' }); await sql`update tasks set lead_id = ${plain.id} where id = ${d}`;
  const e = await mk('[영업] 분당 스포츠센터 — 미팅', { kind: 'facility', id: 'F2', name: '분당' });
  const f = await mk('[영업] 끝난 공고 — 검토', { kind: 'bid', id: 'B-DONE', name: '끝' }); await sql`update tasks set status = 'done', completed_at = now() where id = ${f}`;
  const g = await mk('[입찰] 이미 입찰 표기', { kind: 'bid', id: 'B-OK', name: '이미' });
  const r1 = await tick();
  assert.deepEqual([r1.bidPrefixFix?.changed, [...(r1.bidPrefixFix?.ids ?? [])].sort()], [3, [a, b, c].sort()], JSON.stringify(r1.bidPrefixFix));
  const titles = Object.fromEntries((await sql`select id, title, tags from tasks where id = any(${[a, b, c, d, e, f, g]}::uuid[])`).map((x) => [x.id, [x.title, x.tags]]));
  assert.equal(titles[a][0], '[입찰] 광명푸르지오 센트베르 커뮤니티 위탁 운영 선정 공고(2차)'); assert.ok(titles[a][1].includes('입찰'));
  assert.equal(titles[b][0], '[입찰] 한화포레나 평택화양 주민공동시설 위탁운영 공고 — 검토·첫 연락');
  assert.equal(titles[c][0], '[입찰] 광명 공고 리드 — 다음 연락', '공고에서 넘어온 리드의 자동 업무도');
  assert.equal(titles[d][0], '[영업] 시설 영업 리드 — 다음 연락', '영업 DB 시작은 그대로');
  assert.equal(titles[e][0], '[영업] 분당 스포츠센터 — 미팅'); assert.equal(titles[f][0], '[영업] 끝난 공고 — 검토', '끝난 업무는 그대로'); assert.equal(titles[g][0], '[입찰] 이미 입찰 표기');
  assert.equal((await sql`select count(*)::int n from activities where entity_id = ${a} and action = 'updated' and changes->>'reason' = 'bid_prefix_328'`)[0].n, 1);
  const [flag] = await sql`select value from app_settings where key = 'bid_prefix_fix_328'`;
  assert.equal(flag.value.changed.length, 3); assert.ok(flag.value.changed.every((x) => x.from.startsWith('[영업]') && x.to.startsWith('[입찰]')));
  const h = await mk('[영업] 뒤에 만든 공고 업무', { kind: 'bid', id: 'B-LATE', name: '뒤' });
  const r2 = await tick();
  assert.equal(r2.bidPrefixFix?.skipped, 'done', '한 번만');
  assert.equal((await sql`select title from tasks where id = ${h}`)[0].title, '[영업] 뒤에 만든 공고 업무');
});
