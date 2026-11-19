// AI 동의(대표 11/19 결정 — 애플 11/15 반려 5.1.2: 바깥 AI 로 보내기 전에 무엇을·어디로 보내는지 알리고 허락받기)
// ① 아직 정하지 않은 사람·거부한 사람이 AI 를 누르면 403 ai_consent, 바깥 호출 0 ② 동의하면 됨(기록 = consents ai_share + 감사 기록), 끄면 다시 막힘
// ③ 사람마다 따로 ④ 안내 글 판이 바뀌면 다시 물음(거부는 그대로) ⑤ 자료실 올리기: 동의 전에는 AI 없이 규칙으로 정리
// ⑥ 회사 스위치(회사 자료 자동 AI 처리): 기본 회사 켜짐·그 밖은 꺼짐에서 시작, 편집 권한만 바꿈, 꺼져 있으면 자동 문의 요약이 AI 를 부르지 않음
// ⑦ 심사용 계정은 다시 만들 때마다 '아직 정하지 않음'. 가짜 AI 서버 — 실제 Anthropic 연동 확인이 아님
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE, FAKE, Client } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } });
/** 바깥 AI 로 나간 요청 수(대화·사진 설명·주제 분류 모두) */
const sent = async () => { const st = await (await fetch(FAKE + '/__state')).json(); return st.anthropic.length + st.vision.length + st.classified.length + st.audits.length; };
const consent = (c) => c.ok('GET', '/api/account/ai-consent');
const chat = (c, text = '오늘 할 일 알려줘') => c.req('POST', '/api/ai/chat', { text });

before(async () => {
  await resetDb(); fake = await startFakeGoogle();
  // 시험 서버 기본(아직 정하지 않은 사람 = 동의함)을 끄고, 받아쓰기 키도 비워 운영과 같게(로컬 11/19: 운영에 OPENAI_API_KEY 없음 → 받는 곳은 Anthropic 한 곳)
  srv = await startServer({ AI_CONSENT_DEFAULT: '', OPENAI_API_KEY: '', MAIL_DEV: '1' });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('AI 동의', () => {
  test('아직 정하지 않은 사람: 상태 none · AI 를 누르면 403 ai_consent · 바깥으로 아무것도 안 나감', async () => {
    const st = await consent(ctx.owner);
    assert.equal(st.state, 'none'); assert.equal(st.version, '2026-11'); assert.equal(st.stt, false, '받아쓰기 키 없음 → 받는 곳은 Anthropic 한 곳');
    const before0 = await sent();
    const r = await chat(ctx.owner);
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'ai_consent'); assert.match(r.body.error.message, /동의한 뒤에/);
    assert.equal(await sent(), before0, '바깥 AI 호출 0');
  });

  test('동의하면 AI 가 답하고 기록이 남는다 · 끄면 그때부터 다시 막힘', async () => {
    const a = await ctx.owner.ok('PUT', '/api/account/ai-consent', { agreed: true });
    assert.equal(a.state, 'agreed'); assert.ok(a.at);
    const [row] = await sql`select kind, version, agreed from consents where user_id = ${ctx.ownerId} and kind = 'ai_share'`;
    assert.deepEqual([row.version, row.agreed], ['2026-11', true]);
    assert.equal((await sql`select count(*)::int n from audit_logs where actor_id = ${ctx.ownerId} and action = 'consent.ai_agree'`)[0].n, 1);
    await ctl({ anthropicReset: true, anthropicQueue: [say('오늘 할 일은 없습니다.')] });
    const before0 = await sent();
    const ok = await chat(ctx.owner);
    assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 200));
    assert.ok(await sent() > before0, '동의한 뒤에는 바깥 AI 로 나감');
    // 끄기
    const off = await ctx.owner.ok('PUT', '/api/account/ai-consent', { agreed: false });
    assert.equal(off.state, 'declined');
    assert.equal((await sql`select count(*)::int n from audit_logs where actor_id = ${ctx.ownerId} and action = 'consent.ai_withdraw'`)[0].n, 1);
    const before1 = await sent();
    const no = await chat(ctx.owner);
    assert.equal(no.status, 403); assert.equal(no.body.error.code, 'ai_consent');
    assert.equal(await sent(), before1, '끈 뒤에는 바깥 호출 0');
  });

  test('사람마다 따로: 직원이 동의해도 대표(거부)는 막힘', async () => {
    await ctx.staffA.client.ok('PUT', '/api/account/ai-consent', { agreed: true });
    await ctl({ anthropicReset: true, anthropicQueue: [say('네.')] });
    assert.equal((await chat(ctx.staffA.client)).status, 200);
    assert.equal((await chat(ctx.owner)).status, 403);
    assert.equal((await consent(ctx.staffB.client)).state, 'none', '다른 직원은 아직 정하지 않음');
  });

  test('안내 글 판이 바뀌면(받는 곳이 늘면) 예전 동의는 다시 물음 · 거부는 그대로 거부', async () => {
    await sql`update consents set version = '2026-01' where user_id = ${ctx.staffA.id} and kind = 'ai_share'`;
    assert.equal((await consent(ctx.staffA.client)).state, 'none', '예전 판 동의 = 지금 글에 대한 동의가 아님');
    assert.equal((await chat(ctx.staffA.client)).status, 403);
    await sql`update consents set version = '2026-01' where user_id = ${ctx.ownerId} and kind = 'ai_share'`;
    assert.equal((await consent(ctx.owner)).state, 'declined', '거부한 사람은 판이 바뀌어도 다시 조르지 않음');
    // 지금 판으로 다시 동의 → 됨(예전 판 줄은 그대로 남고 새 줄이 생김)
    await ctx.staffA.client.ok('PUT', '/api/account/ai-consent', { agreed: true });
    assert.equal((await consent(ctx.staffA.client)).state, 'agreed');
    assert.equal((await sql`select count(*)::int n from consents where user_id = ${ctx.staffA.id} and kind = 'ai_share'`)[0].n, 2);
  });

  test('자료실에 올릴 때: 동의 전에는 AI 없이 정리(바깥 호출 0·이유 표시) · 동의하면 AI 로 정리', async () => {
    const up = async (c, name) => {
      const data = Buffer.from('회의 메모: 다음 주 일정 정리');
      const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: 'text/plain', size: data.length, folder: '' });
      await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
      return c.ok('POST', `/api/library/${init.id}/complete`, {});
    };
    const before0 = await sent();
    const a = await up(ctx.owner, '메모-동의전.txt'); // 대표 = 거부 상태
    assert.equal(a.organized.by, 'rule'); assert.match(String(a.organized.error ?? ''), /동의한 뒤에/, '정리하지 못한 이유가 화면에 보임');
    assert.equal(await sent(), before0, '동의 전 올리기 = 바깥 호출 0');
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ folder: '운영/메모', tags: ['메모'], title: '', summary: '회의 메모', confidence: 0.9, security: 'internal' }) }], stop_reason: 'end_turn' }] });
    const b = await up(ctx.staffA.client, '메모-동의후.txt'); // 직원 = 동의
    assert.equal(b.organized.by, 'ai');
  });

  test('공통 들머리를 거치지 않는 AI 길도 바깥 호출 바로 앞에서 막힌다(안전망) — 마케팅 브랜드 자료 초안', async () => {
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
    await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
    const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
    await sql`update tenants set ai_business = '아파트 단지 안 피트니스 시설을 운영합니다', ai_customers = '입주민' where id = 'default'`;
    const n0 = await sent();
    const r = await ctx.owner.req('POST', `/api/marketing/auto/brands/${brand}/kit-draft`, {}); // 대표 = 거부 상태. 이 길은 assertAiRequest 가 아니라 마케팅 한도 확인만 거친다
    assert.equal(r.status, 403, JSON.stringify(r.body).slice(0, 200)); assert.equal(r.body.error.code, 'ai_consent');
    assert.equal(await sent(), n0, '바깥 호출 0');
  });

  test('회사 스위치: 기본 회사는 켜짐(옮김)·그 밖은 꺼짐에서 시작 · 편집 권한만 바꿈 · 꺼져 있으면 자동 문의 요약이 AI 를 부르지 않음', async () => {
    assert.equal((await ctx.owner.ok('GET', '/api/org/ai-auto')).on, true, '기본 회사 = 지금 쓰는 그대로 켜짐');
    assert.equal((await sql`select ai_auto from tenants where id = 'demo'`)[0].ai_auto, false, '다른 회사는 꺼짐에서 시작');
    assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/org/ai-auto', { on: false })).status), '직원은 못 바꿈');
    // 웹 문의가 들어오면 응답 뒤 한 줄 요약(자동) — 스위치가 꺼져 있으면 AI 를 부르지 않는다
    const tok = (await ctx.owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'hilink' })).token;
    const send = (id) => fetch(`${BASE}/api/integrations/inquiries`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ lead_id: id, inquiry_type: 'HILINK 플랫폼', organization: '시험아파트', region: '충북', name: '홍길동', phone: '010-0000-0000', email: 'lead@example.com', message: '데모를 보고 싶습니다.' }) });
    const settle = async (n0) => { for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 150)); if (await sent() > n0) break; } return sent(); };
    assert.equal((await ctx.owner.ok('PUT', '/api/org/ai-auto', { on: false })).on, false);
    assert.equal((await sql`select count(*)::int n from audit_logs where action = 'tenant.ai_auto_off'`)[0].n, 1);
    const n0 = await sent();
    assert.equal((await send('HL-AUTO-0001')).status, 200);
    assert.equal(await settle(n0), n0, '꺼짐: 자동 요약이 바깥 AI 를 부르지 않음');
    await ctx.owner.ok('PUT', '/api/org/ai-auto', { on: true });
    await ctl({ anthropicReset: true, anthropicQueue: [say('데모 요청 문의')] });
    const n1 = await sent();
    assert.equal((await send('HL-AUTO-0002')).status, 200);
    assert.ok(await settle(n1) > n1, '켜짐: 자동 요약이 돎(사람이 누른 것이 아니므로 개인 동의와 상관없음)');
  });

  test('심사용 체험 계정: 버튼을 다시 누르면 동의 기록을 지워 심사 담당자가 동의 창을 처음부터 본다', async () => {
    const r = await ctx.owner.ok('POST', '/api/admin/review-account', { email: 'review@workin.test' });
    const c = new Client('review');
    await c.ok('POST', `/api/invitations/${r.invitePath.split('/').pop()}/accept`, { password: 'review-pass-1234' });
    assert.equal((await consent(c)).state, 'none');
    await c.ok('PUT', '/api/account/ai-consent', { agreed: true });
    assert.equal((await consent(c)).state, 'agreed');
    await ctx.owner.ok('POST', '/api/admin/review-account', { email: 'review@workin.test' });
    assert.equal((await consent(c)).state, 'none', '다시 만들면 아직 정하지 않음');
  });
});
