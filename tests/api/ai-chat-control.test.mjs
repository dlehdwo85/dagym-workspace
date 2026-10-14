// V19 부록 A: AI 비서 [멈춤](요청을 끊으면 서버도 멈추고 제안을 만들지 않음) · 마지막 질문 고쳐 보내기/다시 답하기 · 단락 나누기 지시 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text, extra = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('AI 비서 멈춤·고쳐 보내기', () => {
  let threadId;
  test('단락 나누기 지시가 시스템 프롬프트에', async () => {
    const n0 = (await fakeState()).anthropic.length;
    await queue([say('첫 답입니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '이번 주 내 업무 정리해줘' });
    threadId = r.threadId;
    const sys = (await fakeState()).anthropic.slice(n0)[0].body.system;
    assert.match(String(JSON.stringify(sys)), /빈 줄로 단락/);
  });

  test('[멈춤]: 요청을 끊으면 만들던 제안은 취소(실행 안 됨), 질문은 "멈춤"으로 남고 문맥에서 빠짐, 같은 질문 다시 가능', async () => {
    const before = (await sql`select count(*)::int n from ai_proposals where status = 'pending'`)[0].n;
    await queue([toolUse('t1', 'propose_create_task', { title: '멈춤 시험 업무', assigneeId: ctx.ownerId }), say('업무를 준비했습니다.', { delayMs: 4000 })]);
    const ac = new AbortController();
    const p = fetch(BASE + '/api/ai/chat', { method: 'POST', signal: ac.signal, headers: { origin: BASE, cookie: ctx.owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text: '멈춤 시험 업무 만들어줘', threadId }) }).catch((e) => e);
    await wait(1500);
    ac.abort();
    await p;
    await wait(4500); // 서버가 늦게 끝나더라도 저장 결과 확인
    const [m] = await sql`select status, text from ai_messages where thread_id = ${threadId} and role = 'user' order by id desc limit 1`;
    assert.equal(m.status, 'stopped'); assert.equal(m.text, '멈춤 시험 업무 만들어줘');
    assert.equal((await sql`select count(*)::int n from ai_proposals where status = 'pending'`)[0].n, before, '멈춘 질문의 제안은 대기로 남지 않음');
    assert.equal((await sql`select count(*)::int n from tasks where title = '멈춤 시험 업무'`)[0].n, 0);
    // 같은 질문 다시 — "방금 같은 질문" 으로 막히지 않고, 문맥에 멈춘 질문이 들어가지 않음
    const n0 = (await fakeState()).anthropic.length;
    await queue([say('다시 답합니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '멈춤 시험 업무 만들어줘', threadId });
    assert.equal(r.reply, '다시 답합니다.');
    const msgs = (await fakeState()).anthropic.slice(n0)[0].body.messages;
    assert.equal(msgs.filter((x) => JSON.stringify(x.content).includes('멈춤 시험 업무 만들어줘')).length, 1, '멈춘 질문은 문맥에 없음');
  });

  test('고쳐 보내기(replaceLast): 마지막 질문·답·확정 안 된 제안은 교체, 확정된 제안은 유지하고 알려 줌, 다른 질문이면 지우지 않음', async () => {
    await queue([toolUse('a', 'propose_create_task', { title: '확정될 업무', assigneeId: ctx.ownerId }), toolUse('b', 'propose_create_task', { title: '버려질 업무', assigneeId: ctx.ownerId }), say('두 건 준비')]);
    const r1 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '업무 두 개 만들어줘', threadId });
    const [pa, pb] = r1.proposals;
    await ctx.owner.ok('POST', `/api/ai/proposals/${pa.id}`, { accept: true });
    // 바꿀 질문이 서버의 마지막 질문과 다르면 지우지 않는다
    await queue([say('그대로')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '다른 질문', threadId, replaceLast: true, replaceText: '전혀 다른 원문' });
    assert.ok((await sql`select 1 from ai_messages where thread_id = ${threadId} and text = '업무 두 개 만들어줘'`).length, '다른 원문이면 보존');
    // 마지막 질문(= 다른 질문)을 고쳐 보내기
    await queue([say('고친 질문에 대한 답')]);
    const r2 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '다른 질문(고침)', threadId, replaceLast: true, replaceText: '다른 질문' });
    assert.equal(r2.reply, '고친 질문에 대한 답');
    const texts = (await sql`select role, text from ai_messages where thread_id = ${threadId} order by id`).map((m) => m.text);
    assert.ok(!texts.includes('다른 질문') && !texts.includes('그대로'), '이전 질문·답 지움');
    assert.ok(texts.includes('다른 질문(고침)'));
    // 제안이 있던 질문을 고치면: 확정 안 된 제안은 취소, 확정된 업무는 그대로 + kept 로 알려 줌
    await queue([say('ok')]);
    const r0 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '업무 두 개 다시', threadId });
    void r0;
    await queue([toolUse('c', 'propose_create_task', { title: '대기 업무', assigneeId: ctx.ownerId }), say('준비')]);
    const r3 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '대기 업무 만들어줘', threadId });
    await ctx.owner.ok('POST', `/api/ai/proposals/${r3.proposals[0].id}`, { accept: true }).catch(() => {});
    await queue([toolUse('d', 'propose_create_task', { title: '취소될 업무', assigneeId: ctx.ownerId }), say('준비2')]);
    const r4 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '업무 하나 더', threadId });
    await queue([say('바꿈')]);
    const r5 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '업무 하나 더(수정)', threadId, replaceLast: true, replaceText: '업무 하나 더' });
    assert.equal((await sql`select status from ai_proposals where id = ${r4.proposals[0].id}`)[0].status, 'cancelled', '확정 안 된 제안 취소');
    assert.equal(r5.kept, undefined, '그 질문엔 확정된 제안 없음');
    assert.equal((await sql`select status from ai_proposals where id = ${pb.id}`)[0].status, 'pending', '다른 질문의 제안은 그대로');
    // 확정된 제안이 있는 마지막 질문을 다시 답하기 → kept
    await queue([toolUse('e', 'propose_create_task', { title: '확정 후 다시', assigneeId: ctx.ownerId }), say('준비3')]);
    const r6 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '확정 후 다시 답하기 시험', threadId });
    await ctx.owner.ok('POST', `/api/ai/proposals/${r6.proposals[0].id}`, { accept: true });
    await queue([say('새 답')]);
    const r7 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '확정 후 다시 답하기 시험', threadId, replaceLast: true, replaceText: '확정 후 다시 답하기 시험' });
    assert.deepEqual(r7.kept, [r6.proposals[0].summary], '이미 처리된 제안을 알려 줌');
    assert.equal((await sql`select count(*)::int n from tasks where title = '확정 후 다시' and deleted_at is null`)[0].n, 1, '확정된 업무는 그대로');
    assert.equal((await sql`select count(*)::int n from tasks where title = '확정될 업무' and deleted_at is null`)[0].n, 1);
  });

  test('남의 대화는 고쳐 보내기 불가(404)', async () => {
    const r = await ctx.staffA.client.req('POST', '/api/ai/chat', { text: '남의 대화', threadId, replaceLast: true, replaceText: '확정 후 다시 답하기 시험' });
    assert.equal(r.status, 404);
    assert.ok((await sql`select 1 from ai_messages where thread_id = ${threadId} and text = '확정 후 다시 답하기 시험'`).length, '지워지지 않음');
  });
});
