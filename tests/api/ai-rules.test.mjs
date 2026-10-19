// 대표 지적(10/19) AI 비서 대화 오류 6건 회귀 시험 — 실제 시스템 프롬프트·도구 목록·의도 힌트 검사(모델 답은 가짜 서버, 판정 규칙만 확인):
// ① "○○한테 ~하라고 해줘" = 업무 배정 힌트(메시지로 라고 하면 아님) ② 할 수 있는 일 목록·'안 된다' 금지 ③ 만들기 전 search_tasks
// ④ 기록의 [실행됨] = 이미 반영 문구 ⑤ 첨부 내용은 읽은 뒤에만·근거 ⑥ 업무 정보는 조회 결과로만 + 실행한 작업 요약용 상태
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const sysOf = (req) => (typeof req.body.system === 'string' ? req.body.system : req.body.system.map((b) => b.text ?? '').join('\n'));

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('AI 비서 대화 규칙(대표 지적 10/19)', () => {
  test('① 업무 배정 의도 힌트 · ②③⑤⑥ 규칙 · 도구 목록', async () => {
    const n0 = (await fakeState()).anthropic.length;
    await queue([say('네')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '김소담부사장한테 다음주 금요일까지 업무보고서 만들라고 해줘' });
    const req = (await fakeState()).anthropic.slice(n0)[0];
    const sys = sysOf(req);
    assert.match(sys, /의도 힌트\(규칙\): "김소담" 에게 일을 시키는 요청 — 업무 배정/, '① 직함 떼고 사람·업무 배정');
    assert.match(sys, /메시지 전달로 해석하지 마세요/);
    assert.match(sys, /propose_update_task\(담당자 변경·마감일·마감 시각/, '② 담당 변경·마감 시각 수정 가능 안내');
    assert.match(sys, /"안 된다·화면에서 직접 하세요"라고 답하지 마세요/);
    assert.match(sys, /새 업무를 제안하기 전에 search_tasks/, '③');
    assert.match(sys, /이 업무에 붙일까요, 새로 만들까요\?/);
    assert.match(sys, /read_library_file 로 읽은 경우에만/, '⑤');
    assert.match(sys, /아직 열어 보지 않았습니다/);
    assert.match(sys, /search_tasks·get_task 결과로만/, '⑥');
    const tools = req.body.tools.map((t) => t.name);
    for (const n of ['search_tasks', 'get_task', 'propose_create_task', 'propose_update_task', 'read_library_file']) assert.ok(tools.includes(n), `도구 ${n}`);
    const up = req.body.tools.find((t) => t.name === 'propose_update_task').input_schema.properties;
    assert.ok(up.assigneeId && up.dueTime && up.dueDate, '담당·마감 시각 바꾸기 도구 있음');
  });

  test('① 메시지로 라고 하면 배정 힌트 없음 · 다른 표현(시켜줘·맡겨줘)', async () => {
    const cases = [['민수에게 메시지로 내일 회의 취소라고 전해줘', false], ['이직원에게 견적서 정리 시켜줘', true], ['최매니저한테 현장 점검 맡겨줘', true], ['이번 주 내 업무 정리해줘', false]];
    for (const [text, hint] of cases) {
      const n0 = (await fakeState()).anthropic.length;
      await queue([say('네')]);
      await ctx.owner.ok('POST', '/api/ai/chat', { text });
      assert.equal(/의도 힌트\(규칙\)/.test(sysOf((await fakeState()).anthropic.slice(n0)[0])), hint, text);
    }
  });

  test('④ 확인을 눌러 반영된 제안은 다음 차례 기록에 [실행됨] + 규칙 문구, 화면 요약용 상태·링크', async () => {
    await queue([toolUse('a', 'propose_create_task', { title: '업무보고서 작성', assigneeId: ctx.staffA.id, dueDate: '2026-10-30' }), say('확인을 누르면 반영됩니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '이직원한테 금요일까지 업무보고서 쓰라고 해줘' });
    await ctx.owner.ok('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true });
    const n0 = (await fakeState()).anthropic.length;
    await queue([say('만들었습니다.')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '방금 거 됐어?', threadId: r.threadId });
    const req = (await fakeState()).anthropic.slice(n0)[0];
    assert.match(JSON.stringify(req.body.messages), /업무보고서 작성[^\]]*\[실행됨\]/);
    assert.match(sysOf(req), /\[실행됨\] = 이미 반영된 것/);
    const th = await ctx.owner.ok('GET', `/api/ai/threads/${r.threadId}`);
    const p = th.messages.flatMap((m) => m.proposals ?? []).find((x) => x.id === r.proposals[0].id);
    assert.equal(p.status, 'done'); assert.ok(p.result?.link, '실행한 작업 [열기] 링크');
  });
});
