// #1175 고객 요청함(설계 C, DB 291): ① 앱 문의·상담 신청이 자동으로 모임(한 번만) ② 운영자 메모·메일 넣기 ③ 분류·상태·담당·답변 기록 → 기록 남음
// ④ 같은 요청 묶기 → 대표 줄 '요청 회사 n곳' · 묶인 줄은 목록에서 빠짐 ⑤ 운영자만(고객 404)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SPACES_SELF_SERVE: '0' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const agree = { terms: true, age14: true, privacy: true, ai: true };

async function company(email, name) {
  await sql`delete from signup_attempts`;
  const c = new Client(email);
  const r = await c.ok('POST', '/api/auth/signup', { email, password: 'signup-pass-1234', name: '대표', mode: 'team', company: name, industry: 'IT·소프트웨어', agree });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const [t] = await sql`select tenant from users where email = ${email}`; await sql`update tenants set signup_status = 'approved' where id = ${t.tenant}`;
  return { c, tenant: t.tenant };
}

test('자동 모음 · 메모 · 분류·상태·답변 · 같은 요청 묶기 · 운영자만', async () => {
  const a = await company('ceo@req-a.test', '요청A'); const b = await company('ceo@req-b.test', '요청B');
  // 앱 문의(두 회사가 같은 요청) · 상담 신청
  const ticketRoute = (await a.c.req('POST', '/api/support', { category: 'idea', subject: '업무에 거래처 칸을 넣고 싶어요', body: '업무마다 거래처를 고르고 싶습니다' })).status;
  if (ticketRoute === 404) await sql`insert into support_tickets (tenant, user_id, category, subject, body) select ${a.tenant}, id, 'idea', '업무에 거래처 칸을 넣고 싶어요', '업무마다 거래처' from users where email = 'ceo@req-a.test'`;
  await sql`insert into support_tickets (tenant, user_id, category, subject, body) select ${b.tenant}, id, 'idea', '업무 사용자 정의 칸', '업무에 우리 회사 칸' from users where email = 'ceo@req-b.test'`;
  await b.c.ok('POST', '/api/spaces/consult', { spaces: ['sales'], name: '대표', phone: '010-0000-1175', email: 'ceo@req-b.test', memo: '영업 써 보고 싶어요' });

  assert.equal((await a.c.req('GET', '/api/platform/customer-requests')).status, 404, '고객은 못 봄');
  let v = await ctx.owner.ok('GET', '/api/platform/customer-requests');
  assert.equal(v.items.length, 3, JSON.stringify(v.items.map((x) => [x.source, x.title])));
  assert.deepEqual(v.items.map((x) => x.source).sort(), ['consult', 'ticket', 'ticket']);
  v = await ctx.owner.ok('GET', '/api/platform/customer-requests');
  assert.equal(v.items.length, 3, '다시 열어도 같은 건은 한 번');

  // 운영자 메모
  const m = await ctx.owner.ok('POST', '/api/platform/customer-requests', { source: 'memo', title: '전화로 받은 요청: 업무 거래처 칸', body: '요청C 통화' });
  // 분류·상태·답변
  const t1 = v.items.find((x) => /거래처 칸을/.test(x.title)); const t2 = v.items.find((x) => /사용자 정의/.test(x.title));
  await ctx.owner.ok('PATCH', `/api/platform/customer-requests/${t1.id}`, { category: 'common', status: 'review', ownerId: ctx.ownerId, reply: '공통 개선으로 검토하겠습니다' });
  // 같은 요청 묶기 → 대표 줄 요청 회사 수
  await ctx.owner.ok('PATCH', `/api/platform/customer-requests/${t2.id}`, { groupInto: t1.id });
  await ctx.owner.ok('PATCH', `/api/platform/customer-requests/${m.id}`, { groupInto: t1.id });
  v = await ctx.owner.ok('GET', '/api/platform/customer-requests');
  const head = v.items.find((x) => x.id === t1.id);
  assert.equal(head.companies, 3, '요청A·요청B·회사 미정 메모 = 3곳'); assert.equal(head.grouped, 2);
  assert.equal(head.category, 'common'); assert.equal(head.status, 'review'); assert.equal(head.reply, '공통 개선으로 검토하겠습니다');
  assert.ok(!v.items.some((x) => x.id === t2.id || x.id === m.id), '묶인 줄은 목록에서 빠짐');
  assert.equal(v.items[0].id, t1.id, '요청 회사가 많은 것부터');
  const d = await ctx.owner.ok('GET', `/api/platform/customer-requests/${t1.id}`);
  assert.equal(d.members.length, 2); assert.ok(d.logs.some((l) => /분류 공통 개선/.test(l.note ?? '')), '바뀐 기록');
  // 맞춤 개발 = 견적 후 진행(금액 없음)
  assert.equal(v.labels.category.custom, '맞춤 개발(견적 후 진행)');
  // 완료 → 진행 중 목록에서 빠짐
  await ctx.owner.ok('PATCH', `/api/platform/customer-requests/${t1.id}`, { status: 'done' });
  assert.ok(!(await ctx.owner.ok('GET', '/api/platform/customer-requests')).items.some((x) => x.id === t1.id));
  assert.ok((await ctx.owner.ok('GET', '/api/platform/customer-requests?status=done')).items.some((x) => x.id === t1.id));

  // 로컬 11/26: 시험 회사(is_test) 요청은 기본 목록·숫자에서 빠지고 ?test=1 이면 '시험 회사' 표시와 함께 보임
  const q = await company('ceo@req-qa.test', '검수시험'); await sql`update tenants set is_test = true where id = ${q.tenant}`;
  await sql`insert into support_tickets (tenant, user_id, category, subject, body) select ${q.tenant}, id, 'idea', '[검수] 시험 문의', 'smoke' from users where email = 'ceo@req-qa.test'`;
  const plain = await ctx.owner.ok('GET', '/api/platform/customer-requests');
  assert.ok(!plain.items.some((x) => x.title === '[검수] 시험 문의'), '시험 회사 요청은 기본 목록에서 빠짐'); assert.equal(plain.testHidden, 1);
  const withTest = await ctx.owner.ok('GET', '/api/platform/customer-requests?test=1');
  const qt = withTest.items.find((x) => x.title === '[검수] 시험 문의'); assert.ok(qt, '?test=1 이면 보임'); assert.equal(qt.test_company, true);
  assert.ok(withTest.items.filter((x) => x.title !== '[검수] 시험 문의').every((x) => !x.test_company), '다른 줄은 시험 회사 아님');
});
