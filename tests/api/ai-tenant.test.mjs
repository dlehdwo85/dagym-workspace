// 상용화: AI 비서는 회사마다 따로 — 새 회사는 우리(다짐·하이링크) 내용 없이 업종 기준으로 시작, 메일·문자 초안에 쓰는 사람 이름·직책과 회사 소개·말투, 템플릿은 회사 밖으로 안 샘
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, T, defTpl;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  defTpl = (await ctx.owner.ok('POST', '/api/templates', { name: '기본회사 전사 템플릿', payload: { title: '전사', checklist: ['비밀 단계'] } })).id;
  const c = new Client('fit@other.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'fit@other.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '튼튼짐', industry: '운동·피트니스', industries: ['IT·소프트웨어'], agree: { terms: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  await sql`update users set title = '대표이사' where id = ${me.user.id}`;
  T = { c, me };
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('상용화: 회사별 AI 비서', () => {
  test('가입 업종으로 시작: 회사 정보(상호) 1건·업종 시작 템플릿, 우리 회사 템플릿·브랜드는 안 보임', async () => {
    const tpl = (await T.c.ok('GET', '/api/templates')).templates;
    assert.ok(tpl.some((t) => t.name === '신규 회원 상담'), '피트니스 시작 템플릿');
    assert.ok(!JSON.stringify(tpl).includes('기본회사'));
    const [p] = await sql`select key, name, is_default from company_profiles where tenant = ${T.me.user.tenant}`;
    assert.equal(p.name, '튼튼짐'); assert.equal(p.is_default, true);
    assert.deepEqual((await T.c.ok('GET', '/api/org')).brands, [], '다짐·하이링크 브랜드 안 보임');
    assert.ok((await ctx.owner.ok('GET', '/api/org')).brands.length > 0, '기존 회사는 그대로');
    // 기존 회사(전체 보기 권한 대표)에게도 새 회사 템플릿이 안 보임
    assert.ok(!(await ctx.owner.ok('GET', '/api/templates')).templates.some((t) => t.name === '신규 회원 상담'));
  });
  test('다른 회사 템플릿: 고치기·쓰기 404, 새로 만든 템플릿은 자기 회사로', async () => {
    assert.equal((await T.c.patch(`/api/templates/${defTpl}`, { name: '탈취' })).status, 404);
    assert.equal((await T.c.post(`/api/templates/${defTpl}/apply`, {})).status, 404);
    assert.equal((await sql`select name from templates where id = ${defTpl}`)[0].name, '기본회사 전사 템플릿');
    const mine = (await T.c.ok('POST', '/api/templates', { name: '튼튼짐 전사 템플릿', payload: { title: '전사' } })).id;
    assert.equal((await sql`select tenant from templates where id = ${mine}`)[0].tenant, T.me.user.tenant);
    assert.ok(!(await ctx.owner.ok('GET', '/api/templates')).templates.some((t) => t.id === mine));
    assert.equal((await ctx.owner.patch(`/api/templates/${mine}`, { name: 'x' })).status, 404);
  });
  test('회사 정보 화면에서 AI 에게 회사 소개·고객·말투 알려 주기(직원은 못 바꿈)', async () => {
    const g = await T.c.ok('GET', '/api/org/ai-profile');
    assert.equal(g.industry, '운동·피트니스'); assert.deepEqual(g.industries, ['운동·피트니스', 'IT·소프트웨어'], '가입 때 주 업종 + 추가 업종'); assert.ok(g.industryOptions.includes('제조'));
    await T.c.ok('PUT', '/api/org/ai-profile', { business: '판교 PT 전문 센터 2곳 운영, 재등록 상담 중시', customers: '30~40대 직장인', tone: '친근하지만 정중하게' });
    assert.equal((await T.c.req('PUT', '/api/org/ai-profile', { industry: '없는 업종' })).status, 400);
    // 대표 10/20: 업종 여러 개 — industries[] 가 정본, industry 는 첫 값(주 업종), 목록 밖 400
    const m = await T.c.ok('PUT', '/api/org/ai-profile', { industries: ['운동·피트니스', 'IT·소프트웨어'] });
    assert.deepEqual([m.industry, m.industries], ['운동·피트니스', ['운동·피트니스', 'IT·소프트웨어']]);
    assert.equal((await T.c.req('PUT', '/api/org/ai-profile', { industries: ['운동·피트니스', '없는 업종'] })).status, 400);
    const [tr] = await sql`select t.industry, t.industries from tenants t join users u on u.tenant = t.id where u.id = ${T.me.user.id}`;
    assert.deepEqual([tr.industry, tr.industries], ['운동·피트니스', ['운동·피트니스', 'IT·소프트웨어']]);
    assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/org/ai-profile', { business: 'x' })).status));
  });
  test('AI 비서·업무 비서 프롬프트 = 우리 회사(이름·업종·소개·말투) + 쓰는 사람 이름·직책, 다짐·하이링크는 없음', async () => {
    let n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicQueue: [say('네.')] });
    await T.c.ok('POST', '/api/ai/chat', { text: '안녕' });
    const sys = JSON.stringify((await fakeState()).anthropic.slice(n0)[0].body.system);
    for (const w of ['튼튼짐', '운동·피트니스', '판교 PT 전문 센터', '친근하지만 정중하게', '박대표 대표이사']) assert.ok(sys.includes(w), w);
    assert.ok(!/다짐|하이링크/.test(sys), '우리 회사 이름 없음');
    const task = (await T.c.ok('POST', '/api/tasks', { title: '체험 회원 재등록 안내', orgUnitId: T.me.orgUnits[0].id })).id;
    n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicQueue: [say(JSON.stringify({ reply: '초안입니다', subject: '재등록 안내', body: '안녕하세요.', attach: [] }))] });
    await T.c.ok('POST', `/api/tasks/${task}/assist`, { action: 'mail' });
    const req = JSON.stringify((await fakeState()).anthropic.slice(n0)[0].body);
    for (const w of ['[쓰는 사람] 박대표 (대표이사)', '튼튼짐', '재등록 상담 중시']) assert.ok(req.includes(w), w);
    assert.ok(!/다짐|하이링크/.test(req));
  });
});
