// 332차(대표 11/02 16:1x 업무 첨부 ①~⑤): 올린 묶음(날짜·시각·사람)별 접기(최근 묶음만 펼침) · 체크로 바로 선택·Shift 범위·빈 곳 끌어 사각형 선택 ·
// 머리줄 [모두 선택]·선택 수 · 선택 띠 [선택 n개 내려받기(zip)](zip 안 파일 수)·[삭제] · 같은 이름·크기 다시 올리면 '이미 있는 파일 n개 건너뜀'
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function attach332({ owner, ctx, sql, BASE }) {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 332 첨부 선택', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false });
  const up = async (name, mime, body) => {
    const r = await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'file', fileName: name, mimeType: mime, size: body.length });
    await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body }); await ctx.owner.ok('POST', `/api/attachments/${r.id}/complete`, {}); return r.id;
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const a = await up('E2E 보고서.pdf', 'application/pdf', Buffer.from('%PDF-1.4 332a'));
  const b = await up('E2E 산출내역.hwp', 'application/x-hwp', Buffer.from('HWP332b'));
  const c = await up('E2E 사진.png', 'image/png', png);
  const memo = await up('E2E 메모332.txt', 'text/plain', Buffer.from('memo332'));
  const old = []; for (let k = 0; k < 11; k++) old.push(await up(`E2E 옛 자료 ${k + 1}.txt`, 'text/plain', Buffer.from(`old ${k}`)));
  await sql`update attachments set created_at = created_at - interval '1 day' where id = any(${old}::uuid[])`; // 어제 올린 묶음(접힘)
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  const att = owner.getByTestId('attachments'); await att.waitFor();
  await owner.getByTestId('att-photo-summary').getByText('첨부 15개').waitFor();
  assert.match(await owner.getByTestId('att-photo-summary').innerText(), /사진 1장 · 문서 14개/);
  // 묶음: 오늘(4개) 펼침 · 어제(11개) 접힘 → 머리줄 누르면 펼침
  assert.equal(await att.getByTestId('att-group').count(), 2, '묶음 2개');
  assert.equal(await att.getByTestId('att-group').nth(0).getAttribute('data-open'), '1');
  assert.equal(await att.getByTestId('att-group').nth(1).getAttribute('data-open'), '0', '어제 묶음은 접힘');
  assert.equal(await att.getByText('E2E 옛 자료 1.txt').count(), 0, '접힌 묶음 파일은 안 보임');
  assert.match(await att.getByTestId('att-group-head').nth(1).innerText(), /문서 11개/);
  await att.getByTestId('att-group-head').nth(1).click();
  await att.getByText('E2E 옛 자료 1.txt').waitFor();
  // 체크로 바로 선택 → 선택 수·선택 띠
  await att.locator(`li[data-att-id="${a}"] [data-testid="att-check"]`).click();
  await owner.getByTestId('att-sel-count').getByText('선택 1').waitFor();
  await owner.getByTestId('att-sel-bar').waitFor();
  // 사진 섬네일 체크 + Shift 범위(사진 → 산출내역: 사진·보고서·산출내역)
  await att.getByTestId('photo-check').first().click();
  await att.locator(`li[data-att-id="${b}"] [data-testid="att-check"]`).click({ modifiers: ['Shift'] });
  await owner.getByTestId('att-sel-count').getByText('선택 3').waitFor();
  // 머리줄 [모두 선택] → 15 · 띠 글자
  await owner.getByTestId('att-select-all').click();
  await owner.getByTestId('att-sel-count').getByText('선택 15').waitFor();
  assert.match(await owner.getByTestId('att-sel-zip').innerText(), /선택 15개 내려받기\(zip\)/);
  // zip 내려받기 → zip 안 15개
  const [dl] = await Promise.all([owner.waitForEvent('download'), owner.getByTestId('att-sel-zip').click()]);
  // 파일 이름(업무명_첨부n개_날짜.zip)은 API 시험(att-dedupe-332)에서 확인 — 크롬 헤드리스는 blob 내려받기 이름을 'download' 로만 알려 줄 때가 있음
  assert.ok(/\.zip$/.test(dl.suggestedFilename()) || dl.suggestedFilename() === 'download', dl.suggestedFilename());
  const zip = await readFile(await dl.path());
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(zip.readUInt16LE(eocd + 10), 15, 'zip 안 파일 수'); assert.ok(zip.includes(Buffer.from('E2E 산출내역.hwp')), 'UTF-8 이름');
  // 선택 해제 → 빈 곳에서 끌어 사각형 선택(오늘 묶음 줄 4개)
  await owner.getByTestId('att-sel-clear').click();
  await owner.getByTestId('att-sel-bar').waitFor({ state: 'detached' });
  await att.locator(`li[data-att-id="${memo}"]`).scrollIntoViewIfNeeded(); await att.locator(`li[data-att-id="${a}"]`).scrollIntoViewIfNeeded(); // 네 줄이 모두 화면 안에(1366×900)
  const r1 = await att.locator(`li[data-att-id="${a}"]`).boundingBox(); const r2 = await att.locator(`li[data-att-id="${memo}"]`).boundingBox();
  await owner.mouse.move(r1.x + r1.width * 0.55, r1.y + r1.height - 3); await owner.mouse.down();
  await owner.mouse.move(r1.x + r1.width * 0.6, r1.y + 10, { steps: 4 }); await owner.mouse.move(r2.x + r2.width * 0.6, r2.y + r2.height / 2, { steps: 6 }); await owner.mouse.up();
  await owner.getByTestId('att-sel-count').getByText('선택 4').waitFor();
  // 2개만 선택해 [삭제]
  await owner.getByTestId('att-sel-clear').click();
  await att.locator(`li[data-att-id="${a}"] [data-testid="att-check"]`).click(); await att.locator(`li[data-att-id="${b}"] [data-testid="att-check"]`).click();
  owner.once('dialog', (d) => d.accept());
  await owner.getByTestId('att-sel-delete').click();
  await owner.getByText('첨부 2개를 삭제했습니다').first().waitFor();
  await owner.waitForFunction((id) => !document.querySelector(`li[data-att-id="${id}"]`), a);
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null`)[0].n, 13);
  // 같은 이름·크기 다시 올리기 → 건너뜀 안내(새 줄 없음)
  await owner.getByTestId('file-input').setInputFiles([{ name: 'E2E 메모332.txt', mimeType: 'text/plain', buffer: Buffer.from('memo332') }, { name: 'E2E 새 메모.txt', mimeType: 'text/plain', buffer: Buffer.from('new332') }]);
  await owner.getByText('1개 첨부 완료 · 이미 있는 파일 1개 건너뜀').first().waitFor();
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null and file_name = 'E2E 메모332.txt'`)[0].n, 1, '중복 줄 없음');
  // 같은 이름·다른 내용은 올린 때로 구분
  await up('E2E 새 메모.txt', 'text/plain', Buffer.from('different content 332'));
  await owner.reload(); await att.waitFor();
  assert.equal(await att.getByTestId('att-uploaded-at').count(), 2, '같은 이름 둘 다 올린 때 표시');
}
