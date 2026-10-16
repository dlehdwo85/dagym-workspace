// 대표 실기기(10/16): 음성 업무 등록 — 말더듬·반복·지시 문구가 섞인 받아쓰기 → AI 1번으로 업무명·담당(이름이 틀려도 직책이 1명이면)·마감 정리, 사용량 기록
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, Client, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, kms;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const today = seoulToday();
before(async () => { await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'kms@dagym.test', name: '김민수', role: 'staff', title: '본부장', orgUnitIds: [ctx.siteA] });
  await new Client('kms').ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'kms-pass-1234' });
  kms = (await sql`select id from users where email = 'kms@dagym.test'`)[0].id;
  await sql`update users set title = '본부장' where id = ${kms}`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('음성 업무 정리', () => {
  test('AI 가 고른 이름·직책 → 사람, 마감 형식·과거 날짜 거름, 사용량 기록, 사람 목록·말한 내용을 AI 에 보냄', async () => {
    const text = '다음 주 금요일까지 푸르지오 주안 아파트 비교 파일 보안에서 본부장이 검수 후에 보고할 것 나 지금 본부장한테 업무 배정해 줘';
    await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '푸르지오 주안 아파트 비교 파일 검수 후 보고', assignee: '본부장', dueDate: addDays(today, 7), dueTime: null })] });
    const n0 = (await (await fetch(`${FAKE}/__state`)).json()).anthropic.length;
    const r = await ctx.owner.ok('POST', '/api/voice/structure', { text });
    assert.equal(r.ok, true); assert.equal(r.title, '푸르지오 주안 아파트 비교 파일 검수 후 보고');
    assert.equal(r.assigneeId, kms, '직책 "본부장" 이 한 명 → 김민수'); assert.equal(r.dueDate, addDays(today, 7));
    const sent = JSON.stringify((await (await fetch(`${FAKE}/__state`)).json()).anthropic.slice(n0)[0].body);
    assert.ok(sent.includes('김민수 (본부장)') && sent.includes('푸르지오'));
    assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'voice'`)[0].n, 1);
    await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '견적서 보내기', assignee: '김민수', dueDate: '2020-01-01', dueTime: '25시' })] });
    const r2 = await ctx.owner.ok('POST', '/api/voice/structure', { text: '김민수 견적서 보내기' });
    assert.equal(r2.assigneeId, kms); assert.equal(r2.dueDate, null, '지난 날짜는 버림'); assert.equal(r2.dueTime, null);
    await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '정리', assignee: '없는사람', dueDate: null, dueTime: null })] });
    assert.equal((await ctx.owner.ok('POST', '/api/voice/structure', { text: '없는사람한테 정리 맡겨' })).assigneeId, null, '목록에 없는 사람은 지어내지 않음');
  });
});
