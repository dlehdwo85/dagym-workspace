// 대표 #794: '각자 1건씩'(같은 batch_id) 업무 — 이직원 업무 상세(휴대폰)에서 박직원 업무의 댓글('박직원 업무에서' 꼬리)·첨부('함께 담당자 첨부')·체크리스트(담당자별, 보기만)가 보이고,
// 열어 둔 화면에 다른 담당자가 새 댓글을 달면 15초 안에 나타난다(가벼운 바뀜 표시 → 그때만 다시 읽기). 서버 권한·알림 규칙은 API 시험 task-batch-share-794
import assert from 'node:assert/strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export async function batch794({ staff, ctx, sql, BASE, SHOTS }) {
  const upload = async (c, tid, name, mime, bytes) => {
    const init = await c.ok('POST', '/api/attachments', { taskId: tid, kind: 'file', fileName: name, mimeType: mime, size: bytes.length });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: bytes });
    await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
  };
  const r = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 각자 점검표', orgUnitId: ctx.hq, assigneeIds: [ctx.staffA.id, ctx.staffB.id], approvalRequired: false });
  const rows = await sql`select id, assignee_id from tasks where id = any(${r.ids}::uuid[])`;
  const A = rows.find((x) => x.assignee_id === ctx.staffA.id).id, B = rows.find((x) => x.assignee_id === ctx.staffB.id).id;
  const b = ctx.staffB.client;
  await b.ok('POST', `/api/tasks/${B}/comments`, { body: '판교 점검 끝났습니다 — 사진 올렸어요' });
  const it = await b.ok('POST', `/api/tasks/${B}/checklist`, { text: '판교 소방 점검' });
  await b.ok('PATCH', `/api/checklist/${it.id}`, { done: true });
  await b.ok('POST', `/api/tasks/${B}/checklist`, { text: '판교 점검표 서명' });
  await upload(b, B, '판교 점검표.pdf', 'application/pdf', Buffer.from('%PDF-1.4 판교'));
  await upload(b, B, '판교 현장.png', 'image/png', PNG);

  await staff.goto(`${BASE}/tasks/${A}`);
  const head = staff.getByTestId('comment-from').first();
  await head.waitFor();
  assert.equal(await head.innerText(), '박직원 업무에서');
  // 함께 담당자 첨부: 사진 칸 + 파일 줄(내려받기만 — 올리기 버튼 없음, '박직원 업무' 표시)
  const mate = staff.getByTestId('mate-attachments');
  await mate.waitFor();
  assert.match(await mate.innerText(), /함께 담당자 첨부\s*2/);
  assert.equal(await mate.getByTestId('photo-grid').locator('a').count(), 1);
  assert.equal(await mate.getByRole('button', { name: '파일 첨부' }).isVisible(), false, '올리기 버튼 없음');
  assert.equal(await mate.getByTestId('att-edit').count(), 0, '고치기 없음');
  assert.ok((await mate.getByTestId('att-from').allInnerTexts()).every((x) => x === '박직원 업무'));
  // 체크리스트: 박직원 칸 1/2, 체크 칸은 잠김
  const cl = staff.getByTestId('mate-checklist');
  assert.match(await cl.innerText(), /박직원\s*1\/2/);
  assert.ok(await cl.getByRole('checkbox').first().isDisabled());
  // 넘침 없음(390 폭)
  assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '가로 넘침 없음');
  await cl.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await staff.screenshot({ path: `${SHOTS}/261-batch-share-checklist.png` });
  await mate.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await staff.screenshot({ path: `${SHOTS}/261-batch-share-attach.png` });
  // 열어 둔 화면: 박직원이 새 댓글 → 15초 안에 보임(새로 고침 없이)
  await b.ok('POST', `/api/tasks/${B}/comments`, { body: 'E2E 실시간 확인 댓글' });
  await staff.getByText('E2E 실시간 확인 댓글').waitFor({ timeout: 25_000 });
  await staff.getByText('E2E 실시간 확인 댓글').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await staff.screenshot({ path: `${SHOTS}/261-batch-share-comments.png` });
  // 정리: 다른 단계에 영향 없게 묶음 지움
  await ctx.owner.ok('DELETE', `/api/tasks/${A}`); await ctx.owner.ok('DELETE', `/api/tasks/${B}`);
}
