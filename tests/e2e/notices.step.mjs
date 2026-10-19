// V30 ② 공지: 대표가 쓰기(중요·고정) → 직원 홈 "안 읽은 공지" 카드 → 열면 읽음 → 대표 읽음 현황(읽음 1 / 안 읽음 n) → [안 읽은 사람에게 다시 알림]
import assert from 'node:assert/strict';

export async function noticesFlow({ owner, staff, ctx, sql, BASE, SHOTS }) {
  await owner.goto(BASE + '/notices');
  await owner.getByTestId('notice-new').click();
  await owner.getByTestId('notice-title').fill('E2E 10월 전체 회의');
  await owner.getByTestId('notice-body').fill('10/25(토) 오전 10시 본사 회의실에서 전체 회의가 있습니다.');
  await owner.getByTestId('notice-important').check();
  await owner.getByTestId('notice-pinned').check();
  await owner.getByTestId('notice-save').click();
  await owner.getByText('공지를 올렸습니다').waitFor();
  await owner.getByTestId('notice-row').filter({ hasText: 'E2E 10월 전체 회의' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/126-notices.png` });
  const [n] = await sql`select id from announcements where title = 'E2E 10월 전체 회의'`;
  // 직원 홈 카드 → 열기 → 읽음
  await staff.goto(BASE + '/');
  const card = staff.getByTestId('home-notices');
  await card.waitFor();
  assert.match(await card.innerText(), /안 읽은 공지 \d+건/);
  await staff.screenshot({ path: `${SHOTS}/127-home-notice-card.png` });
  await card.getByText('E2E 10월 전체 회의').click();
  await staff.waitForURL(/\/notices\//);
  await staff.getByTestId('notice-detail-body').filter({ hasText: '전체 회의가 있습니다' }).waitFor();
  assert.equal((await sql`select count(*)::int c from announcement_reads where announcement_id = ${n.id} and user_id = ${ctx.staffA.id}`)[0].c, 1, '열면 읽음');
  assert.equal(await staff.getByTestId('notice-reads').count(), 0, '직원에게는 읽음 현황 없음');
  // 대표 읽음 현황 + 다시 알림
  await owner.goto(`${BASE}/notices/${n.id}`);
  const reads = owner.getByTestId('notice-reads');
  await reads.waitFor();
  await reads.getByTestId('notice-read-list').getByText('이직원').waitFor();
  const unread = await reads.getByTestId('notice-unread-list').locator('li').count();
  assert.ok(unread >= 2, `안 읽은 사람 ${unread}`);
  const n0 = (await sql`select count(*)::int c from notifications where type = 'announcement' and title like '[다시 알림]%'`)[0].c;
  await reads.getByTestId('notice-remind').click();
  await owner.getByText(/명에게 다시 알렸습니다/).waitFor();
  assert.ok((await sql`select count(*)::int c from notifications where type = 'announcement' and title like '[다시 알림]%'`)[0].c > n0);
  await owner.screenshot({ path: `${SHOTS}/128-notice-reads.png` });
  // 직원 목록: 읽은 공지는 점 없음, 안 읽음 탭 비어 있음
  await staff.goto(BASE + '/notices');
  assert.equal(await staff.getByTestId('notice-row').filter({ hasText: 'E2E 10월 전체 회의' }).getAttribute('data-read'), '1');
}
