// 370차(로컬 369차 운영 확인 thread 6a60c0e5): AI 가 첫 답에 "비슷한 제목의 열린 업무는 없었습니다"라고 한 뒤 다음 답에서 "확인하지 않은 내용이었다"고 스스로 정정
// → propose_create_task 가 서버에서 비슷한 제목의 열린 업무를 직접 찾아 도구 답(dupCheck)·카드 경고·대화 기록('서버 확인')에 남김 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('370차 업무 제안 서버 중복 확인', () => {
  let old;
  before(async () => { old = (await ctx.owner.ok('POST', '/api/tasks', { title: '[시험] 시험용 견적서 정리', assigneeId: ctx.staffA.id, orgUnitId: ctx.hq, approvalRequired: false })).id; });

  test('비슷한 열린 업무가 있으면: 도구 답 dupCheck 에 제목·담당 · 카드 경고 · 다음 답 기록에 서버 확인', async () => {
    const n0 = (await fakeState()).anthropic.length;
    await queue([toolUse('a', 'propose_create_task', { title: '시험용 견적서 정리 다시', assigneeId: ctx.staffA.id }), say('비슷한 열린 업무가 하나 있습니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '시험용 견적서 정리 다시 업무 만들어줘' });
    const second = (await fakeState()).anthropic.slice(n0)[1].body;
    const tr = JSON.stringify(second.messages);
    assert.match(tr, /서버 확인: 비슷한 제목의 열린 업무 1건 — \[시험\] 시험용 견적서 정리 · 담당 이직원/);
    assert.match(JSON.stringify(r.proposals[0].preview ?? {}), /비슷한 열린 업무 1건: \[시험\] 시험용 견적서 정리/, '카드 경고');
    assert.match(JSON.stringify(second.system), /앞 답에서 한 말은 새 도구 결과가 다를 때만 바로잡고/);
    const n1 = (await fakeState()).anthropic.length;
    await queue([say('네')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '방금 제안 확인', threadId: r.threadId });
    assert.match(JSON.stringify((await fakeState()).anthropic.slice(n1)[0].body.messages), /서버 확인: 비슷한 열린 업무 1건/, '다음 답 기록');
  });

  test('없으면 "없음" · 완료된 업무는 비슷해도 셈하지 않음', async () => {
    await ctx.owner.ok('PATCH', `/api/tasks/${old}`, { status: 'done' });
    const n0 = (await fakeState()).anthropic.length;
    await queue([toolUse('b', 'propose_create_task', { title: '[시험] 시험용 견적서 정리' }), say('제안을 올렸습니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '[시험] 시험용 견적서 정리 업무 만들어줘' });
    assert.match(JSON.stringify((await fakeState()).anthropic.slice(n0)[1].body.messages), /서버 확인: 비슷한 제목의 열린 업무 없음/);
    assert.equal(r.proposals[0].preview?.warnings, undefined, '경고 없음');
    const n1 = (await fakeState()).anthropic.length;
    await queue([say('네')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '아까 제안 어떻게 됐어?', threadId: r.threadId });
    assert.match(JSON.stringify((await fakeState()).anthropic.slice(n1)[0].body.messages), /서버 확인: 비슷한 열린 업무 없음/);
  });
});
