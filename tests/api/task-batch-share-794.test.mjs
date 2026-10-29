// 대표 #794: 담당자 여러 명에게 '각자 1건씩'(같은 batch_id) 만든 업무 — 한 사람 업무에 단 댓글·첨부·체크리스트가 다른 담당자에게도 보이고 알림이 간다.
// 권한은 넓히지 않음: 같이 받은 업무는 댓글·반응·첨부 보기·내려받기만(그 업무 열기·고치기·지우기·올리기는 그대로 막힘) · 묶음 밖 사람은 404 그대로.
// + 공동 담당(함께 담당 1건) 댓글 알림이 주 담당·공동 담당·협업자에게 가는지(#794 4).
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, A, B;
const upload = async (c, tid, name, mime, bytes) => {
  const init = await c.ok('POST', '/api/attachments', { taskId: tid, kind: 'file', fileName: name, mimeType: mime, size: bytes.length });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: bytes });
  await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
  return init.id;
};
const notes = (uid, type) => sql`select title, body, link, entity_id, count from notifications where user_id = ${uid} and type = ${type} order by created_at`;

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  // 본사 조직 업무를 이직원(강남점)·박직원(판교)에게 각자 1건씩 — 둘은 서로의 업무를 원래 못 봄
  const r = await ctx.owner.ok('POST', '/api/tasks', { title: '11월 시설 점검표 제출', orgUnitId: ctx.hq, assigneeIds: [ctx.staffA.id, ctx.staffB.id], approvalRequired: false });
  assert.ok(r.batchId);
  const rows = await sql`select id, assignee_id from tasks where id = any(${r.ids}::uuid[])`;
  A = rows.find((x) => x.assignee_id === ctx.staffA.id).id; B = rows.find((x) => x.assignee_id === ctx.staffB.id).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('각자 1건씩 묶음 공유', () => {
  test('전제: 서로의 업무는 원래 못 봄(404)', async () => {
    assert.equal((await ctx.staffA.client.req('GET', `/api/tasks/${B}`)).status, 404);
    assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${A}`)).status, 404);
  });

  test('댓글: B 업무 댓글이 A 상세에 한 흐름(시간순)으로 · A 담당에게 자기 업무 링크로 알림 · 답글·반응은 A 에서 · 남의 댓글 수정 403', async () => {
    const stamp0 = (await ctx.staffA.client.ok('GET', `/api/tasks/${A}/stamp`)).stamp;
    await ctx.staffA.client.ok('POST', `/api/tasks/${A}/comments`, { body: 'A: 강남점 점검 시작합니다' });
    const cB = (await ctx.staffB.client.ok('POST', `/api/tasks/${B}/comments`, { body: 'B: 판교 점검표 양식 어디 있나요?' })).id;
    const dA = await ctx.staffA.client.ok('GET', `/api/tasks/${A}`);
    assert.deepEqual(dA.comments.map((c) => [c.body.slice(0, 2), c.task_id]), [['A:', A], ['B:', B]], '두 업무 댓글을 시간순 한 흐름');
    const dB = await ctx.staffB.client.ok('GET', `/api/tasks/${B}`);
    assert.deepEqual(dB.comments.map((c) => c.body.slice(0, 2)), ['A:', 'B:'], 'B 상세에서도 A 댓글이 보임');
    assert.equal(dA.batchMates.length, 2);
    // 알림: 이직원은 박직원 댓글을 자기 업무(A) 링크로
    const nA = await notes(ctx.staffA.id, 'comment');
    assert.equal(nA.length, 1); assert.equal(nA[0].entity_id, A); assert.equal(nA[0].link, `/tasks/${A}#c-${cB}`);
    const nB = await notes(ctx.staffB.id, 'comment');
    assert.equal(nB.length, 1); assert.equal(nB[0].entity_id, B, '박직원은 이직원 댓글을 자기 업무(B)로');
    assert.ok((await notes(ctx.ownerId, 'comment')).length >= 1, '요청자(대표)도 알림');
    // A 에서 B 댓글에 답글 → 답글은 A 업무에 저장, B 원 댓글 작성자에게 B 링크로 알림
    const rep = await ctx.staffA.client.ok('POST', `/api/tasks/${A}/comments`, { body: '공용 폴더에 있습니다', parentId: cB });
    assert.equal(rep.parentId, cB);
    const dB2 = await ctx.staffB.client.ok('GET', `/api/tasks/${B}`);
    const r2 = dB2.comments.find((c) => c.id === rep.id); assert.ok(r2); assert.deepEqual([r2.parent_id, r2.task_id], [cB, A]);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffB.id} and type = 'comment' and entity_id = ${B} and link like ${'%' + rep.id}`).length, '답글 알림(B 링크, 안 읽은 알림을 최신으로)');
    // 반응: A 담당이 B 댓글에 👍
    await ctx.staffA.client.ok('POST', `/api/comments/${cB}/reactions`, { emoji: '👍' });
    assert.equal((await ctx.staffB.client.ok('GET', `/api/tasks/${B}`)).comments.find((c) => c.id === cB).reactions[0].n, 1);
    // 수정·삭제는 쓴 사람만
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/comments/${cB}`, { body: '고침' })).status, 403);
    // 업무 자체는 여전히 못 봄
    assert.equal((await ctx.staffA.client.req('GET', `/api/tasks/${B}`)).status, 404);
    // 멘션 목록에 같이 받은 사람
    assert.ok((await ctx.staffA.client.ok('GET', `/api/tasks/${A}/mentionable`)).users.some((x) => x.id === ctx.staffB.id));
    // 열어 둔 상세의 바뀜 표시
    assert.notEqual((await ctx.staffA.client.ok('GET', `/api/tasks/${A}/stamp`)).stamp, stamp0);
  });

  test('첨부·체크리스트: B 의 첨부(보기·내려받기만)와 체크리스트(담당자별)가 A 상세에 · 새 첨부 알림 1건으로 묶음 · 올리기·지우기는 막힘', async () => {
    const it = await ctx.staffB.client.ok('POST', `/api/tasks/${B}/checklist`, { text: '판교 소방 점검' });
    await ctx.staffB.client.ok('PATCH', `/api/checklist/${it.id}`, { done: true });
    const f1 = await upload(ctx.staffB.client, B, '판교 점검표.pdf', 'application/pdf', Buffer.from('%PDF-1.4 판교'));
    await upload(ctx.staffB.client, B, '판교 사진.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const dA = await ctx.staffA.client.ok('GET', `/api/tasks/${A}`);
    assert.equal(dA.attachments.length, 0, '내 첨부 칸은 그대로');
    assert.deepEqual(dA.batchAttachments.map((a) => [a.file_name, a.from_name]), [['판교 점검표.pdf', '박직원'], ['판교 사진.png', '박직원']]);
    assert.deepEqual(dA.batchChecklist.map((c) => [c.text, c.done, c.from_name, c.task_id]), [['판교 소방 점검', true, '박직원', B]]);
    // 알림: 이직원에게 '새 첨부' 1건(2개로 묶임, A 링크)
    const n = await notes(ctx.staffA.id, 'task_file');
    assert.equal(n.length, 1); assert.equal(n[0].entity_id, A); assert.equal(n[0].count, 2); assert.match(n[0].title, /^새 첨부 2개/); assert.match(n[0].body, /박직원 업무에서/);
    assert.equal((await notes(ctx.staffB.id, 'task_file')).length, 0, '올린 사람에게는 없음');
    // 내려받기 됨(보기), 지우기·고치기·B 에 올리기는 안 됨
    const dl = await fetch(`${BASE}/api/attachments/${f1}/download`, { headers: { cookie: ctx.staffA.client.cookie, origin: BASE }, redirect: 'manual' });
    assert.ok(dl.status === 200 || (dl.status >= 300 && dl.status < 400), `내려받기 ${dl.status}`);
    assert.equal((await ctx.staffA.client.req('DELETE', `/api/attachments/${f1}`)).status, 403);
    assert.equal((await ctx.staffA.client.req('POST', '/api/attachments', { taskId: B, kind: 'link', url: 'https://example.com/x' })).status, 404);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/checklist/${it.id}`, { done: false })).status, 404, '남의 체크는 못 바꿈');
    // 묶음 밖 사람(최매니저 — 본사 업무를 못 봄)은 B 첨부·댓글 반응 모두 404
    assert.equal((await ctx.managerA.client.req('GET', `/api/attachments/${f1}/download`)).status, 404);
    const cB = (await sql`select id from comments where task_id = ${B} limit 1`)[0].id;
    assert.equal((await ctx.managerA.client.req('POST', `/api/comments/${cB}/reactions`, { emoji: '👍' })).status, 404);
  });

  test('지운 형제 업무의 댓글·첨부는 안 보임', async () => {
    await ctx.owner.ok('DELETE', `/api/tasks/${B}`);
    const dA = await ctx.staffA.client.ok('GET', `/api/tasks/${A}`);
    assert.ok(dA.comments.every((c) => c.task_id === A), '내 업무 댓글만');
    assert.equal(dA.batchAttachments.length, 0); assert.equal(dA.batchChecklist.length, 0);
  });
});

describe('#794 4 공동 담당(함께 담당 1건) 댓글 알림', () => {
  test('주 담당·공동 담당·협업자·요청자에게 — 쓴 사람 제외', async () => {
    const t = await ctx.owner.ok('POST', '/api/tasks', { title: '함께 담당 점검', orgUnitId: ctx.hq, assigneeId: ctx.staffA.id, coAssigneeIds: [ctx.staffB.id], collaboratorIds: [ctx.managerA.id], approvalRequired: false });
    const c1 = (await ctx.staffB.client.ok('POST', `/api/tasks/${t.id}/comments`, { body: '공동 담당이 남김' }));
    assert.deepEqual([...c1.notified].sort(), [ctx.ownerId, ctx.staffA.id, ctx.managerA.id].sort());
    const c2 = (await ctx.owner.ok('POST', `/api/tasks/${t.id}/comments`, { body: '요청자가 남김' }));
    // 안 읽은 댓글 알림이 있는 사람은 새로 보내지 않고 기존 1건을 갱신(10/17 규칙) → 새로 받는 사람 = 공동 담당(쓴 적 없음 → 아직 알림 없음)
    assert.deepEqual(c2.notified, [ctx.staffB.id]);
    const [n] = await sql`select count, link from notifications where user_id = ${ctx.staffA.id} and type = 'comment' and entity_id = ${t.id}`;
    assert.equal(n.count, 2, '주 담당은 1건에 2개로 묶임'); assert.match(n.link, new RegExp(c2.id));
  });
});
