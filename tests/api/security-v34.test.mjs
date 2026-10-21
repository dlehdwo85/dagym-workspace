// V34 C1·C2·A5: 기밀 자료(파일 등급·폴더 상속)는 공개 링크·외부 메일로 안 나감, 링크를 만든 뒤 기밀로 바뀌거나 자료실에서 지우면 못 받음,
// 업무 첨부 내려받기도 매번 자료실 등급으로 판단, 자료 받기 화면의 "보낸 회사"는 고른 회사
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer({ MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

async function libFile(name, folder, security) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'application/pdf', size: 12, folder, ...(security ? { security } : {}) });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}

describe('V34 기밀 자료 외부 유출 막기', () => {
  test('기밀 파일: 공유 링크 403, 일반 파일 → 링크(고른 회사 표시) → 나중에 기밀·삭제되면 못 받음, 첨부 내려받기도 막힘', async () => {
    await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '기본회사', isDefault: true });
    await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'hilink', name: '보낸회사' });
    const task = (await ctx.owner.ok('POST', '/api/tasks', { title: '기밀 시험', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const conf = await libFile('급여표.pdf', '인사', 'confidential');
    await sql`update library_files set security = 'confidential' where id = ${conf}`;
    // 기밀은 직원이 관계된 업무에 붙일 수 없음 → 대표만 관계된 업무로
    const ownTask = (await ctx.owner.ok('POST', '/api/tasks', { title: '대표 기밀 업무', approvalRequired: false })).id;
    const ca = (await ctx.owner.ok('POST', `/api/library/${conf}/attach`, { taskId: ownTask })).id;
    assert.equal((await ctx.owner.req('POST', '/api/mail/share', { taskId: ownTask, attachmentIds: [ca] })).status, 403, '기밀은 링크 불가');
    assert.equal((await ctx.owner.ok('GET', `/api/tasks/${ownTask}/mail`)).attachments.find((a) => a.id === ca)?.blocked, 'confidential', '메일 첨부 목록에 "기밀이라 못 보냄" 사유와 함께(대표 10/21 05:20 ①: 조용히 빼지 않음)');
    // 일반 파일 → 링크(보낸 회사 = 고른 회사)
    const pub = await libFile('회사소개서.pdf', '영업자료');
    await sql`update library_files set security = 'public' where id = ${pub}`;
    const pa = (await ctx.owner.ok('POST', `/api/library/${pub}/attach`, { taskId: task })).id;
    const share = await ctx.owner.ok('POST', '/api/mail/share', { taskId: task, attachmentIds: [pa], company: 'hilink' });
    const token = share.url.split('/d/')[1];
    const page = await (await fetch(`${BASE}/d/${token}`)).text();
    assert.ok(page.includes('보낸회사에서 보낸 자료'), '고른 회사 표시'); assert.ok(!page.includes('기본회사에서'));
    assert.equal((await fetch(`${BASE}/api/public/share/${token}/0`, { redirect: 'manual' })).status < 400, true);
    assert.equal((await ctx.staffA.client.req('GET', `/api/attachments/${pa}/download?json=1`)).status, 200);
    // 폴더를 기밀로(상속) → 공유 링크·직원 첨부 내려받기 막힘, 대표는 됨
    await sql`insert into library_folder_security (tenant, folder, security) values ('default', '영업자료', 'confidential')`;
    assert.equal((await fetch(`${BASE}/api/public/share/${token}/0`, { redirect: 'manual' })).status, 404);
    assert.equal((await ctx.staffA.client.req('GET', `/api/attachments/${pa}/download?json=1`)).status, 403);
    assert.equal((await ctx.owner.req('GET', `/api/attachments/${pa}/download?json=1`)).status, 200);
    await sql`delete from library_folder_security where folder = '영업자료'`;
    // 자료실에서 지우면 첨부도 못 엶
    await ctx.owner.ok('DELETE', `/api/library/${pub}`);
    assert.equal((await ctx.owner.req('GET', `/api/attachments/${pa}/download?json=1`)).status, 404);
    assert.equal((await fetch(`${BASE}/api/public/share/${token}/0`, { redirect: 'manual' })).status, 404);
  });
  test('개인정보 처리방침: 보호책임자 자리표시자 없음', async () => {
    const html = await (await fetch(`${BASE}/privacy`)).text();
    assert.ok(!html.includes('PRIVACY_CONTACT 입력 필요'));
  });
});
