// V32 6 회사 기본 메일 권한: 발송 방식·메일 계정은 대표·관리자만(메뉴 권한이 있어도 직원은 403), 직원 회신 주소 변경 허용 설정, 내 명함·회신 주소
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => {
  await resetDb();
  srv = await startServer({ RESEND_API_KEY: 're_test_key', MAIL_FROM_DOMAIN: 'mail.work-in.test', RESEND_API_BASE: 'http://localhost:3299' });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V32 6 회사 기본 메일 권한', () => {
  test('메일 설정 메뉴 편집 권한을 줘도 직원은 발송 방식·계정 변경 403, 화면은 읽기 전용 표시', async () => {
    for (const m of ['mail_settings', 'send_external']) await sql`insert into menu_user_perms (menu, user_id, level) values (${m}, ${ctx.staffA.id}, ${m === 'send_external' ? 'use' : 'edit'})`;
    const g = await ctx.staffA.client.ok('GET', '/api/org/mail-account');
    assert.equal(g.canEdit, false);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/org/mail-mode', { mode: 'workin' })).status, 403);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/org/mail-mode', { allowStaffReplyTo: false })).status, 403);
    assert.equal((await ctx.staffA.client.req('DELETE', '/api/org/mail-account')).status, 403);
    assert.equal((await ctx.owner.ok('GET', '/api/org/mail-account')).canEdit, true);
    await ctx.owner.ok('PUT', '/api/org/mail-mode', { mode: 'workin' });
  });

  test('직원 회신 주소: 허용이면 시안에서 바꾼 주소, 막으면 늘 본인 업무 이메일 · 내 명함 화면도 막힘', async () => {
    const card = await ctx.staffA.client.ok('PUT', '/api/account/card', { title: '주임', phone: '010-1111-2222', workEmail: 'lee@company.test' });
    assert.deepEqual([card.title, card.phone, card.workEmail, card.replyToEditable], ['주임', '010-1111-2222', 'lee@company.test', true]);
    const taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '회신 주소 시험', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const send = (replyTo) => ctx.staffA.client.ok('POST', '/api/mail/send', { taskId, company: 'dagym', to: ['c@client.test'], subject: '안내', body: '본문', replyTo });
    await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호', isDefault: true });
    const a = await send('other@company.test');
    assert.equal((await sql`select reply_to from outbox where id = ${a.id}`)[0].reply_to, 'other@company.test');
    await ctx.owner.ok('PUT', '/api/org/mail-mode', { allowStaffReplyTo: false });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${taskId}/mail`)).replyToEditable, false);
    const b = await send('other@company.test');
    assert.equal((await sql`select reply_to from outbox where id = ${b.id}`)[0].reply_to, 'lee@company.test', '막으면 본인 업무 이메일');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/account/card', { workEmail: 'x@company.test' })).status, 403);
    assert.equal((await ctx.staffA.client.ok('PUT', '/api/account/card', { title: '대리', workEmail: 'lee@company.test' })).title, '대리', '그대로면 통과');
    // 관리자는 막혀도 자기 회신 주소를 바꿀 수 있음
    assert.equal((await ctx.owner.ok('PUT', '/api/account/card', { workEmail: 'ceo@company.test' })).workEmail, 'ceo@company.test');
  });
});
