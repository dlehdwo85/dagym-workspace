// 362차(노트북 기록 2e4ddbd7): ① #980 답하지 않은 승인 대기 신청은 첫 알림 24시간 뒤 슈퍼관리자에게 한 번 더(알림·메일, 신청마다 한 번 · 거절 회사는 그대로)
// ② 대표 개인 AI 한도(월·하루)에 마케팅 자동 제작·사진 읽기 같은 자동 작업은 넣지 않음(마케팅 AI 비서·직접 쓴 것만)
// ③ 사용량 화면(내부): 이번 달 '마케팅 자동 원고' 호출을 글별로 — 글 수·글당 호출·시험/시안 세트/지운 글·다른 날 다시 만든 글·많이 부른 글
// 메일은 가짜 발송 서버(구조 시험 — 실제 발송은 운영에서)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const RESEND_PORT = 3362;
let srv, sql, ctx, mailSrv;
const mails = [];
const agree = { terms: true, age14: true, privacy: true };
const mailTo = (re) => mails.filter((m) => re.test(m.subject));
const signup = (c, email, company) => c.ok('POST', '/api/auth/signup', { email, name: '신청자', password: 'signup-pass-1234', mode: 'team', company, size: '2-10', industry: '제조', agree, contact: '010 1234 5678' });
const tenantOf = async (email) => (await sql`select tenant from users where email = ${email}`)[0].tenant;

before(async () => {
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { mails.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `re_${mails.length}` })); }); }).listen(RESEND_PORT);
  await resetDb();
  srv = await startServer({ SIGNUP_APPROVAL: '1', PUBLIC_SIGNUP: '1', SIGNUP_IP_PER_DAY: '50', SIGNUP_IP_PER_HOUR: '50', RESEND_API_KEY: 're_test_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${RESEND_PORT}` });
  sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); mailSrv?.close(); await sql?.end(); });

describe('362차', () => {
  test('#980 첫 알림 24시간 지난 승인 대기 → 한 번 더(알림·메일) · 24시간 안 된 신청·거절한 회사는 안 보냄 · 두 번은 안 감', async () => {
    await signup(new Client('r1'), 'r1@remind.test', '늦은상사');
    await signup(new Client('r2'), 'r2@remind.test', '새상사');
    await signup(new Client('r3'), 'r3@remind.test', '거절상사');
    const [t1, t2, t3] = [await tenantOf('r1@remind.test'), await tenantOf('r2@remind.test'), await tenantOf('r3@remind.test')];
    await ctx.owner.ok('POST', `/api/platform/signups/${t3}/reject`, { reason: '시험 신청' });
    await sql`update tenants set signup_notified_at = now() - interval '25 hours' where id = any(${[t1, t3]}::text[])`;
    await sql`update tenants set signup_notified_at = now() - interval '2 hours' where id = ${t2}`;
    const before = mails.length;
    await tick();
    const n = await sql`select title, link from notifications where type = 'signup_request' and dedupe_key = ${`signupremind:${t1}`}`;
    assert.equal(n.length, 1, '24시간 지난 신청은 한 번 더');
    assert.match(n[0].title, /^답 기다리는 체험 신청\(2[45]시간 지남\): 늦은상사/); assert.equal(n[0].link, '/platform?tab=company#signup-requests');
    const m = mailTo(/\[24시간 지남\] 체험 신청 답 기다림 — 늦은상사/);
    assert.equal(m.length, 1); assert.match(m[0].text, /아직 \[승인\]·\[거절\] 전/);
    assert.equal(mails.slice(before).filter((x) => /새상사|거절상사/.test(x.subject)).length, 0, '24시간 안 된 신청·거절한 회사는 안 보냄');
    assert.equal((await sql`select count(*)::int n from notifications where dedupe_key = any(${[`signupremind:${t2}`, `signupremind:${t3}`]}::text[])`)[0].n, 0);
    assert.ok((await sql`select status from tenants where id = ${t3}`)[0], '거절한 회사는 지우지 않음');
    await tick();
    assert.equal((await sql`select count(*)::int n from notifications where dedupe_key = ${`signupremind:${t1}`}`)[0].n, 1, '두 번은 안 감');
    assert.equal(mailTo(/\[24시간 지남\]/).length, 1);
  });

  test('개인 AI 한도에는 마케팅 자동 제작이 들어가지 않음(마케팅 AI 비서·직접 쓴 것만)', async () => {
    const pick = async () => (await ctx.owner.ok('GET', '/api/ai/budgets')).people.find((p) => p.id === ctx.ownerId);
    const base = await pick();
    const ins = (purpose, usd) => sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose) values ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'test', 0, 0, ${usd}, ${purpose}) returning id`;
    const auto = [await ins('marketing_produce', 10), await ins('marketing_vision', 1), await ins('marketing_photo_audit', 1)];
    let me = await pick();
    assert.equal(me.usedKrw, base.usedKrw, '마케팅 자동 작업은 개인 사용액에 안 들어감');
    assert.equal(me.todayKrw, base.todayKrw);
    const chat = [await ins('marketing_assistant', 1), await ins('assistant', 1)];
    me = await pick();
    assert.ok(me.usedKrw > base.usedKrw + 1000, `마케팅 AI 비서·AI 비서는 그대로 셈 (${base.usedKrw} → ${me.usedKrw})`);
    for (const r of [...auto, ...chat]) await sql`delete from ai_usage where id = ${r[0].id}`;
  });

  test('사용량(내부): 이번 달 마케팅 자동 원고를 글별로 — 글 수·글당 호출·호출 수 구간·시험/시안 세트/지운 글·다른 날 다시 만든 글·많이 부른 글', async () => {
    const mk = async (title, o = {}) => (await sql`insert into mkt_contents (tenant, title, channel, status, created_by, is_test, quality, deleted_at)
      values ('default', ${title}, 'instagram', ${o.status ?? 'draft'}, ${ctx.ownerId}, ${!!o.test}, ${o.sample ? sql.json({ sample: 'true' }) : null}, ${o.deleted ? sql`now()` : null}) returning id`)[0].id;
    const a = await mk('362 보통 글'), b = await mk('362 검사에 걸린 글', { status: 'published' }), c = await mk('362 시안 세트', { sample: true }), d = await mk('362 지운 시험 글', { test: true, deleted: true });
    const call = (cid, ago = '0 hours') => sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose, mkt_content_id, created_at)
      values ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'test', 0, 0, 0.1, 'marketing_produce', ${cid}, now() - ${ago}::interval)`;
    const sameMonth = new Date().getUTCDate() > 2 ? '1 day' : '0 hours'; // 이달 1·2일에는 '하루 전'이 지난달이 될 수 있음
    for (const x of [a, a]) await call(x); // 쓰기 + 다듬기
    for (let k = 0; k < 4; k++) await call(b); // 검사에 걸려 한 번 더
    for (let k = 0; k < 2; k++) await call(b, sameMonth); // 다른 날 다시 만들기
    for (const x of [c, c, d, d]) await call(x);
    await call(null); // 글 없는 호출(키트 초안 등)
    const u = await ctx.owner.ok('GET', '/api/usage');
    const p = u.ai.mktProduce;
    assert.ok(p, JSON.stringify(Object.keys(u.ai)));
    assert.deepEqual([p.calls, p.contents, p.noContent], [13, 4, 1]);
    assert.equal(p.perContent, 3);
    assert.deepEqual(p.byCalls, { upTo2: 3, three4: 0, fivePlus: 1 });
    assert.deepEqual([p.kinds.test, p.kinds.sample, p.kinds.deletedOrCanceled, p.kinds.published], [1, 1, 1, 1]);
    if (sameMonth !== '0 hours') assert.equal(p.kinds.remadeOnOtherDay, 1, '다른 날 다시 만든 글');
    assert.deepEqual(p.top[0] && [p.top[0].title, p.top[0].calls], ['362 검사에 걸린 글', 6]);
  });
});
