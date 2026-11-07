// 381차 #1002(대표 11/07 "AI 비서가 '업무와 관련된 요청만 도와드려요'나 '할 수 없다'고 하는 것을 최소화"): 구조 시험(가짜 Anthropic 서버)
// ① 업무 밖 거름은 확실한 잡담만 — 회사 일 낱말이 있으면 분류기 없이 통과, 분류기가 '확실하지 않음'이면 통과
// ② 거름에 걸린 질문은 관리 › AI 사용 내역에 쌓이고(이름 없이), 허용 낱말을 더하면 다음부터 통과
// ③ '할 수 없음' 답 전에 모든 도구(빠른 모델이었으면 기본 모델)로 한 번 더 시도 — 이미 모든 도구·기본 모델이면 그대로
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const ctl = (o) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, ...o }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('381차 #1002 업무 밖 거름 줄이기', () => {
  test('회사 일 낱말이 있으면 분류기 없이 통과 · 분류기가 확실하지 않다고 하면 통과 · 확실한 잡담만 막음', async () => {
    const c0 = (await fakeState()).classified.length;
    await ctl({ classifyQueue: [false], anthropicQueue: [say('워크숍 장소 후보를 정리했습니다.')] });
    const a = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '다음 달 회사 워크숍 장소 추천해줘' });
    assert.notEqual(a.blocked, true, '회사 일 낱말 → 통과');
    assert.equal((await fakeState()).classified.length, c0, '분류기를 부르지 않음');
    await ctl({ classifyQueue: [{ work: false, sure: false }], anthropicQueue: [say('네, 정리했습니다.')] });
    const b = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '요즘 사람들이 많이 쓰는 줄임말 정리해줘' });
    assert.notEqual(b.blocked, true, '애매하면 통과');
    assert.equal(b.reply, '네, 정리했습니다.');
    await ctl({ classifyQueue: [false] });
    const c = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '이번 주 로또 번호 다섯 개 뽑아줘' });
    assert.equal(c.blocked, true); assert.match(c.reply, /업무와 관련된 요청만/);
  });

  test('거름에 걸린 질문은 관리 › AI 사용 내역에(이름 없이) · 허용 낱말을 더하면 다음부터 분류기 없이 통과', async () => {
    const logs = await ctx.owner.ok('GET', '/api/ai/logs');
    assert.equal(logs.topicBlocked.count, 1, JSON.stringify(logs.topicBlocked));
    assert.equal(logs.topicBlocked.items[0].text, '이번 주 로또 번호 다섯 개 뽑아줘');
    assert.ok(!('user_name' in logs.topicBlocked.items[0]) && !('user_id' in logs.topicBlocked.items[0]), '이름 없이');
    assert.ok([403, 404].includes((await ctx.staffA.client.get('/api/ai/logs')).status), '직원은 못 봄');
    await ctx.owner.ok('PUT', '/api/ai/settings', { topicAllow: ['로또', ' 식단 '] });
    assert.deepEqual((await ctx.owner.ok('GET', '/api/ai/logs')).settings.topic_allow, ['로또', '식단']);
    const c0 = (await fakeState()).classified.length;
    await ctl({ classifyQueue: [false], anthropicQueue: [say('회사 행사 경품용으로 정리했습니다.')] });
    const r = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '이번 주 로또 번호 다섯 개 뽑아줘 (경품 이벤트)' });
    assert.notEqual(r.blocked, true, '허용 낱말 → 통과');
    assert.equal((await fakeState()).classified.length, c0, '분류기를 부르지 않음');
  });
});

describe("381차 #1002 '할 수 없음' 전에 한 번 더", () => {
  test("빠른 모델·자주 쓰는 도구로 '할 수 없습니다' → 모든 도구·기본 모델로 다시 · 답은 두 번째", async () => {
    await ctl({ anthropicQueue: [say('그 기능은 없어서 할 수 없습니다. 화면에서 직접 확인해 주세요.'), say('이번 주 매출은 1,200만 원입니다.')] });
    const n0 = (await fakeState()).anthropic.length;
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '이번 주 회의 일정 알려줘' });
    assert.equal(r.reply, '이번 주 매출은 1,200만 원입니다.');
    const sent = (await fakeState()).anthropic.slice(n0).filter((x) => !String(x.body.system).startsWith('WORKIN_TOPIC_CLASSIFIER'));
    assert.equal(sent.length, 2, '한 번 더');
    const names = (x) => x.body.tools.map((t) => t.name);
    assert.ok(!names(sent[0]).includes('revenue_summary') && names(sent[1]).includes('revenue_summary'), '두 번째는 모든 도구');
    assert.notEqual(sent[0].body.model, sent[1].body.model, '빠른 모델 → 기본 모델');
    assert.match(JSON.stringify(sent[1].body.messages), /모든 도구를 붙였습니다/);
    assert.ok(r.tools.includes('more_tools'), '도구 단계로 기록');
  });

  test('이미 모든 도구(more_tools)·기본 모델에서 할 수 없다고 하면 그대로 답(무한 반복 없음)', async () => {
    await ctl({ anthropicQueue: [toolUse('m', 'more_tools', { reason: '필요' }), say('이 일은 외부 은행 계좌 이체라 워크인에서 할 수 없습니다. 은행 앱에서 진행해 주세요.')] });
    const n0 = (await fakeState()).anthropic.length;
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '거래처 미수금 300만 원을 은행에서 바로 이체해줘' });
    assert.match(r.reply, /은행 앱에서 진행/);
    assert.equal((await fakeState()).anthropic.slice(n0).filter((x) => !String(x.body.system).startsWith('WORKIN_TOPIC_CLASSIFIER')).length, 2);
  });
});
