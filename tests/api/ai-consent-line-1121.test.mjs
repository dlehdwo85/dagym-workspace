// 대표 11/20 결정(#1086) 1단계: AI 동의를 '이용약관 동의처럼' 가입·초대 수락·요금제 동의 목록의 한 줄로.
// 가입(이메일) 목록의 [선택] AI 줄을 체크하면 AI 동의(지금 판, kind ai_share)로 저장 + 감사 기록(via signup) → 로그인 뒤 창이 다시 안 뜸 · 체크 안 하면 줄 없음 = '아직 안 정함'(거절 아님)
// · 초대 수락(ai: true)도 같음(via invite) · 요금제 동의 목록은 기존 PUT 에 via=billing(감사 기록) · 가입·초대 정보 응답에 aiStt(받는 곳 이름용)
// · 이미 정한 사람에게는 다시 묻지 않음(기존 동의 그대로) — 시험 서버 기본값(AI_CONSENT_DEFAULT)을 끄고 실제 상태로 봄. 시험 서버는 받아쓰기 키(가짜)가 있어 판 번호가 '2026-11+stt'
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, V;
before(async () => {
  await resetDb();
  srv = await startServer({ AI_CONSENT_DEFAULT: '', PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_APPROVAL: '0', SIGNUP_IP_PER_DAY: '50' });
  sql = testDb(); ctx = await bootstrap();
  V = (await ctx.owner.ok('GET', '/api/account/ai-consent')).version; // 지금 판(받아쓰기 키가 있으면 +stt)
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const rows = async (email) => (await sql`select c.agreed, c.version from consents c join users u on u.id = c.user_id where lower(u.email) = ${email} and c.kind = 'ai_share'`).map((r) => [r.agreed, r.version]);
const via = async (email) => (await sql`select a.detail->>'via' as via from audit_logs a join users u on u.id::text = a.target_id where lower(u.email) = ${email} and a.action = 'consent.ai_agree'`).map((r) => r.via);
const signup = (c, email, ai) => c.req('POST', '/api/auth/signup', { email, name: '가입시험', password: 'signup-pass-1234', mode: 'team', company: `${email.split('@')[0]}상사`, size: '2-10', industry: '제조',
  agree: { terms: true, age14: true, privacy: true, ai, marketing: false } });

describe('#1086 AI 동의 한 줄', () => {
  test('가입 정보·초대 정보에 aiStt(받는 곳 이름용 — 동의 판과 같은 값)', async () => {
    const stt = V.endsWith('+stt');
    assert.equal((await new Client().ok('GET', '/api/auth/signup')).aiStt, stt);
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'line-a@dagym.test', name: '줄시험', role: 'staff' });
    assert.equal((await new Client().ok('GET', `/api/invitations/${inv.path.split('/').pop()}`)).aiStt, stt);
  });

  test('가입 목록에서 체크 = AI 동의(지금 판) + 감사 기록 via signup · 체크 안 함 = 줄 없음(아직 안 정함)', async () => {
    assert.equal((await signup(new Client('s1'), 'ai-yes@line.test', true)).status, 200);
    assert.deepEqual(await rows('ai-yes@line.test'), [[true, V]]);
    assert.deepEqual(await via('ai-yes@line.test'), ['signup']);
    assert.equal((await signup(new Client('s2'), 'ai-no@line.test', false)).status, 200);
    assert.deepEqual(await rows('ai-no@line.test'), [], '거절로 저장하지 않음');
    const [t] = await sql`select agreed from consents c join users u on u.id = c.user_id where lower(u.email) = 'ai-no@line.test' and c.kind = 'ai'`;
    assert.equal(t?.agreed, false, '예전 약관 기록(kind ai)은 그대로 남음');
  });

  test('초대 수락: ai=true → 동의 저장(via invite)·상태 agreed · 체크 안 함 → none(로그인 뒤 창이 물음)', async () => {
    const a = await ctx.owner.ok('POST', '/api/admin/users', { email: 'inv-yes@dagym.test', name: '수락동의', role: 'staff' });
    const ca = new Client('ia'); await ca.ok('POST', `/api/invitations/${a.path.split('/').pop()}/accept`, { password: 'inv-pass-1234', ai: true });
    assert.deepEqual(await rows('inv-yes@dagym.test'), [[true, V]]); assert.deepEqual(await via('inv-yes@dagym.test'), ['invite']);
    assert.equal((await ca.ok('GET', '/api/account/ai-consent')).state, 'agreed', '로그인 뒤 창이 다시 안 뜸');
    const b = await ctx.owner.ok('POST', '/api/admin/users', { email: 'inv-no@dagym.test', name: '수락보류', role: 'staff' });
    const cb = new Client('ib'); await cb.ok('POST', `/api/invitations/${b.path.split('/').pop()}/accept`, { password: 'inv-pass-1234' });
    assert.deepEqual(await rows('inv-no@dagym.test'), []); assert.equal((await cb.ok('GET', '/api/account/ai-consent')).state, 'none');
    assert.equal((await new Client('ic').req('POST', `/api/invitations/${b.path.split('/').pop()}/accept`, { password: 'inv-pass-1234', ai: 'yes' })).status, 400, 'ai 는 참·거짓만');
  });

  test('요금제 동의 목록: PUT via=billing → 동의·감사 기록 via billing · 모르는 via 는 400 · 이미 동의한 사람의 기록은 그대로(다시 안 물음)', async () => {
    const r = await ctx.owner.ok('PUT', '/api/account/ai-consent', { agreed: true, via: 'billing' });
    assert.equal(r.state, 'agreed'); assert.deepEqual(await via('ceo@dagym.test'), ['billing']);
    assert.equal((await ctx.owner.req('PUT', '/api/account/ai-consent', { agreed: true, via: 'popup' })).status, 400);
    const before = await rows('ai-yes@line.test');
    assert.deepEqual(before, [[true, V]], '가입 때 동의한 사람은 같은 판 그대로');
  });
});
