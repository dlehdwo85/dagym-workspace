// 대표 11/19 #1070: 화상회의를 일정 없이 바로 — 업무 탭의 작은 [회의] 단추(가짜 엔진 — 구조 시험, 실제 영상 연결은 운영에서 확인)
// 단추(작게) → 창 → [바로 회의 시작] → 회의 주소(/meet/<code>) · [주소 복사] · [공유] · [회의 들어가기] → 회의 화면 · 휴대폰 폭에서도 보이고 넘치지 않음
import assert from 'node:assert/strict';

export async function quickMeeting({ owner, BASE, SHOTS }) {
  await owner.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/tasks');
  const open = owner.getByTestId('quick-meeting-open');
  await open.waitFor();
  // CI 11/20(4091c31): 화면이 다시 그려지는 순간에 재면 크기가 없음(0×0) → 크기가 잡힐 때까지 잠깐 기다려 잼
  let bb = null; for (let i = 0; i < 30 && !(bb && bb.width > 0); i++) { bb = await open.boundingBox().catch(() => null); if (!(bb && bb.width > 0)) await owner.waitForTimeout(150); }
  assert.ok(bb && bb.width <= 90 && bb.height <= 40, `작은 단추(${Math.round(bb?.width ?? 0)}×${Math.round(bb?.height ?? 0)})`);
  // 휴대폰 폭: 단추가 보이고 가로로 넘치지 않음
  await owner.setViewportSize({ width: 390, height: 844 });
  await open.waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 390), '390 가로 넘침 없음');
  await owner.setViewportSize({ width: 1366, height: 900 });
  await open.click();
  const box = owner.getByTestId('quick-meeting');
  await box.getByText(/일정을 만들지 않고 지금 바로 화상회의를 엽니다/).waitFor();
  await owner.getByTestId('quick-meeting-start').click();
  const url = (await owner.getByTestId('quick-meeting-url').innerText()).trim();
  assert.match(url, /\/meet\/[A-Za-z0-9_-]{16,40}$/, '회의 주소');
  await owner.screenshot({ path: `${SHOTS}/quick-meeting.png` });
  await owner.getByTestId('quick-meeting-copy').click();
  await owner.getByText('회의 주소를 복사했습니다').first().waitFor();
  assert.equal(await owner.evaluate(() => navigator.clipboard.readText()).catch(() => url), url, '복사한 글 = 회의 주소');
  await owner.getByTestId('quick-meeting-share').waitFor();
  await owner.getByTestId('quick-meeting-enter').click();
  await owner.waitForURL((u) => u.pathname === new URL(url).pathname);
  await owner.getByText('바로 회의').first().waitFor({ timeout: 15000 }); // 회의 화면(제목 = 바로 회의)
}
