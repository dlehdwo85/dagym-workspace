// #192·#194 앱 1.1.3 웹 몫(브라우저에서 보이는 부분): 위젯 [+]·딥링크 /tasks?new=1 → 업무 등록 창(주소에서 new 지움) ·
// 브라우저에는 앱 전용 안내(전체화면 알람 허용)·문자 바로 첨부 문구가 없음 — 앱 동작은 로컬 실기기 확인
import assert from 'node:assert/strict';

export async function app113({ owner, BASE }) {
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/tasks?new=1`);
  await owner.getByRole('dialog', { name: '업무 등록' }).waitFor();
  await owner.waitForFunction(() => !new URLSearchParams(location.search).has('new'));
  assert.equal(new URL(owner.url()).pathname, '/tasks');
  await owner.keyboard.press('Escape');
  await owner.getByRole('dialog', { name: '업무 등록' }).waitFor({ state: 'hidden' });
  await owner.reload();
  await owner.waitForLoadState('networkidle');
  assert.equal(await owner.getByRole('dialog', { name: '업무 등록' }).count(), 0, '새로고침해도 다시 안 열림');
  // 이미 업무 화면일 때 위젯 [+](앱이 같은 화면에서 /tasks?new=1 로 이동) — Next 는 history.pushState 를 useSearchParams 에 반영
  await owner.evaluate(() => history.pushState(null, '', '/tasks?new=1'));
  await owner.getByRole('dialog', { name: '업무 등록' }).waitFor();
  await owner.keyboard.press('Escape');
  // 설정 › 알림: 전체화면 알람 안내는 1.1.3 안드로이드 앱에서만
  await owner.goto(`${BASE}/settings`);
  await owner.getByTestId('alarm-defaults').waitFor();
  assert.equal(await owner.getByTestId('alarm-fullscreen-notice').count(), 0);
  await owner.setViewportSize({ width: 1366, height: 900 });
}
