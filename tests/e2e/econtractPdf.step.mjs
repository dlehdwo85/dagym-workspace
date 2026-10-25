// 139차 전자계약 2차 화면(대표 10/24 글로싸인 최소선): 관리 › 전자계약 [새 계약] PDF 올리기 → 서명자 → 칸 놓기(서명·글자) → 보내기 → 받은 사람 화면에서 PDF 쪽이 그려지고 칸 채워 서명 완료.
// 140차에서 찾은 문제(브라우저용 pdf.js 기본 빌드가 Map.getOrInsertComputed 없는 브라우저에서 멈춤 → 편집기·서명 화면 빈 화면)를 다시 막는 시험
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

export async function econtractPdf({ owner, ctx, sql, BASE, SHOTS }) {
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]);
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/contracts`);
  await owner.getByTestId('contract-new').click();
  const wz = owner.getByTestId('contract-wizard'); await wz.waitFor();
  await wz.getByTestId('contract-file').setInputFiles({ name: 'E2E 용역 계약서.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await d.save()) });
  await wz.getByTestId('contract-title').fill('E2E 용역 계약서');
  const next = wz.getByTestId('wizard-next');
  await owner.waitForFunction(() => !document.querySelector('[data-testid="wizard-next"]')?.hasAttribute('disabled'));
  await next.click();
  const row = wz.getByTestId('signer-row').first(); await row.waitFor();
  await row.getByTestId('signer-name').fill('거래처 E2E'); await row.getByTestId('signer-email').fill('partner-e2e@example.test');
  await next.click();
  const page = wz.getByTestId('editor-page').first(); await page.waitFor();
  await page.locator('img').first().waitFor(); // 쪽 그림이 그려짐(pdf.js)
  let pb = await page.boundingBox(); // 처음 도구 = 서명
  await owner.mouse.click(pb.x + pb.width * 0.65, pb.y + pb.height * 0.35); // 화면 안(A4 쪽은 창보다 길다)
  await wz.getByTestId('editor-field').first().waitFor();
  await wz.getByTestId('tool-text').click(); pb = await page.boundingBox();
  await owner.mouse.click(pb.x + pb.width * 0.3, pb.y + pb.height * 0.15);
  assert.equal(await wz.getByTestId('editor-field').count(), 2, '서명·글자 칸');
  await owner.screenshot({ path: `${SHOTS}/271-contract-editor.png` });
  await next.click();
  await wz.getByTestId('contract-review').waitFor();
  await wz.getByTestId('contract-send').click();
  const sent = owner.getByTestId('contract-sent'); await sent.waitFor();
  const link = (await sent.locator('code').first().innerText()).trim(), code = (await sent.getByTestId('sent-code').first().innerText()).trim();
  assert.match(link, /\/sign\/[A-Za-z0-9_-]+$/); assert.match(code, /^\d{6}$/);
  // 받은 사람 화면(로그인 없이)
  const token = link.split('/sign/')[1];
  const v = await (await fetch(`${BASE}/api/sign/${token}/view`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ code }) })).json();
  const textId = v.doc.fields.find((f) => f.mine && f.type === 'text').id;
  const sp = await owner.context().newPage();
  await sp.setViewportSize({ width: 390, height: 844 });
  await sp.goto(`${BASE}/sign/${token}`);
  await sp.getByTestId('sign-code').fill(code); await sp.getByTestId('sign-open').click();
  const dp = sp.getByTestId('sign-doc-page').first(); await dp.waitFor(); await dp.locator('img').first().waitFor();
  assert.equal(await sp.getByTestId('sign-field-mine').count(), 2);
  await sp.locator(`[data-field="${textId}"]`).click();
  await sp.getByTestId('sign-text').fill('서울시 강남구 E2E로 1');
  const pad = sp.getByTestId('sign-panel').locator('canvas').first(); await pad.scrollIntoViewIfNeeded();
  const cb = await pad.boundingBox();
  await sp.mouse.move(cb.x + cb.width * 0.2, cb.y + cb.height * 0.6); await sp.mouse.down();
  await sp.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.3, { steps: 5 }); await sp.mouse.move(cb.x + cb.width * 0.8, cb.y + cb.height * 0.6, { steps: 5 }); await sp.mouse.up();
  await sp.getByTestId('sign-agree').check();
  await sp.screenshot({ path: `${SHOTS}/272-contract-sign-390.png` });
  await sp.getByTestId('sign-submit').click();
  await sp.getByTestId('sign-done').waitFor();
  const [c] = await sql`select status, final_sha256 from contracts where title = 'E2E 용역 계약서' order by created_at desc limit 1`;
  assert.equal(c.status, 'completed'); assert.ok(c.final_sha256);
  await sp.close();
}
