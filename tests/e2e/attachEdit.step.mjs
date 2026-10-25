// #533(대표 10/23 23:50 "업무 첨부파일 올린 상태에서 수정 후 저장"): ① 첨부 있는 업무의 제목·설명을 고쳐 저장 → 새로 열어도 그대로·첨부 그대로
// ② 첨부마다 [고치기] — 글(txt) 고쳐 저장 = v2(버전 기록 '글 고침') · 사진 돌리기·펜 = v2(가로·세로 바뀜) · PDF 에 글자·체크 = v2 · 한글(hwp) = 내려받아 고친 뒤 올리기 안내 · 휴대폰 폭에서도 [고치기]
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

export async function attachEdit({ owner, ctx, BASE, SHOTS }) {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 첨부 고치기 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.hq, approvalRequired: false })).id;
  const up = async (name, mime, bytes) => {
    const init = await ctx.owner.ok('POST', '/api/attachments', { taskId: t, kind: 'file', fileName: name, mimeType: mime, size: bytes.length });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: bytes });
    await ctx.owner.ok('POST', `/api/attachments/${init.id}/complete`, {});
    return init.id;
  };
  const raw = async (id) => Buffer.from(await (await fetch(`${BASE}/api/attachments/${id}/raw`, { headers: { cookie: ctx.owner.cookie, origin: BASE } })).arrayBuffer());
  const pngB64 = await owner.evaluate(() => { const c = document.createElement('canvas'); c.width = 200; c.height = 100; const g = c.getContext('2d'); g.fillStyle = '#0ea5e9'; g.fillRect(0, 0, 200, 100); g.fillStyle = '#fff'; g.fillRect(20, 20, 60, 60); return c.toDataURL('image/png').split(',')[1]; });
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]);
  const ids = {
    txt: await up('E2E 메모.txt', 'text/plain', Buffer.from('첫 줄\n둘째 줄', 'utf8')),
    png: await up('E2E 사진.png', 'image/png', Buffer.from(pngB64, 'base64')),
    pdf: await up('E2E 견적서.pdf', 'application/pdf', Buffer.from(await d.save())),
    hwp: await up('E2E 계획서.hwp', 'application/x-hwp', Buffer.from('HWP Document File E2E')),
  };
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks/${t}`);
  const att = owner.getByTestId('attachments'); await att.getByText('E2E 메모.txt').waitFor();
  const row = (name) => att.locator('li').filter({ hasText: name });
  const v2 = (name) => row(name).getByTestId('att-versions').filter({ hasText: 'v2' }).waitFor();
  // ① 첨부 있는 업무 고쳐 저장
  await owner.getByTestId('task-title').click();
  const ti = owner.locator('input[name="title"]'); await ti.fill('E2E 첨부 고치기 업무 (수정)'); await ti.press('Enter');
  await owner.getByTestId('task-title').filter({ hasText: '(수정)' }).waitFor();
  await owner.getByTestId('desc-section').getByText(/업무 내용·기준/).click();
  await owner.getByLabel('설명', { exact: true }).fill('첨부 있는 업무 설명 수정 E2E');
  await owner.getByTestId('desc-state').filter({ hasText: '저장됨' }).waitFor();
  await owner.reload();
  await owner.getByTestId('task-title').filter({ hasText: '(수정)' }).waitFor();
  await owner.getByTestId('desc-section').getByText('첨부 있는 업무 설명 수정 E2E').waitFor();
  await att.getByText('E2E 계획서.hwp').waitFor();
  assert.deepEqual(await att.getByTestId('att-edit').evaluateAll((els) => els.map((e) => e.getAttribute('data-mode')).sort()), ['image', 'other', 'pdf', 'text'], '첨부마다 [고치기](형식별 편집기)');
  // ② 글
  await row('E2E 메모.txt').getByTestId('att-edit').click();
  const te = owner.getByTestId('att-text-edit'); await te.waitFor();
  assert.equal(await te.getByTestId('att-text-area').inputValue(), '첫 줄\n둘째 줄');
  await te.getByTestId('att-text-area').fill('첫 줄 고침\n둘째 줄\n셋째 줄 추가');
  await owner.screenshot({ path: `${SHOTS}/267-attach-edit-text.png` });
  await te.getByTestId('att-edit-save').click();
  await v2('E2E 메모.txt');
  assert.equal((await raw(ids.txt)).toString('utf8'), '첫 줄 고침\n둘째 줄\n셋째 줄 추가');
  await row('E2E 메모.txt').getByTestId('att-versions').click();
  await owner.getByTestId('att-version-list').getByText('글 고침').waitFor();
  await owner.keyboard.press('Escape'); await owner.getByTestId('att-version-list').waitFor({ state: 'detached' });
  // 사진: 오른쪽으로 돌리고 펜 한 줄
  await row('E2E 사진.png').getByTestId('att-edit').click();
  const ie = owner.getByTestId('att-image-edit'); await ie.waitFor();
  await ie.getByTestId('img-canvas').waitFor();
  assert.match(await ie.getByTestId('img-size').innerText(), /^200×100 · 고친 단계 0/);
  await ie.getByTestId('img-rot-right').click();
  await owner.waitForFunction(() => document.querySelector('[data-testid="img-canvas"]')?.width === 100);
  assert.match(await ie.getByTestId('img-size').innerText(), /^100×200 · 고친 단계 1/, '#258 돌린 크기가 바로 보임(한 단계 늦지 않음)');
  const cb = await ie.getByTestId('img-canvas').boundingBox();
  await owner.mouse.move(cb.x + cb.width * 0.2, cb.y + cb.height * 0.5); await owner.mouse.down();
  await owner.mouse.move(cb.x + cb.width * 0.8, cb.y + cb.height * 0.6, { steps: 6 }); await owner.mouse.up();
  await owner.screenshot({ path: `${SHOTS}/268-attach-edit-image.png` });
  await ie.getByTestId('att-edit-save').click();
  await v2('E2E 사진.png');
  const img = await raw(ids.png);
  assert.deepEqual([img.readUInt32BE(16), img.readUInt32BE(20)], [100, 200], '돌린 사진(가로·세로 바뀜)');
  // PDF: 글자 칸 + 체크
  await row('E2E 견적서.pdf').getByTestId('att-edit').click();
  const pe = owner.getByTestId('att-pdf-edit'); await pe.waitFor();
  const pg = pe.getByTestId('att-pdf-page').first(); await pg.waitFor();
  const pb = await pg.boundingBox();
  await owner.mouse.click(pb.x + pb.width * 0.3, pb.y + pb.height * 0.15);
  const ta = pe.getByTestId('pdf-text-input');
  await ta.fill('합계 1,200,000원');
  const fs1 = await ta.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  // #258 칸보다 긴 글: 줄을 바꾸고 글자를 줄여 칸 안에 다 보임(잘리지 않음)
  const LONG = '합계 1,200,000원 — 3층 회의실 프로젝터 교체 공사 설치비와 운반비를 모두 포함한 금액입니다';
  await ta.fill(LONG);
  const m = await ta.evaluate((e) => ({ fs: parseFloat(getComputedStyle(e).fontSize), sh: e.scrollHeight, ch: e.clientHeight, lh: parseFloat(getComputedStyle(e).lineHeight) }));
  assert.ok(m.fs < fs1, `글자 줄임 ${fs1} → ${m.fs}`);
  assert.ok(m.sh <= m.ch + 2, `칸 안에 다 보임 scroll ${m.sh} client ${m.ch}`);
  assert.ok(m.sh >= m.lh * 1.9, `여러 줄 ${m.sh} / ${m.lh}`);
  assert.equal(await pe.getByTestId('pdf-text-over').count(), 0);
  // 가장 작은 글자로도 넘치면 빨간 표시 + 저장 막기 → 줄이면 저장
  await ta.fill(LONG.repeat(20));
  await pe.getByTestId('pdf-text-over').waitFor();
  await pe.getByTestId('att-edit-save').click();
  await owner.getByText('글이 칸에 다 들어가지 않습니다').first().waitFor();
  await ta.fill(LONG);
  await pe.getByTestId('pdf-text-over').waitFor({ state: 'detached' });
  await pe.getByTestId('pdf-tool-check').click();
  await owner.mouse.click(pb.x + pb.width * 0.7, pb.y + pb.height * 0.15);
  assert.equal(await pe.getByTestId('pdf-item').count(), 2);
  await owner.screenshot({ path: `${SHOTS}/269-attach-edit-pdf.png` });
  await pe.getByTestId('att-edit-save').click();
  await v2('E2E 견적서.pdf');
  const pv = (await ctx.owner.ok('GET', `/api/attachments/${ids.pdf}/versions`)).versions[0];
  assert.deepEqual([pv.kind, pv.note], ['pdf', 'PDF 에 써넣음(글자 1·체크 1)']);
  // 한글: 안내 → [고친 파일 올리기] = 새 버전 올리기
  await row('E2E 계획서.hwp').getByTestId('att-edit').click();
  const g = owner.getByTestId('att-edit-guide'); await g.waitFor();
  assert.match(await g.innerText(), /한글 파일은 브라우저에서 바로 고칠 수 없습니다/);
  const [chooser] = await Promise.all([owner.waitForEvent('filechooser'), g.getByTestId('att-edit-upload').click()]);
  await chooser.setFiles({ name: 'E2E 계획서.hwp', mimeType: 'application/x-hwp', buffer: Buffer.from('HWP Document File E2E v2') });
  await v2('E2E 계획서.hwp');
  // 휴대폰 폭
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/tasks/${t}`);
  const edit = row('E2E 메모.txt').getByTestId('att-edit'); await edit.waitFor();
  const eb = await edit.boundingBox(); assert.ok(eb && eb.x >= 0 && eb.x + eb.width <= 390, `휴대폰 폭 안 [고치기] ${JSON.stringify(eb)}`);
  for (const n of ['E2E 메모.txt', 'E2E 사진.png']) { const nb = await row(n).locator('a').first().boundingBox(); assert.ok(nb && nb.width > 100, `휴대폰에서 파일 이름이 보임(버튼에 밀리지 않음) ${n} ${nb?.width}`); }
  await edit.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/270-attach-edit-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
