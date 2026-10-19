// 로컬 10/19(대표): 회사 정보 'AI 로 정리' — 글·인터뷰 답 → 칸별 초안(저장 안 함), [다시 쓰기]는 그 칸만, 관리자만, AI 사용량 기록,
// 주의할 점(ai_cautions) 저장 → AI 비서·메일 시안 등이 쓰는 [우리 회사] 단락에 함께(가짜 AI 서버 = 구조 시험)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const sysOf = (req) => (typeof req.body.system === 'string' ? req.body.system : req.body.system.map((b) => b.text ?? '').join('\n'));
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('초안·다시 쓰기·권한·저장·[우리 회사] 단락', async () => {
  const qs = await ctx.owner.ok('GET', '/api/org/ai-profile/draft');
  assert.equal(qs.questions.length, 5);
  assert.equal((await ctx.owner.req('POST', '/api/org/ai-profile/draft', {})).status, 400, '입력 없으면 안내');
  assert.equal((await ctx.staffA.client.req('POST', '/api/org/ai-profile/draft', { text: '헬스장' })).status, 404, '직원은 못 함(메뉴 권한 없음 = 없는 화면)');
  assert.equal((await ctx.owner.req('POST', '/api/org/ai-profile/draft', { url: 'http://127.0.0.1/x' })).status, 400, '내부 주소·http 막음');
  await queue([say(JSON.stringify({ business: '강남 PT 센터 운영', customers: '30대 직장인', tone: '친근하고 정중하게', cautions: '효과 단정 금지' }))]);
  const n0 = (await fakeState()).anthropic.length;
  const r = await ctx.owner.ok('POST', '/api/org/ai-profile/draft', { text: '강남에서 PT 센터를 합니다', answers: ['PT', '직장인', '꼼꼼함', '친근', '과장 금지'] });
  assert.deepEqual(r.draft, { business: '강남 PT 센터 운영', customers: '30대 직장인', tone: '친근하고 정중하게', cautions: '효과 단정 금지' });
  assert.equal(r.current.business, null, '원래 값(비교용)');
  const req = (await fakeState()).anthropic.slice(n0)[0];
  assert.match(JSON.stringify(req.body.messages), /누가 사나요\?\(주요 고객\) 직장인/, '인터뷰 답이 들어감');
  const [{ b }] = await sql`select ai_business as b from tenants where id = 'default'`;
  assert.equal(b, null, '초안은 저장 안 함');
  assert.ok((await sql`select 1 from ai_usage where purpose = 'company_profile'`).length >= 1, 'AI 사용량 기록');
  await queue([say(JSON.stringify({ business: '', customers: '', tone: '정중하게', cautions: '' }))]);
  const one = await ctx.owner.ok('POST', '/api/org/ai-profile/draft', { text: '강남에서 PT 센터를 합니다', field: 'tone' });
  assert.deepEqual(Object.keys(one.draft), ['tone'], '다시 쓰기 = 그 칸만');
  // [적용] 뒤 사용자가 [저장] → 주의할 점까지 저장, AI 비서 프롬프트 [우리 회사] 단락에 함께
  await ctx.owner.ok('PUT', '/api/org/ai-profile', { business: '강남 PT 센터 운영', tone: '정중하게', cautions: '효과 단정 금지' });
  assert.equal((await ctx.owner.ok('GET', '/api/org/ai-profile')).cautions, '효과 단정 금지');
  await queue([say('네')]);
  const n1 = (await fakeState()).anthropic.length;
  await ctx.owner.ok('POST', '/api/ai/chat', { text: '안녕' });
  const sys = sysOf((await fakeState()).anthropic.slice(n1)[0]);
  assert.match(sys, /사업 소개·방향: 강남 PT 센터 운영/); assert.match(sys, /주의할 점\(지킬 것\): 효과 단정 금지/);
});
