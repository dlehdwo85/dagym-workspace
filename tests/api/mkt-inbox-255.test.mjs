// 255차 #791~#793(로컬 10/29 01:45 대표 지시 '마케팅실 AI 가 현 문제 파악을 못함 · 게시물 제작 수준 향상 명령 이후 승인 대기가 안 올라온다 ·
//   수정 요청을 남기면 오푸스 수준 모델이 점검해 시안을 만들어 승인함에 올리고 승인 또는 재수정'):
// ① 게시일(승인 마감)이 지난 승인 대기도 승인함 숫자·목록에 → 승인하면 가장 가까운 빈 게시 칸으로 ② 사람이 쓴 글도 수정 요청 → 최상 모델 수정본(원 게시일이 지났으면 다음 빈 칸)
// ③ 영상 수정 요청 → 다시 만들기 비용(크레딧·원)·이번 달 남은 수 카드(승인 뒤 제작) · [이미지 카드뉴스로 바꿔 만들기 · 0크레딧] ④ 예전에 처리 안 된 수정 요청 [AI 수정본 만들기]
// ⑤ AI 마케터 도구(승인함 현황·자동 제작 상태·콘텐츠 상태)로 '승인 대기 0 이유'를 답함 (가짜 AI = 구조 시험 — 실제 글·그림 품질은 운영 화면에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }], stop_reason: 'end_turn' });
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const CARD = { kicker: '소식', kickerAlts: [], points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const draft = (o) => say({ brief: '', why: '', hooks: [], keyword: '', card: CARD, ...o });
const toolResult = (req, tid) => { for (const m of req.body.messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result' && b.tool_use_id === tid) return JSON.parse(typeof b.content === 'string' ? b.content : b.content.map((x) => x.text ?? '').join('')); return null; };
async function post(title, { channel = 'threads', kind = null, status = 'pending', days = -3, body = '원래 글입니다.\n두 번째 줄입니다.' } = {}) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, is_test, mode)
    values ('default', ${P.brand}, ${title}, ${channel}, ${kind}, now() + make_interval(days => ${days}), ${status}, 1, ${ctx.ownerId}, false, false, 'content') returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${body}, '{}', '사람이 씀', ${ctx.ownerId})`;
  return c.id;
}
const row = async (id) => (await sql`select c.status, c.kind, c.current_version, c.scheduled_at, c.quality, v.media_ids, v.revision from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '수정시험' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '사내 업무·일정 협업툴', products: '업무·일정·마케팅을 한 화면에서' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('#791 게시일 지난 승인 대기: 승인함 숫자·목록(게시일 지남)에 보임 → 승인하면 가장 가까운 빈 게시 칸으로 옮겨 승인', async () => {
  const id = await post('지난 글 승인');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/inbox')).counts.contents, 1, '예전에는 숫자에서 빠져 0');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/overview')).pending, 1);
  const it = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.find((x) => x.id === id);
  assert.deepEqual([it.status, it.late], ['pending', true]);
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' });
  assert.equal(r.status, 'approved'); assert.ok(r.rescheduled, JSON.stringify(r));
  const x = await row(id);
  assert.equal(new Date(x.scheduled_at).toISOString(), r.rescheduled.to); assert.ok(new Date(x.scheduled_at).getTime() > Date.now() + 3600e3, '새 칸은 앞날');
  assert.deepEqual([x.status, x.quality.rescheduled.by, x.quality.rescheduled.from], ['approved', 'approve', r.rescheduled.from]);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/inbox')).counts.contents, 0);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.decide' and target_id = ${id} and detail->>'rescheduled' is not null`).length, '감사 기록에 옮긴 시각');
});

test('#792 사람이 쓴 글도 수정 요청 → 최상 모델 수정본(승인 대기) · 원 게시일이 지났으면 다음 빈 칸', async () => {
  const id = await post('사람이 쓴 글', { days: -2 });
  const n0 = fake.state.anthropic.length;
  await ctl({ anthropicReset: true, anthropicQueue: [draft({ title: '사람이 쓴 글', body: '짧게 고친 첫 줄\n두 번째 줄입니다.' })] });
  const d = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'changes', comment: '첫 줄을 더 짧게' });
  assert.deepEqual([d.revision.version, d.revision.status, d.revision.n], [2, 'pending', 1], JSON.stringify(d.revision));
  assert.ok(d.revision.rescheduled, '원 게시일이 지나 다음 빈 칸으로');
  const reqs = fake.state.anthropic.slice(n0).filter((x) => JSON.stringify(x.body ?? {}).includes('[수정 요청]'));
  assert.equal(reqs.length, 1); assert.equal(reqs[0].body.model, 'claude-opus-5-5', '수정 요청 수정본 = 최상 모델');
  const x = await row(id);
  assert.deepEqual([x.status, x.current_version, x.revision.ai, x.revision.request], ['pending', 2, true, '첫 줄을 더 짧게']);
  assert.ok(new Date(x.scheduled_at).getTime() > Date.now());
});

test('#792 영상 수정 요청 → 비용·남은 수 카드(승인 뒤 제작) · [이미지 카드뉴스로 바꿔 만들기 · 0크레딧]', async () => {
  const id = await post('릴스 · 업무·일정·마케팅을 한 화면에서', { channel: 'instagram', kind: 'reels', days: 2 });
  const n0 = fake.state.anthropic.length;
  const d = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'changes', comment: '영상 퀄리티가 아쉬워요. 외국 사람이 나오고 배경이 공사현장이네요' });
  assert.equal(d.revision.kind, 'regen_video', JSON.stringify(d.revision)); assert.equal(d.revision.version, undefined);
  assert.equal(d.revision.card.reason, '다시 만들기 약 15크레딧(약 645~1,050원) · 이번 달 남은 영상 2편 · 재생성 10회 — 승인하면 제작');
  assert.equal(fake.state.anthropic.length, n0, '글을 고치라는 말이 없으면 AI 를 부르지 않음');
  const it = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.find((x) => x.id === id);
  assert.deepEqual([it.production.kind, it.production.status, it.production.est, it.production.reason], ['regen_video', 'needs_approval', 15, d.revision.card.reason]);
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/auto/contents/${id}`, { action: 'to_cards' })).status, 403, '관리자만');
  await ctl({ anthropicReset: true, anthropicQueue: [draft({ title: '업무·일정·마케팅을 한 화면에서', body: '업무, 일정, 마케팅을 따로 보느라 바쁘셨죠?\n워크인 한 화면에서 정리됩니다.',
    slides: [{ role: 'cover', title: '한 화면에서 끝', body: '' }, { role: 'problem', title: '창이 너무 많죠', body: '업무 따로\n일정 따로' }, { role: 'solution', title: '한 곳에 모아요', body: '업무·일정·마케팅' }, { role: 'cta', title: '지금 써 보세요', body: '14일 무료' }] })] });
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/contents/${id}`, { action: 'to_cards' });
  assert.deepEqual([r.revision.kind, r.revision.version], ['cards', 2], JSON.stringify(r.revision));
  const x = await row(id);
  assert.equal(x.kind, 'feed'); assert.ok(x.media_ids.length >= 3, `표지 + 장 ${x.media_ids.length}`); assert.equal(x.quality.visual.by, 'server');
  assert.equal(x.status, 'pending', JSON.stringify(x.quality.issues));
  assert.equal((await sql`select status from mkt_production_requests where content_id = ${id} and kind = 'regen_video'`)[0].status, 'canceled', '영상 다시 만들기 카드는 취소');
  assert.equal((await sql`select coalesce(sum(credits), 0)::float8 n from mkt_credit_ledger where content_id = ${id}`)[0].n, 0, '0크레딧');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/auto/contents/${id}`, { action: 'to_cards' })).status, 400, '이미 카드뉴스');
});

test('#792 255차 전에 처리 안 된 수정 요청 → [AI 수정본 만들기] · 처리할 요청이 없으면 400', async () => {
  const id = await post('예전 수정 요청 글', { status: 'changes', days: 5 });
  await sql`insert into mkt_decisions (content_id, version, decision, comment, decided_by) values (${id}, 1, 'changes', '문장을 더 짧게', ${ctx.ownerId})`;
  const it = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.find((x) => x.id === id);
  assert.deepEqual([it.status, it.last_decision.decision, it.last_decision.version, it.production], ['changes', 'changes', 1, null], '화면이 [AI 수정본 만들기]를 보이는 조건');
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/auto/contents/${id}`, { action: 'revise' })).status, 403);
  await ctl({ anthropicReset: true, anthropicQueue: [draft({ title: '예전 수정 요청 글', body: '짧게 고친 글입니다.\n두 번째 줄.' })] });
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/contents/${id}`, { action: 'revise' });
  assert.deepEqual([r.revision.version, r.revision.status], [2, 'pending'], JSON.stringify(r.revision));
  assert.equal((await ctx.owner.req('POST', `/api/marketing/auto/contents/${id}`, { action: 'revise' })).status, 400, '이제 처리할 수정 요청 없음');
});

test("#793 AI 마케터: 승인함 현황·자동 제작 상태·콘텐츠 상태 도구로 '승인 대기 0 이유'(게시일 지남·일시정지·처리 안 된 수정 요청)", async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { autoPause: true });
  await post('승인 기다리는 지난 글', { days: -4 });
  const ch = await post('처리 안 된 수정 요청', { status: 'changes', days: 3 });
  await sql`insert into mkt_decisions (content_id, version, decision, comment, decided_by) values (${ch}, 1, 'changes', '사진을 실제 사무실로', ${ctx.ownerId})`;
  const n0 = fake.state.anthropic.length;
  await ctl({ anthropicReset: true, anthropicQueue: [toolUse('a', 'marketing_inbox_status', {}), toolUse('b', 'marketing_auto_status', {}), toolUse('c', 'marketing_content_status', { query: '처리 안 된' }), say('승인할 시안이 있습니다.')] });
  const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '승인함에 콘텐츠 승인대기가 하나도 없어 왜 그래?', space: 'marketing' });
  const reqs = fake.state.anthropic.slice(n0);
  assert.equal(reqs.length, 4);
  const names = reqs[0].body.tools.map((t) => t.name);
  for (const n of ['marketing_inbox_status', 'marketing_content_status', 'marketing_auto_status']) assert.ok(names.includes(n), `${n} 붙음 — ${names}`);
  const sys = typeof reqs[0].body.system === 'string' ? reqs[0].body.system : reqs[0].body.system.map((b) => b.text ?? '').join('\n');
  assert.match(sys, /조회할 도구가 없다"고 하지 마세요/);
  const ib = toolResult(reqs[1], 'a');
  assert.ok(ib.counts.approvable >= 1 && ib.counts.approvableLate >= 1, JSON.stringify(ib.counts));
  assert.equal(ib.counts.changesUnprocessed, 1); assert.equal(ib.autoPaused, true);
  assert.ok(ib.why.some((w) => w.startsWith('게시일(승인 마감)이 지난 승인 대기')), ib.why.join(' / '));
  assert.ok(ib.why.some((w) => w.startsWith('자동 제작 일시정지 중')));
  assert.ok(ib.why.some((w) => w.startsWith('수정 요청 1건이 아직 AI 수정본으로 안 만들어짐')));
  const au = toolResult(reqs[2], 'b');
  assert.deepEqual([au.paused, au.pausedSince.by, au.nextProduction], [true, '김대표', null]); assert.match(au.whilePaused, /정기 칸·자동 제작/);
  assert.equal(au.left.videos, 2);
  const cs = toolResult(reqs[3], 'c');
  assert.equal(cs.items.length, 1); assert.deepEqual([cs.items[0].title, cs.items[0].status, cs.items[0].aiRevisionPending, cs.items[0].lastDecision.comment], ['처리 안 된 수정 요청', '수정 요청', true, '사진을 실제 사무실로']);
  assert.deepEqual(r.tools, ['marketing_inbox_status', 'marketing_auto_status', 'marketing_content_status']);
  await ctx.owner.ok('PUT', '/api/marketing/auto', { autoPause: false });
});
