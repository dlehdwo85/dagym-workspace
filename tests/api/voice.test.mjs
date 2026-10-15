// V24 음성 등록 인식률: 회사 단어장 보정(띄어쓰기·비슷한 이름·후보 고르기·흔한 말 그대로·볼 수 있는 이름만), 애매하면 AI 1번, 받아들임/되돌림 학습 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, Client } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
async function addUser(key, name, unit) {
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${key}@dagym.test`, name, role: 'staff', orgUnitIds: [unit] });
  const c = new Client(key);
  await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${key}-pass-1234` });
}

before(async () => { await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.managerA.client.ok('POST', '/api/projects', { name: '노태2단지', orgUnitId: ctx.siteA });
  await addUser('kms', '김민수', ctx.siteA); await addUser('kmj', '김민주', ctx.siteA);
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('V24 음성 보정', () => {
  test('띄어쓰기만 다른 현장 이름·비슷한 이름(조사 유지)·흔한 말은 그대로', async () => {
    const r = await ctx.owner.ok('POST', '/api/voice/correct', { text: '내일 3시 노태 2단지 골프 티업기 점검 회의 최매니져한테' });
    assert.equal(r.text, '내일 3시 노태2단지 골프 티업기 점검 회의 최매니저한테');
    assert.deepEqual(r.fixes.map((f) => [f.from, f.to, f.how]), [['노태 2단지', '노태2단지', 'spacing'], ['최매니져한테', '최매니저한테', 'similar']]);
  });

  test('후보 여러 개면 단어장 이름이 들어 있는 후보를 고름', async () => {
    const r = await ctx.owner.ok('POST', '/api/voice/correct', { text: '박지원 견적서 보내기', alternatives: ['박직원 견적서 보내기', '박지원 견적서 보내기'] });
    assert.equal(r.text, '박직원 견적서 보내기');
  });

  test('볼 수 없는 현장의 프로젝트 이름으로는 고치지 않음', async () => {
    const r = await ctx.staffB.client.ok('POST', '/api/voice/correct', { text: '노태 2단지 점검' });
    assert.equal(r.text, '노태 2단지 점검'); assert.equal(r.fixes.length, 0);
  });

  test('애매하면(김민수·김민주) AI 1번 — 보기 안의 말만 받아들이고 사용량 기록', async () => {
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ picks: ['김민주'] }) }], stop_reason: 'end_turn' }] });
    const r = await ctx.owner.ok('POST', '/api/voice/correct', { text: '김민추 내일 보고' });
    assert.equal(r.text, '김민주 내일 보고'); assert.equal(r.fixes[0].how, 'ai');
    assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'voice'`)[0].n, 1);
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ picks: ['지어낸이름'] }) }], stop_reason: 'end_turn' }] });
    const r2 = await ctx.owner.ok('POST', '/api/voice/correct', { text: '김민추 내일 보고' });
    assert.equal(r2.text, '김민추 내일 보고', '보기에 없는 답은 버림');
  });

  test('학습: 받아들인 짝은 다음부터 바로(이미 고친 말은 그대로), 되돌린 짝은 다시 안 씀, 회사별', async () => {
    await ctx.owner.ok('POST', '/api/voice/learn', { from: '노태', to: '노태2단지', accepted: true });
    const r = await ctx.owner.ok('POST', '/api/voice/correct', { text: '노태 골프 점검 그리고 노태2단지 청소' });
    assert.equal(r.text, '노태2단지 골프 점검 그리고 노태2단지 청소');
    assert.equal(r.fixes[0].how, 'learned');
    await ctx.owner.ok('POST', '/api/voice/learn', { from: '최매니져', to: '최매니저', accepted: false });
    const r2 = await ctx.owner.ok('POST', '/api/voice/correct', { text: '최매니져 보고' });
    assert.equal(r2.text, '최매니져 보고', '되돌린 보정은 다시 안 함');
    assert.equal((await sql`select count(*)::int n from voice_lexicon where tenant <> 'default'`)[0].n, 0);
    assert.equal((await new Client('anon').req('POST', '/api/voice/correct', { text: 'x' })).status, 401);
  });
});
