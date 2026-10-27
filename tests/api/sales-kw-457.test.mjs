// 224차 #457 관심 검색어·제외어 추천: 진행한 공고 ↔ 대상 아님 공고 근거 + 숫자는 서버가 셈(AI 말만 믿지 않음) → 고른 것만 반영 · 월 1회 정기(AI 없이) 놓친 공고 후보 알림
// 가짜 AI 서버로 시험 — 구조 시험 통과, 실제 AI 추천 품질은 확인 못함
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const ID = (n) => `00000000-0000-4000-8000-000000457${String(n).padStart(3, '0')}`;
const ins = (n, title) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n), source_type: 'kapt_bid', title, notice_kind: 'new', current_status: '진행중' })}, 'workin')`;
const work = (n, status, reason = null) => sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, data) values ('default', 'opportunity_work', ${`w:bid:${ID(n)}`}, ${ID(n)}, ${status}, ${sql.json(reason ? { skip_reason: reason } : {})})`;
before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer({ SALES_KW_MONTHLY: 'any' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: ['수질검사', '승강기'], excludes: [] });
  // 진행한 공고(검토중·입찰 진행) 5 · 대상 아님 4(사유) · 지난 30일 다른 공고 3
  const pos = ['[서울] 시험단지 저수조 청소 용역', '[경기] 시험단지 저수조청소 업체 선정', '[인천] 시험단지 저수조 청소 및 수질검사', '[부산] 시험단지 방역소독 용역', '[대구] 시험단지 방역소독 업체 선정'];
  for (const [i, t] of pos.entries()) { await ins(i + 1, t); await work(i + 1, i % 2 ? '입찰 진행' : '검토중'); }
  const neg = [['[서울] 시험단지 승강기 교체 공사', '승강기 안 함'], ['[경기] 시험단지 승강기 정밀점검', '승강기'], ['[인천] 시험단지 외벽 도색', '도색'], ['[부산] 시험단지 외벽 도색 보수', '도색']];
  for (const [i, [t, r]] of neg.entries()) { await ins(i + 11, t); await work(i + 11, '대상아님', r); }
  await ins(21, '[광주] 시험단지 저수조 청소 용역'); await ins(22, '[대전] 시험단지 승강기 부품 교체'); await ins(23, '[울산] 시험단지 외벽 도색 공사');
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

const item = (s, kind, word) => s[kind].find((x) => x.word === word);

test('[추천 받기](관리자·AI): 근거 숫자는 서버가 셈 · 근거 없는 AI 낱말은 버림 · 진행한 공고를 가리는 제외어는 위험 표시 · 낱말 세기로 채움', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/kw-suggest', {})).status, 403, '직원은 추천 받기 못 함');
  assert.equal((await ctx.staffB.client.req('GET', '/api/sales/kw-suggest')).status, 404, '영업 공간 밖 404');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/kw-suggest')).suggestion, null);
  await ctl({ anthropicReset: true, anthropicQueue: [say({ add: [{ word: '저수조', why: '진행한 저수조 청소 공고' }, { word: '없는낱말', why: '근거 없음' }],
    exclude: [{ word: '도색', why: '도색 공고는 모두 대상 아님' }, { word: '시험단지', why: '잘못된 추천' }], remove: [{ word: '승강기', why: '승강기 공고만 끌어옴' }, { word: '모르는말', why: 'x' }] })] });
  const { suggestion: s } = await ctx.owner.ok('POST', '/api/sales/kw-suggest', {});
  assert.equal(s.via, 'ai'); assert.deepEqual(s.base, { pos: 5, neg: 4, pool: 3 });
  assert.deepEqual(s.add.map((x) => x.word), ['저수조', '청소', '방역소독'], 'AI 1개 + 낱말 세기로 채움 · 근거 없는 낱말 버림');
  assert.deepEqual([item(s, 'add', '저수조').why, item(s, 'add', '저수조').pos, item(s, 'add', '저수조').neg, item(s, 'add', '저수조').more], ['진행한 저수조 청소 공고', 3, 0, 1], '띄어쓰기 상관없이 진행 3 · 지난 30일 더 보일 공고 1');
  assert.deepEqual(s.exclude.map((x) => [x.word, !!x.risky]), [['도색', false], ['시험단지', true], ['외벽', false]], '진행한 공고도 가리는 제외어는 위험 표시');
  assert.deepEqual([item(s, 'exclude', '시험단지').pos, item(s, 'exclude', '시험단지').neg], [5, 4]);
  assert.deepEqual(s.remove.map((x) => [x.word, x.pos, x.neg, x.hidden]), [['승강기', 0, 2, 1]], '지금 검색어만 뺄 수 있음 · 빼면 지난 30일 공고 1건이 안 보임');
  assert.deepEqual(s.missed.map((m) => [m.title, m.word]), [['[광주] 시험단지 저수조 청소 용역', '저수조']], '놓친 공고 후보');
  const sent = JSON.stringify((await (await fetch(`${FAKE}/__state`)).json()).anthropic?.at(-1)?.body ?? {});
  assert.ok(sent.includes('시험단지 외벽 도색') && sent.includes('사유: 도색') && sent.includes('수질검사'), 'AI 재료: 진행·대상 아님 공고 제목·사유·지금 검색어');
  const [u] = await sql`select count(*)::int n from ai_usage where purpose = 'sales_kw_suggest'`;
  assert.equal(u.n, 1, 'AI 사용 기록(회사 월 AI 예산)');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/kw-suggest')).suggestion.add.length, 3, '직원도 마지막 추천을 볼 수 있음');
});

test('고른 것만 반영(관리자): 관심 검색어 + 넣을 것 − 뺄 것, 제외어 + 넣을 것 · 감사 기록', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/kw-suggest/apply', { add: ['저수조'] })).status, 403);
  assert.equal((await ctx.owner.req('POST', '/api/sales/kw-suggest/apply', { add: ['저'] })).status, 400, '1자 낱말 거절');
  const r = await ctx.owner.ok('POST', '/api/sales/kw-suggest/apply', { add: ['저수조', '청소', ' 저수조 '], exclude: ['도색'], remove: ['승강기'] });
  assert.deepEqual([r.prefs.keywords, r.prefs.excludes], [['수질검사', '저수조', '청소'], ['도색']]);
  const [a] = await sql`select count(*)::int n from audit_logs where action = 'sales.kw_apply'`;
  assert.equal(a.n, 1);
  const { suggestion: s } = await ctx.owner.ok('GET', '/api/sales/kw-suggest');
  assert.deepEqual([s.add.map((x) => x.word), s.exclude.map((x) => x.word), s.remove.length, s.missed.length], [['방역소독'], ['시험단지', '외벽'], 0, 0], '반영한 낱말·그 낱말로 찾은 놓친 공고는 추천에서 빠짐');
});

test('월 1회 정기(AI 없이 낱말 세기): 추천이 있으면 관리자에게 알림 1건 · 같은 달 두 번 안 돎', async () => {
  await ctl({ anthropicReset: true });
  await tick();
  const [st] = await sql`select kw_monthly, kw_suggestion from sales_settings where tenant = 'default'`;
  assert.match(st.kw_monthly, /^\d{4}-\d{2}$/); assert.equal(st.kw_suggestion.via, 'rules', '정기 추천은 AI 를 부르지 않음');
  assert.deepEqual(st.kw_suggestion.add.map((x) => x.word), ['방역소독'], '이미 넣은 낱말은 빼고');
  const n1 = await sql`select title, link, user_id from notifications where type = 'sales_kw_suggest'`;
  assert.equal(n1.length, 1); assert.equal(n1[0].user_id, ctx.ownerId); assert.equal(n1[0].link, '/s/sales/sources#kw-suggest');
  assert.match(n1[0].title, /관심 검색어 추천 1개 · 지난 30일 놓친 공고 후보 0건/);
  await tick();
  assert.equal((await sql`select count(*)::int n from notifications where type = 'sales_kw_suggest'`)[0].n, 1, '같은 달 한 번만');
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_kw_suggest'`)[0].n, 1, '정기 추천은 AI 비용 없음');
});

test('AI 가 실패하면 낱말 세기로 · 비용 기록 없음 · 입찰을 쓰지 않는 회사는 403', async () => {
  const before = (await (await fetch(`${FAKE}/__state`)).json()).anthropic.length;
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 400, errorType: 'invalid_request_error', message: 'bad' }] });
  const { suggestion: s } = await ctx.owner.ok('POST', '/api/sales/kw-suggest', {});
  assert.equal((await (await fetch(`${FAKE}/__state`)).json()).anthropic.length, before + 1, 'AI 는 한 번 불렀고');
  assert.equal(s.via, 'rules'); assert.deepEqual(s.add.map((x) => x.word), ['방역소독']);
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_kw_suggest'`)[0].n, 1);
  await sql`update tenants set sales_bids = false where id = 'default'`;
  try { assert.equal((await ctx.owner.req('POST', '/api/sales/kw-suggest', {})).status, 403); } finally { await sql`update tenants set sales_bids = null where id = 'default'`; }
});
