// 211차 대표 10/27 요청: ③ 다짐·하이링크 문의·마케팅 전화 문의 → 영업 진행(리드)에 연결(업무 완료 때 다음 연락일·종결로 이어짐) · 끝나지 않은 예전 문의 정기 연결
// ④ 영업 주요 일정: 업무가 이미 있는 리드는 빼냄(캘린더 한 줄) · ② 업무 활동 기록: 잇달아 올린 파일 첨부는 한 줄 · ⑤ 마케팅 제작 요금제(요금제마다 이번 달 남은 크레딧)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql, token;
const today = seoulToday();
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const send = (body) => fetch(`${BASE}/api/integrations/inquiries`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
const taskOf = async (id) => (await sql`select id, lead_id, sales_ref, status, due_date::text as due from tasks where id = ${id}`)[0];
const inquiry = (n, phone) => ({ lead_id: `DG-211-${n}`, inquiry_type: '위탁운영', organization: `시험단지 ${n}`, region: '경기', name: `문의자${n}`, phone, email: `q${n}@example.com`, message: `문의 본문 ${n}` });

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  token = (await ctx.owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'dagym' })).token;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('③ 문의 → 영업 진행(리드) 연결', () => {
  let first;
  test('영업 공간을 안 켰으면 리드 없이 업무만 · 켜면 정기 실행이 끝나지 않은 문의 업무를 리드에 이음', async () => {
    const r = await send(inquiry(1, '010-2110-0001'));
    assert.equal(r.status, 200);
    assert.equal((await taskOf(r.body.taskId)).lead_id, null, '영업 공간이 꺼져 있으면 리드 없음');
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
    const d = await tick();
    assert.equal(d.inquiryLeads?.linked, 1, JSON.stringify(d.inquiryLeads));
    const t = await taskOf(r.body.taskId);
    assert.ok(t.lead_id); assert.equal(t.sales_ref.kind, 'lead');
    const [l] = await sql`select name, status, owner_id, phone, src, next_contact_date::text as next from sales_leads where id = ${t.lead_id}`;
    assert.deepEqual([l.name, l.status, l.owner_id, l.src.from, l.src.site, l.next], ['시험단지 1', '신규리드', ctx.ownerId, 'website_inquiry', 'dagym', t.due]);
    assert.equal((await tick()).inquiryLeads?.linked, 0, '이은 업무는 다시 안 봄');
    first = { taskId: t.id, leadId: t.lead_id };
  });
  test('새 문의는 바로 리드 · 같은 전화번호면 그 리드에 상담 기록 한 줄', async () => {
    const r = await send(inquiry(2, '010-2110-0002'));
    const t = await taskOf(r.body.taskId);
    assert.ok(t.lead_id, '접수하자마자 리드');
    const again = await send({ ...inquiry(3, '01021100002'), organization: '같은 번호 다른 이름' });
    const t2 = await taskOf(again.body.taskId);
    assert.equal(t2.lead_id, t.lead_id, '같은 번호 = 같은 리드');
    assert.equal((await sql`select count(*)::int n from sales_leads where phone like '%2110-0002%' or phone like '%21100002%'`)[0].n, 1);
    const [rec] = await sql`select data from sales_lead_records where lead_id = ${t.lead_id} and kind = 'sales_activities' order by occurred_at desc limit 1`;
    assert.match(rec.data.content, /다짐 웹사이트 문의 자동 등록 — 다짐 웹사이트 문의 · 위탁운영/);
  });
  test('문의 업무를 [완료] = 다음 연락일을 고르면 그날 담당자 영업 업무(후속)', async () => {
    const r = await ctx.owner.ok('PATCH', `/api/tasks/${first.taskId}`, { status: 'done', leadFollowUp: { nextDate: addDays(today, 3), nextAction: '현장 방문 일정 잡기' } });
    assert.deepEqual([r.leadFollowUp?.action, r.leadFollowUp?.next], ['followup', addDays(today, 3)], JSON.stringify(r.leadFollowUp));
    const [next] = await sql`select title, due_date::text as due, assignee_id from tasks where lead_id = ${first.leadId} and status <> 'done' and deleted_at is null`;
    assert.deepEqual([next.title, next.due, next.assignee_id], ['[영업] 시험단지 1 — 현장 방문 일정 잡기', addDays(today, 3), ctx.ownerId]);
  });
  test('마케팅 전화 문의 [영업 리드로] = 리드 + 업무 연결(영업 공간을 켠 회사)', async () => {
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
    const c = await ctx.owner.ok('POST', '/api/marketing/calls', { phone: '010-2110-0009', source: '네이버 광고', memo: '가격 문의' });
    const cv = await ctx.owner.ok('POST', `/api/marketing/calls/${c.id}/convert`, {});
    assert.ok(cv.leadId);
    assert.equal((await taskOf(cv.taskId)).lead_id, cv.leadId);
    const [l] = await sql`select name, src from sales_leads where id = ${cv.leadId}`;
    assert.deepEqual([l.name, l.src.from], ['전화 문의 010-2110-0009', 'marketing_call']);
  });
});

describe('④ 영업 주요 일정 — 업무가 이미 있는 리드는 빼냄', () => {
  test('업무 없는 리드의 다음 연락만 주요 일정에', async () => {
    await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
    const withTask = await ctx.owner.ok('POST', '/api/sales/leads', { name: '업무 있는 리드 211', status: '1차연락완료', nextContactDate: addDays(today, 1), ownerId: ctx.ownerId, force: true });
    assert.ok((await sql`select 1 from tasks where lead_id = ${withTask.id} and deleted_at is null and status <> 'done'`).length, '리드 업무가 있음');
    await sql`insert into sales_leads (tenant, name, status, owner_id, next_contact_date) values ('default', '업무 없는 리드 211', '1차연락완료', ${ctx.ownerId}, ${addDays(today, 1)})`;
    const ag = await ctx.owner.ok('GET', `/api/spaces/agenda?from=${today}&to=${addDays(today, 7)}`);
    const titles = ag.items.filter((x) => x.space === 'sales').map((x) => x.title);
    assert.ok(titles.some((x) => x.includes('업무 없는 리드 211')), titles.join(' / '));
    assert.ok(!titles.some((x) => x.includes('업무 있는 리드 211')), '업무가 캘린더에 이미 보이므로 주요 일정에서 뺌');
  });
});

describe('② 업무 활동 기록 — 잇달아 올린 첨부는 한 줄', () => {
  test('같은 사람이 10분 안에 올린 파일 5개 = 활동 기록 1줄(이름 5개)', async () => {
    const t = await ctx.owner.ok('POST', '/api/tasks', { title: '사진 많이 올리는 업무', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false });
    for (let k = 1; k <= 5; k++) {
      const data = Buffer.from(`photo-${k}`);
      const r = await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'file', fileName: `현장${k}.jpg`, mimeType: 'image/jpeg', size: data.length });
      await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body: data });
      await ctx.owner.ok('POST', `/api/attachments/${r.id}/complete`, {});
    }
    const d = await ctx.owner.ok('GET', `/api/tasks/${t.id}`);
    const att = d.history.filter((h) => h.action === 'file_attached');
    assert.equal(att.length, 1, JSON.stringify(att.map((h) => h.changes?.name)));
    assert.deepEqual([...att[0].files].sort(), ['현장1.jpg', '현장2.jpg', '현장3.jpg', '현장4.jpg', '현장5.jpg']);
    assert.equal(d.attachments.length, 5);
  });
});

describe('⑤ 마케팅 제작 요금제 — 사용량·요금제 화면용', () => {
  test('요금제 3개 · 이번 달 쓴 크레딧 · 관리자만 고름 · 마케팅 공간이 없는 직원은 못 봄', async () => {
    const p = await ctx.owner.ok('GET', '/api/marketing/plan');
    assert.deepEqual(Object.keys(p.plans), ['basic', 'standard', 'pro']);
    assert.equal(typeof p.used.monthCredits, 'number'); assert.equal(p.canEdit, true);
    await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'standard' });
    assert.equal((await ctx.owner.ok('GET', '/api/marketing/plan')).planCode, 'standard');
    const st = await ctx.staffA.client.req('GET', '/api/marketing/plan');
    assert.ok([403, 404].includes(st.status), String(st.status));
  });
});
