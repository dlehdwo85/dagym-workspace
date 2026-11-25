// #1181 상업화 마감 3번: 영업 › 데이터 설정 '내 수집 원천' — 원천 줄(상태·글 수) · 최근 글 · [업무로] (원천·글은 시험 자료로 넣음 — 받기 자체는 API 시험 sales-watch-1181)
import assert from 'node:assert/strict';

export async function watch1181({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const [s] = await sql`insert into sales_watch_sources (tenant, label, url, words, status, last_checked_at, last_ok_at, created_by) values ('default', 'E2E 협회 게시판', 'https://example.test/board', ${['모집']}, 'ok', now(), now(), ${ctx.ownerId}) returning id`;
  await sql`insert into sales_watch_items (tenant, source_id, title, url, posted_date) values ('default', ${s.id}, 'E2E 회원사 모집 안내', 'https://example.test/post/1', current_date), ('default', ${s.id}, 'E2E 유지보수 업체 모집', 'https://example.test/post/2', current_date - 1)`;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/sources`);
    const box = owner.getByTestId('sales-watch'); await box.waitFor({ timeout: 20000 });
    assert.match(await box.getByTestId('sales-watch-source').first().innerText(), /E2E 협회 게시판[\s\S]*연결됨[\s\S]*글 2/);
    assert.equal(await box.getByTestId('sales-watch-item').count(), 2);
    await box.scrollIntoViewIfNeeded(); await box.screenshot({ path: `${SHOTS}/1181-watch-sources.png` });
    await box.getByTestId('sales-watch-item').filter({ hasText: 'E2E 유지보수 업체 모집' }).getByTestId('sales-watch-task').click();
    await box.getByText('업무 열기').first().waitFor({ timeout: 15000 });
    const [it] = await sql`select task_id from sales_watch_items where title = 'E2E 유지보수 업체 모집'`; assert.ok(it.task_id, '업무로 만들어짐');
  } finally { await sql`delete from sales_watch_sources where id = ${s.id}`; }
}
