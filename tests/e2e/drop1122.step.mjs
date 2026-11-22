// #1122(대표 11/22 '계약서 끌어다 놓기가 안 됨'): setInputFiles 가 아니라 진짜 끌어다 놓기(dragenter·dragover·drop + dataTransfer)
// 전자계약 1단계 — 형식 안내 · 여러 개면 첫 번째만 · PDF 올라감 / 놓는 칸이 아닌 곳 — 화면 그대로 + 안내 / 계약 관리 상세 — 계약서 파일로 올라감
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

/** 그 요소에 파일을 끌어다 놓는다(브라우저 안에서 DataTransfer 로) */
export async function dropFiles(page, locator, files) {
  const el = await locator.elementHandle();
  await page.evaluate(([node, fs]) => {
    const dt = new DataTransfer();
    for (const f of fs) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
    const r = node.getBoundingClientRect(); const opt = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    for (const t of ['dragenter', 'dragover', 'drop']) node.dispatchEvent(new DragEvent(t, opt));
  }, [el, files.map((f) => ({ name: f.name, type: f.type, b64: Buffer.from(f.buffer).toString('base64') }))]);
}

export async function drop1122({ owner, ctx, sql, BASE, SHOTS }) {
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); const pdf = Buffer.from(await d.save());
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 1) 전자계약 1단계 점선 상자
  await owner.goto(`${BASE}/contracts`);
  await owner.getByTestId('contract-new').click();
  const wz = owner.getByTestId('contract-wizard'); await wz.waitFor();
  const zone = wz.getByTestId('contract-drop');
  await dropFiles(owner, zone, [{ name: 'memo.txt', type: 'text/plain', buffer: Buffer.from('x') }]);
  await owner.getByText('이 형식은 올릴 수 없습니다 — PDF·png·jpg').first().waitFor();
  // #1125: 워드·한글은 막지 않고 'PDF 로 바꿔 올리기 준비 중 — [다른 이름으로 저장 › PDF]' 안내 + 계약 관리(보관) 링크
  await dropFiles(owner, zone, [{ name: '근로계약서.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK') }]);
  const note = wz.getByTestId('contract-office-note'); await note.waitFor();
  assert.match(await note.innerText(), /근로계약서\.docx[\s\S]*다른 이름으로 저장 › PDF[\s\S]*계약 관리/);
  await dropFiles(owner, zone, [{ name: 'E2E 끌어다 놓은 계약서.pdf', type: 'application/pdf', buffer: pdf }, { name: '두번째.pdf', type: 'application/pdf', buffer: pdf }]);
  await owner.getByText('파일은 하나만 올릴 수 있어 첫 번째 파일만 올립니다').first().waitFor();
  await wz.getByText('E2E 끌어다 놓은 계약서.pdf').waitFor({ timeout: 20000 });
  await owner.screenshot({ path: `${SHOTS}/1122-contract-drop.png` });
  // 2) 놓는 칸이 아닌 곳(단계 표시 줄): 화면 그대로 + 안내
  const url = owner.url();
  await dropFiles(owner, wz.locator('ol').first(), [{ name: 'x.pdf', type: 'application/pdf', buffer: pdf }]);
  await owner.getByText('여기에는 파일을 놓을 수 없습니다 — 파일을 올리는 칸에 놓아 주세요').first().waitFor();
  assert.equal(owner.url(), url, '쓰던 화면을 떠나지 않음'); await wz.getByText('E2E 끌어다 놓은 계약서.pdf').waitFor();
  // 3) 계약 관리 상세 — 계약서 파일 칸
  const a = await ctx.owner.ok('POST', '/api/agreements', { title: 'E2E 끌어다 놓기 계약', counterparty: '시험상사' });
  const id = a.agreement?.id ?? a.id;
  await owner.goto(`${BASE}/agreements?open=${id}`);
  const det = owner.getByTestId('agr-detail'); await det.waitFor();
  await dropFiles(owner, det.getByTestId('agr-file-drop'), [{ name: 'E2E 놓은 계약서.pdf', type: 'application/pdf', buffer: Buffer.from('%PDF-1.4 drop') }]);
  await det.getByTestId('agr-files').getByText('E2E 놓은 계약서.pdf').waitFor({ timeout: 15000 });
  const [f] = await sql`select f.upload_status from agreement_files f join agreements x on x.id = f.agreement_id where x.title = 'E2E 끌어다 놓기 계약'`;
  assert.equal(f?.upload_status, 'ready');
  await owner.screenshot({ path: `${SHOTS}/1122-agreement-drop.png` });
}
