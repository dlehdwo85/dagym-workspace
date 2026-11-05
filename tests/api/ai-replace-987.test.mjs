// 365차 #987(대표 11/05): AI 비서 대기 중 제안을 고쳐 달라고 하면 새 제안으로 바꿔 끼우고 옛 제안은 자동 취소(대표가 [취소]를 따로 안 누르게) (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const status = async (id) => (await sql`select status from ai_proposals where id = ${id}`)[0].status;

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('365차 #987 대기 제안 바꿔 끼우기', () => {
  let threadId, first;
  test('대화 기록에 대기 제안 id · 도구에 replacesProposalId · 시스템 프롬프트 규칙', async () => {
    await queue([toolUse('a', 'propose_create_task', { title: '견적서 보내기', assigneeId: ctx.staffA.id }), say('업무를 준비했습니다. 확인을 누르면 반영됩니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '이직원한테 견적서 보내기 업무 만들어줘' });
    threadId = r.threadId; first = r.proposals[0];
    assert.equal(await status(first.id), 'pending');
    const n0 = (await fakeState()).anthropic.length;
    await queue([say('네')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '방금 만든 제안 내용 알려줘', threadId });
    const req = (await fakeState()).anthropic.slice(n0)[0].body;
    assert.ok(JSON.stringify(req.messages).includes(`대기 · id=${first.id}`), '기록에 대기 제안 id');
    const tool = req.tools.find((t) => t.name === 'propose_create_task');
    assert.ok(tool.input_schema.properties.replacesProposalId, '도구에 바꿔 끼우기 칸');
    assert.match(JSON.stringify(req.system), /replacesProposalId/);
  });

  test('모델이 replacesProposalId 를 넣으면: 새 제안만 대기 · 옛 제안 자동 취소 · 응답 replaced', async () => {
    // 앞 답('네')에는 제안이 없으므로 기록의 옛 제안 id 로 직접 바꿔 끼움
    await queue([toolUse('b', 'propose_create_task', { title: '견적서 보내기', assigneeId: ctx.staffB.id, replacesProposalId: first.id }), say('고친 제안으로 바꿨습니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '담당은 박직원으로 바꿔줘', threadId });
    assert.equal(r.proposals.length, 1);
    assert.match(r.proposals[0].summary, /담당 박직원/, '366차 후속: 카드 한 줄에 담당');
    assert.deepEqual(r.replaced, [first.id]);
    assert.equal(await status(first.id), 'cancelled');
    assert.equal(await status(r.proposals[0].id), 'pending');
    assert.equal((await ctx.owner.req('POST', `/api/ai/proposals/${first.id}`, { accept: true })).status, 400, '옛 제안은 확인 안 됨');
    first = r.proposals[0];
  });

  test('모델이 id 를 빠뜨려도: 바로 앞 답의 같은 종류 대기 제안 1건 + "바꿔/고쳐" 질문이면 자동 취소', async () => {
    await queue([toolUse('c', 'propose_create_task', { title: '견적서 보내기(금요일)', assigneeId: ctx.staffB.id, dueDate: '2026-11-13' }), say('마감을 금요일로 한 제안입니다.')]);
    const n0 = (await fakeState()).anthropic.length;
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '마감은 금요일로 해줘', threadId });
    // 366차 후속: AI 가 보는 기록도 화면과 같은 이름(바꿔 끼운 옛 제안 = 새 제안으로 바뀜, 취소됨 아님)
    const hist = JSON.stringify((await fakeState()).anthropic.slice(n0)[0].body.messages);
    assert.match(hist, /새 제안으로 바뀜/); assert.doesNotMatch(hist, /담당 이직원[^\]]*\[취소됨\]/);
    assert.deepEqual(r.replaced, [first.id]);
    assert.equal(await status(first.id), 'cancelled');
    first = r.proposals[0];
  });

  test('고쳐 달라는 말이 없으면(새 업무 추가) 옛 제안은 그대로 · 남의 제안 id 는 못 지움', async () => {
    await queue([toolUse('d', 'propose_create_task', { title: '계약서 검토', assigneeId: ctx.staffA.id }), say('하나 더 준비했습니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '계약서 검토 업무도 하나 더 만들어줘', threadId });
    assert.equal(r.replaced, undefined);
    assert.equal(await status(first.id), 'pending', '추가 요청이면 그대로');
    // 다른 사람(직원)의 대화에서 대표 제안 id 를 넣어도 취소되지 않음
    await queue([toolUse('e', 'propose_create_task', { title: '남의 것', assigneeId: ctx.staffA.id, replacesProposalId: first.id }), say('준비')]);
    const o = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '내 업무 하나 만들어줘' });
    assert.equal(o.replaced, undefined);
    assert.equal(await status(first.id), 'pending', '남의 제안은 그대로');
  });
});
