// V30 P1 ① 엑셀·CSV 업무 가져오기: 파일 읽기(따옴표·줄바꿈·xlsx) → 열 짝 추측 → 미리보기(담당자 이름·이메일·동명이인·날짜·우선순위·상태) → 만들기(담당자별 알림 1건) → 되돌리기
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

let srv, sql, ctx;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V30 ① 업무 가져오기', () => {
  let parsed;
  test('예시 양식(로그인)', async () => {
    const r = await ctx.owner.req('GET', '/api/tasks/import/template');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/csv/);
    assert.ok(String(r.body).includes('제목,담당자,마감일'));
    assert.ok(String(r.body).includes('김대표') || String(r.body).includes('이직원'));
  });

  test('CSV 읽기: 따옴표 안 쉼표·줄바꿈, 머리글로 열 짝 추측', async () => {
    const csv = '﻿업무명,담당자,마감일,중요도,진행상태,비고\r\n'
      + '"현장 점검, 1차",김대표,2026.10.20,긴급,진행 중,"첫 줄\n둘째 줄"\r\n'
      + '견적 받기,staffB@dagym.test,10/25,높음,,\r\n'
      + '안내문 붙이기,없는사람,bad-date,,,\r\n'
      + '완료된 일,이직원,,,완료,\r\n'
      + ',이직원,,,,\r\n'
      + '휴가 정리,이직원,46315,낮음,보류,\r\n'
      + ',,,,,\r\n';
    parsed = await ctx.owner.ok('POST', '/api/tasks/import/parse', { fileName: '업무.csv', data: b64(csv) });
    assert.deepEqual(parsed.headers, ['업무명', '담당자', '마감일', '중요도', '진행상태', '비고']);
    assert.equal(parsed.rows.length, 6, '빈 줄은 뺌');
    assert.equal(parsed.rows[0][0], '현장 점검, 1차');
    assert.equal(parsed.rows[0][5], '첫 줄\n둘째 줄');
    assert.deepEqual(parsed.mapping, { title: 0, assignee: 1, dueDate: 2, priority: 3, status: 4, description: 5 });
  });

  test('미리보기: 이름·이메일 맞추기, 못 찾은 사람, 날짜 오류, 완료·제목 없음 오류', async () => {
    const p = await ctx.owner.ok('POST', '/api/tasks/import/preview', { headers: parsed.headers, rows: parsed.rows, mapping: parsed.mapping });
    const [a, b, c, d, e, f] = p.rows;
    assert.equal(a.task.assigneeId, ctx.ownerId); assert.equal(a.task.dueDate, '2026-10-20'); assert.equal(a.task.priority, 'urgent'); assert.equal(a.task.status, 'in_progress');
    assert.equal(b.task.assigneeId, ctx.staffB.id, '이메일로'); assert.match(b.task.dueDate, /^\d{4}-10-25$/); assert.equal(b.task.priority, 'high');
    assert.equal(c.task.assigneeId, null); assert.ok(c.errors.some((x) => x.includes('bad-date'))); assert.ok(c.warnings.some((x) => x.includes('없는사람')));
    assert.ok(d.errors.some((x) => x.includes('완료')));
    assert.ok(e.errors.some((x) => x.includes('제목')));
    assert.equal(f.task.dueDate, '2026-10-20', '엑셀 날짜 숫자'); assert.equal(f.task.status, 'on_hold'); assert.equal(f.task.priority, 'low');
    assert.deepEqual(p.unmatched.map((x) => x.value), ['없는사람']);
    assert.deepEqual(p.counts, { total: 6, ready: 3, errors: 3, skipped: 0 });
    assert.equal((await ctx.owner.req('POST', '/api/tasks/import/preview', { headers: parsed.headers, rows: parsed.rows, mapping: {} })).status, 400, '제목 열 없음');
  });

  test('만들기: 오류 없는 줄만, 고른 담당자, 뺀 줄 제외, 담당자마다 알림 1건(업무별 배정 알림 없음)', async () => {
    const rows = parsed.rows.map((r) => [...r]); rows[2][2] = '2026-11-01'; // 날짜 고침
    const r = await ctx.owner.ok('POST', '/api/tasks/import', { headers: parsed.headers, rows, mapping: parsed.mapping, assigneeMap: { 없는사람: ctx.managerA.id }, skipRows: [5] });
    assert.equal(r.created, 3); assert.deepEqual(r.failed, []);
    const ts = await sql`select title, assignee_id, due_date::text, priority, status, description, import_id from tasks where import_id = ${r.importId} order by title collate "C"`;
    assert.deepEqual(ts.map((t) => t.title), ['견적 받기', '안내문 붙이기', '현장 점검, 1차']);
    assert.equal(ts.find((t) => t.title === '안내문 붙이기').assignee_id, ctx.managerA.id);
    assert.equal(ts.find((t) => t.title === '현장 점검, 1차').description, '첫 줄\n둘째 줄');
    const notes = await sql`select user_id, title from notifications where type = 'task_assigned' order by created_at`;
    assert.deepEqual(notes.map((n) => n.title).sort(), ['새 업무 1건 배정', '새 업무 1건 배정'], 'staffB·managerA 각 1건(본인 배정은 알림 없음)');
    assert.equal(notes.filter((n) => n.title.startsWith('새 업무 배정:')).length, 0);
    // 되돌리기: 다른 사람 400, 만든 사람 → 휴지통
    assert.equal((await ctx.staffA.client.post('/api/tasks/import/undo', { importId: r.importId })).status, 400);
    assert.equal((await ctx.owner.ok('POST', '/api/tasks/import/undo', { importId: r.importId })).removed, 3);
    assert.equal((await sql`select count(*)::int n from tasks where import_id = ${r.importId} and deleted_at is null`)[0].n, 0);
    assert.equal((await ctx.owner.req('POST', '/api/tasks/import/undo', { importId: r.importId })).status, 400, '두 번 안 됨');
  });

  test('직원도 자기 업무 가져오기 가능, 동명이인은 고르게', async () => {
    await sql`update users set name = '이직원' where id = ${ctx.managerA.id}`;
    const p = await ctx.staffA.client.ok('POST', '/api/tasks/import/preview', { headers: ['제목', '담당'], rows: [['내 업무', '이직원']], mapping: { title: 0, assignee: 1 } });
    assert.equal(p.rows[0].task.assigneeId, null); assert.equal(p.unmatched[0].why, 'many');
    const r = await ctx.staffA.client.ok('POST', '/api/tasks/import', { headers: ['제목', '담당'], rows: [['내 업무', '이직원']], mapping: { title: 0, assignee: 1 }, assigneeMap: { 이직원: ctx.staffA.id } });
    assert.equal(r.created, 1);
    await sql`update users set name = '최매니저' where id = ${ctx.managerA.id}`;
  });

  test('xlsx: 업무 엑셀 내보내기 → 그대로 가져오기(완료 업무는 오류)', async () => {
    const t1 = await ctx.owner.ok('POST', '/api/tasks', { title: '엑셀 왕복 시험', assigneeId: ctx.staffA.id, dueDate: '2026-12-01', priority: 'high', approvalRequired: false });
    const x = await fetch(`${BASE}/api/export/tasks?includeDone=1`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200);
    const buf = Buffer.from(await x.arrayBuffer());
    const p = await ctx.owner.ok('POST', '/api/tasks/import/parse', { fileName: '워크인_업무.xlsx', data: buf.toString('base64') });
    assert.equal(p.headers[1], '업무명'); assert.equal(p.mapping.title, 1); assert.equal(p.mapping.assignee, 2); assert.equal(p.mapping.dueDate, 7);
    const pv = await ctx.owner.ok('POST', '/api/tasks/import/preview', { headers: p.headers, rows: p.rows, mapping: p.mapping });
    const row = pv.rows.find((r) => r.task?.title === '엑셀 왕복 시험');
    assert.equal(row.task.assigneeId, ctx.staffA.id); assert.equal(row.task.dueDate, '2026-12-01'); assert.equal(row.task.priority, 'high');
    await ctx.owner.ok('DELETE', `/api/tasks/${t1.id}`);
  });

  test('한도·형식: 501줄 400, .xls 400, 빈 파일 400', async () => {
    const big = '제목\n' + Array.from({ length: 501 }, (_, k) => `업무 ${k}`).join('\n');
    assert.equal((await ctx.owner.req('POST', '/api/tasks/import/parse', { fileName: 'a.csv', data: b64(big) })).status, 400);
    assert.equal((await ctx.owner.req('POST', '/api/tasks/import/parse', { fileName: 'a.xls', data: b64('x') })).status, 400);
    assert.equal((await ctx.owner.req('POST', '/api/tasks/import/parse', { fileName: 'a.csv', data: b64('\n\n') })).status, 400);
    assert.ok(seoulToday());
  });
});
