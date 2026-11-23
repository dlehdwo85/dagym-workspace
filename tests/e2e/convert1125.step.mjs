// #1125 2단계(대표 위임 11/23 — ② 브라우저 안 변환): 전자계약 1단계에 워드(.docx)·엑셀(.xlsx)을 올리면 이 브라우저 안에서 PDF 로 바꿔 올림 —
// 쪽 미리보기·'원본은 서버로 보내지 않음' 안내 · 서버로 가는 파일은 PDF(워드·엑셀 원본이 아님) · 칸 놓기 화면에 쪽이 보임
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function convert1125({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  const sent = []; // 서버(저장소)로 올라간 파일 — PDF 인지
  const onReq = (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/contracts/upload') sent.push(r.postDataJSON()); }; // 올리기 전 알림(이름·형식)
  owner.on('request', onReq);
  try {
    for (const [file, kind] of [['contract-sample.docx', 'docx'], ['contract-sample.xlsx', 'xlsx']]) {
      await owner.goto(`${BASE}/contracts`);
      await owner.getByTestId('contract-new').click();
      const wz = owner.getByTestId('contract-wizard'); await wz.waitFor();
      const before = sent.length;
      const srcRes = owner.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/contracts/source', { timeout: 60000 });
      await wz.getByTestId('contract-file').setInputFiles(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)));
      const box = wz.getByTestId('contract-converted'); await box.waitFor({ timeout: 60000 });
      const txt = await box.innerText();
      assert.match(txt, new RegExp(`${file.replace('.', '\\.')}[\\s\\S]*PDF (\\d+)쪽으로 바꿨습니다[\\s\\S]*서버로 보내지 않음`), txt);
      const pages = Number(txt.match(/PDF (\d+)쪽/)[1]);
      assert.ok(kind === 'docx' ? pages >= 2 : pages >= 1, `${kind} ${pages}쪽`);
      await wz.getByText(new RegExp(`contract-sample\\.pdf · ${pages}쪽`)).waitFor();
      assert.ok(await box.locator('img').count() >= 1, '쪽 미리보기');
      const up = sent.slice(before);
      assert.deepEqual(up.map((x) => [x.fileName, x.mime]), [['contract-sample.pdf', 'application/pdf']], '서버로는 PDF 만(원본 워드·엑셀은 안 감)');
      const { key } = await (await srcRes).json();
      const pdf = await owner.request.get(`${BASE}/api/contracts/source?key=${encodeURIComponent(key)}`);
      const body = await pdf.body(); assert.equal(body.subarray(0, 5).toString(), '%PDF-', '저장된 것도 PDF');
      if (process.env.CONVERT_OUT) writeFileSync(`${process.env.CONVERT_OUT}/converted-${kind}.pdf`, body);
      await owner.screenshot({ path: `${SHOTS}/1125-convert-${kind}.png` });
      if (kind === 'docx') { // 칸 놓기 화면에 바뀐 쪽이 그대로
        await wz.getByTestId('contract-title').fill('E2E 변환 근로계약서');
        await owner.getByTestId('wizard-next').click();
      }
    }
  } finally { owner.off('request', onReq); }
}
