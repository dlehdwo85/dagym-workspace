// 270차 #809(대표 10/29 '요금제 AI 영상 월 2편이라는 게 슈퍼관리자는 무한임에도 2편밖에 못 만든다는 건가요?'): 우리 회사(내부, 'default')는
// 마케팅 이미지·영상 생성 상한을 요금제 숫자 대신 '월 실제 비용 한도(원)'로 — 비우면 요금제 숫자 그대로 · 이번 달 쓴 돈(크레딧 × 1크레딧 단가) 표시
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('비용 한도를 정하면 요금제 숫자(크레딧·영상 편수·재생성) 대신 금액으로 · 이번 달 생성 비용 표시 · 비우면 다시 요금제 숫자', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro' });
  let v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.production.internal, v.production.costCapKrw, v.limits.videoMonthly], [true, null, 2], '처음은 요금제(pro) 숫자 — 영상 월 2편');
  assert.ok(v.production.weekly.length > 0);
  assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/marketing/auto', { costCapKrw: 1000 })).status), '관리자만');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { costCapKrw: 50000 });
  await sql`insert into mkt_credit_ledger (tenant, kind, credits, note) values ('default', 'generate_video', 80, '시험 영상')`;
  v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.limits.monthlyCredits, v.limits.weeklyCredits, v.limits.videoMonthly, v.limits.regenMonthly], [null, null, null, null], '요금제 숫자 대신 금액으로만');
  assert.deepEqual([v.production.costCapKrw, v.production.monthGenKrw, v.production.monthGenKrwMin, v.production.weekly.length], [50000, 80 * 70, 80 * 43, 0], '이번 달 생성 약 3,440~5,600원');
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.cost_cap'`).length, '바꾼 기록');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { costCapKrw: null });
  v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.production.costCapKrw, v.limits.videoMonthly, v.limits.monthlyCredits], [null, 2, 250], '비우면 요금제 숫자');
});
