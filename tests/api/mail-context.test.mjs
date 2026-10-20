// 대표 10/21 05:20: ① 업무 메일·문자 첨부 목록에 자료실 연결 첨부(출처 '자료실'), 기밀·지워진 파일은 숨기지 않고 '발송 불가' 표시 ② 받는 사람 자동 채움(문의자 → 연결 연락처 → 리드 → 업무 설명) + 나머지는 제안
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`; // 리드 쓰기 열기
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
async function lib(name, folder = '제안') {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'application/pdf', size: 4, folder });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('abcd') }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}

test('① 자료실에서 가져온 첨부도 메일 첨부 목록에(출처 library) · 기밀 자료는 목록에 남되 blocked=confidential · 자료실에서 지우면 blocked=deleted', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '첨부 시험' });
  const up = await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'file', fileName: '직접.pdf', mimeType: 'application/pdf', size: 4 });
  await fetch(BASE + up.upload.url, { method: 'PUT', headers: up.upload.headers, body: Buffer.from('abcd') }); await ctx.owner.ok('POST', `/api/attachments/${up.id}/complete`, {});
  const a = await lib('제안서.pdf'); const b = await lib('급여 명세.pdf', '인사'); const c = await lib('옛 자료.pdf');
  for (const id of [a, b, c]) await ctx.owner.ok('POST', `/api/library/${id}/attach`, { taskId: t.id });
  await sql`update library_files set security = 'confidential' where id = ${b}`;
  await ctx.owner.ok('DELETE', `/api/library/${c}`);
  const m = await ctx.owner.ok('GET', `/api/tasks/${t.id}/mail`);
  const rows = Object.fromEntries(m.attachments.map((x) => [x.name, [x.source, x.blocked]]));
  assert.deepEqual(rows, { '직접.pdf': ['upload', null], '제안서.pdf': ['library', null], '급여 명세.pdf': ['library', 'confidential'], '옛 자료.pdf': ['library', 'deleted'] }, JSON.stringify(m.attachments));
  // 자료실 연결 첨부로 보내기 → 저장 파일 그대로 담김(발송 자체는 mail-outbox 시험) · 기밀은 400
  assert.equal((await ctx.owner.req('POST', '/api/mail/send', { taskId: t.id, company: 'default', to: ['x@client.test'], subject: 's', body: 'b', attachmentIds: [m.attachments.find((x) => x.name === '급여 명세.pdf').id] })).status >= 400, true, '기밀은 보내기 거절');
});

test('② 받는 사람 자동 채움: 연결 연락처 → 리드 → 업무 설명 순, 첫 값 to/phone + 나머지 제안(중복 없음) · 문의 업무는 문의자 먼저', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '수신자 시험', description: '담당 kim@apt.test / 010-5555-6666, 참고 lee@apt.test' });
  const hong = await ctx.owner.ok('POST', '/api/contacts', { name: '홍소장', organization: '푸르지오', phone: '010-1111-2222', email: 'hong@client.test' });
  await sql`insert into contact_tasks (contact_id, task_id) values (${hong.id}, ${t.id})`; // 연락처 ↔ 업무 연결(문의·발송·견적 때 자동으로 생김)
  const lead = await ctx.owner.ok('POST', '/api/sales/leads', { name: '리드 거래처', contactName: '박부장', email: 'park@lead.test', phone: '010-3333-4444' });
  await sql`update tasks set lead_id = ${lead.id} where id = ${t.id}`;
  const m = await ctx.owner.ok('GET', `/api/tasks/${t.id}/mail`);
  assert.deepEqual(m.to, ['hong@client.test']); assert.equal(m.phone, '010-1111-2222');
  assert.deepEqual(m.candidates.emails.map((c) => [c.value, c.source]), [['hong@client.test', 'contact'], ['park@lead.test', 'lead'], ['kim@apt.test', 'description'], ['lee@apt.test', 'description']], JSON.stringify(m.candidates));
  assert.deepEqual(m.candidates.phones.map((c) => [c.value, c.source]), [['010-1111-2222', 'contact'], ['010-3333-4444', 'lead'], ['010-5555-6666', 'description']]);
  assert.ok(m.candidates.emails[1].label.includes('리드 거래처') && m.candidates.emails[1].label.includes('박부장'));
  // 아무 근거 없는 업무는 빈 값
  const t2 = await ctx.owner.ok('POST', '/api/tasks', { title: '빈 업무' });
  const m2 = await ctx.owner.ok('GET', `/api/tasks/${t2.id}/mail`);
  assert.deepEqual([m2.to, m2.phone, m2.candidates.emails.length], [[], null, 0]);
});
