// #535 대표 10/24 08:05 '승인 대기 상세를 보고 뒤로가기 → 마케팅 홈': 상세를 열면 ?c=<id> 가 방문 기록에 남고 뒤로가기는 상세만 닫음(승인함 그대로)
// · 닫기 단추 = 남긴 기록을 되돌림(뒤로가기 두 번 필요 없음) · 링크로 바로 연 상세의 닫기 = ?c 만 지움 · 콘텐츠 캘린더(주 보기) 상세도 같음 — 휴대폰 390폭
import assert from 'node:assert/strict';

export async function backClose({ owner, ctx, BASE }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brandId = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 뒤로가기 브랜드' })).id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const a = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E 뒤로가기 승인 글', channel: 'facebook', brandId, body: '뒤로가기 시험 본문', mediaIds: [], scheduledAt: new Date(Date.now() + 26 * 3600e3).toISOString() });
  const b = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E 뒤로가기 캘린더 글', channel: 'facebook', brandId, body: '캘린더 시험 본문', mediaIds: [], scheduledAt: `${today}T12:00:00+09:00` });
  const path = () => new URL(owner.url()).pathname;
  const param = () => new URL(owner.url()).searchParams.get('c');
  const detail = owner.getByTestId('mkt-detail');

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing`); // 대표 순서: 마케팅 홈 → 승인함 → 상세 → 뒤로가기
  await owner.goto(`${BASE}/s/marketing/approvals`);
  const row = () => owner.getByTestId('approval-card').filter({ hasText: 'E2E 뒤로가기 승인 글' }).getByTestId('mkt-row');
  await row().click();
  await detail.waitFor();
  assert.equal(param(), a.id, '열면 ?c=<id> 기록');
  await owner.goBack();
  await detail.waitFor({ state: 'hidden' });
  assert.deepEqual([path(), param()], ['/s/marketing/approvals', null], '뒤로가기 = 상세만 닫힘(승인함 그대로)');
  await owner.getByTestId('mkt-approvals').waitFor();
  // 닫기 단추: 남긴 기록을 되돌림 → 다음 뒤로가기는 바로 마케팅 홈
  await row().click();
  await detail.waitFor();
  await owner.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await detail.waitFor({ state: 'hidden' });
  await owner.waitForFunction(() => !new URL(location.href).searchParams.has('c'));
  assert.equal(path(), '/s/marketing/approvals');
  await owner.goBack();
  await owner.waitForURL((u) => u.pathname === '/s/marketing');
  // 링크로 바로 연 상세(알림 등): 닫기 = ?c 만 지우고 승인함에 남음
  await owner.goto(`${BASE}/s/marketing/approvals?c=${a.id}`);
  await detail.waitFor();
  await owner.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await detail.waitFor({ state: 'hidden' });
  await owner.waitForFunction(() => !new URL(location.href).searchParams.has('c'));
  assert.equal(path(), '/s/marketing/approvals');
  // 콘텐츠 캘린더(주 보기) 상세도 같음
  await owner.goto(`${BASE}/s/marketing/calendar`);
  await owner.getByTestId('mkt-week-card').filter({ hasText: 'E2E 뒤로가기 캘린더 글' }).first().locator('button').first().click();
  await detail.waitFor();
  assert.equal(param(), b.id);
  await owner.goBack();
  await detail.waitFor({ state: 'hidden' });
  assert.deepEqual([path(), param()], ['/s/marketing/calendar', null], '캘린더도 뒤로가기 = 상세만 닫힘');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
