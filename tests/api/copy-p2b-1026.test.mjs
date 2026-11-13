// 410차 범용화 P2 문구 ②(docs/generalization-audit.md G-26 — AI 도구 설명의 다짐·하이링크 예시):
// AI 비서에게 보내는 도구 목록·설명 — 다짐(기본 회사)은 지금 글 그대로, 다른 회사에는 공통 예시 + 매출 도구(메뉴가 없음) 없음. (가짜 Anthropic 서버가 받은 요청으로 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, T;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@other-tools.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-tools.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '모퉁이카페', industry: '외식·카페', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  T = { c };
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

// 매출·견적서·사람 낱말이 든 질문 → 매출 요약·양식·사람 목록 도구가 함께 뽑힌다
const ASK = '이번 달 매출 실적 보고 김과장에게 견적서 양식으로 업무 만들어줘';
const sent = async (client) => {
  const n0 = (await fakeState()).anthropic.length;
  await queue([say('확인했습니다.')]);
  await client.ok('POST', '/api/ai/chat', { text: ASK });
  const body = (await fakeState()).anthropic.slice(n0)[0].body;
  return { names: body.tools.map((t) => t.name), text: JSON.stringify(body.tools) };
};

test('G-26 다짐: AI 도구 목록·설명 그대로(매출 요약 도구 · "조직(현장·부서)" 글)', async () => {
  const d = await sent(ctx.owner);
  assert.ok(d.names.includes('revenue_summary'), d.names.join(','));
  assert.ok(d.text.includes('조직(현장·부서)'), '사람 목록 도구 설명 그대로');
});

test('G-26 다른 회사: 매출 도구 없음 · 설명에 다짐·하이링크 예시("다짐 기본 견적서"·"플랫폼 시연"·"현장") 없음', async () => {
  const o = await sent(T.c);
  assert.ok(!o.names.includes('revenue_summary'), o.names.join(','));
  assert.ok(o.names.includes('list_people'));
  assert.ok(o.text.includes('조직(지점·부서)'));
  assert.ok(!/다짐|플랫폼 시연|조직\(현장/.test(o.text), (o.text.match(/.{20}(다짐|플랫폼 시연|조직\(현장).{20}/) ?? [''])[0]);
});
