// 상용화 B4 회사 전체 내보내기 화면: 설정 › 회사 전체 내보내기 → [내보내기 요청] → '준비됨' → [압축 파일 내려받기] = .zip
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function companyExport({ owner, sql, BASE, SHOTS }) {
  await sql`delete from company_exports where tenant = 'default'`; // 하루 한 번 제한 — 앞선 실행 기록 지움(시험 DB)
  await owner.setViewportSize({ width: 1280, height: 900 });
  await owner.goto(`${BASE}/settings#company-export`);
  const sec = owner.getByTestId('company-export');
  await sec.waitFor();
  await sec.getByTestId('company-export-request').click();
  await sec.getByTestId('company-export-list').waitFor();
  const [{ id }] = await sql`select id from company_exports where tenant = 'default' order by created_at desc limit 1`;
  for (let i = 0; i < 60 && (await sql`select status from company_exports where id = ${id}`)[0].status !== 'done'; i++) await owner.waitForTimeout(500);
  assert.equal((await sql`select status from company_exports where id = ${id}`)[0].status, 'done');
  await owner.reload();
  const dl = sec.getByTestId('company-export-dl-1');
  await dl.waitFor();
  const doneText = await sec.getByTestId('company-export-done').innerText();
  assert.match(doneText, /준비됨[\s\S]*\d+\. \d+\.[^·]*까지/); assert.ok(!/NaN|undefined/.test(doneText), doneText);
  assert.ok(((await sec.boundingBox())?.y ?? 9999) < 900, '#company-export 링크로 들어오면 그 칸이 보임');
  await sec.screenshot({ path: `${SHOTS}/b4-company-export.png` });
  const [file] = await Promise.all([owner.waitForEvent('download'), dl.click()]);
  // 로컬 저장소 주소는 내려받기 이름이 'download' 로 보일 수 있음(attach332 와 같음) — 운영(R2)은 서명에 이름을 넣음. 내용으로 확인
  assert.ok(/전체 내보내기-\d{8}\.zip$/.test(file.suggestedFilename()) || file.suggestedFilename() === 'download', file.suggestedFilename());
  const buf = await readFile(await file.path());
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'zip');
  assert.ok(buf.includes(Buffer.from('읽어 주세요.txt')) && buf.includes(Buffer.from('자료/업무.csv')), '압축 안 목록');
}
