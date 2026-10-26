// 170차(로컬 10/26 10:45): 시안 세트 13건 중 5건이 9시간 뒤에도 초안 — 응답 뒤 제작이 함수 시간 제한(300초)에 끊기고, 자동 생성 일시정지(auto_pause)가 이어서 만들기를 막았다
// → 응답 뒤 제작은 시간 예산(MKT_SAMPLE_BUDGET_MS) 안에서만, 남은 칸은 정기 실행(tick)이 일시정지 중에도 '시안 세트 칸만' 이어서 만든다(규칙 없는 회사 포함)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const draft = (n) => say({ title: `시안 ${n}`, body: `시안 ${n} 본문입니다.\n한 줄 더 적습니다.\n문의 032-111-2222`, brief: '', why: '', hooks: [], keyword: '', card: CARD });
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ MKT_SAMPLE_BUDGET_MS: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, autoPause: true }); // 대표 15-16 자동 생성 일시정지 중
  for (const name of ['세트브랜드A', '세트브랜드B']) {
    const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name });
    await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b.id}`, { intro: '동네 헬스장', products: '1개월 회원권', facts: { phone: '032-111-2222' } });
  }
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('시안 세트: 응답 뒤 제작은 예산 안에서만(1건) → 나머지는 일시정지 중에도 정기 실행이 시안 세트 칸만 이어서 만든다(규칙 없는 회사 포함)', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [draft(1), draft(2), draft(3), draft(4)] });
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/sample', {});
  assert.equal(r.contents.length, 4, JSON.stringify(r.contents));
  const ids = r.contents.map((c) => c.id);
  let jr;
  for (let k = 0; k < 160 && !jr; k++) { [jr] = await sql`select detail from job_runs where job = 'mktSample' order by id desc limit 1`; if (!jr) await new Promise((res) => setTimeout(res, 250)); }
  assert.ok(jr, '응답 뒤 제작 기록'); assert.equal(jr.detail.out.length, 1, JSON.stringify(jr.detail)); assert.equal(jr.detail.left, 3);
  assert.equal((await sql`select count(*)::int n from mkt_contents where id = any(${ids}::uuid[]) and produced_at is null and quality->>'sample' = 'true'`)[0].n, 3, '남은 3건은 시안 세트 표시 그대로');
  const t = await tick();
  const mine = t.detail.mktAuto.find((x) => x.tenant === 'default');
  assert.ok(mine && mine.paused === true && mine.producing === 'later', JSON.stringify(t.detail.mktAuto));
  let rows;
  for (let k = 0; k < 240; k++) { rows = await sql`select id, produced_at from mkt_contents where id = any(${ids}::uuid[])`; if (rows.every((x) => x.produced_at)) break; await new Promise((res) => setTimeout(res, 500)); }
  assert.ok(rows.every((x) => x.produced_at), `일시정지 중에도 시안 세트 칸은 이어서: ${JSON.stringify(rows)}`);
  // 185차 후속(CI 1478): 제작 기록(job_runs)은 runLater 가 제작을 다 마친 뒤에 남긴다 — 마지막 칸 produced_at 과 기록 사이 틈이 있어 기록도 기다린다
  let pr;
  for (let k = 0; k < 120 && !pr; k++) { [pr] = await sql`select detail from job_runs where job = 'mktProduce' order by id desc limit 1`; if (!pr) await new Promise((res) => setTimeout(res, 250)); }
  assert.ok(pr, '정기 실행 제작 기록');
  assert.equal(pr.detail.sampleOnly, true); assert.equal(pr.detail.produced.length, 3, JSON.stringify(pr.detail));
  assert.equal((await sql`select count(*)::int n from mkt_contents where tenant = 'default' and rule_id is not null`)[0].n, 0, '일시정지는 그대로 — 정기 칸은 안 만듦');
});
