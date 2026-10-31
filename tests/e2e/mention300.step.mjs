// 300차 #851(로컬 10/31 16:40 대표 요청): 댓글 @멘션은 입력창 자동완성 하나로 — 아래 '멘션할 사람' 고르기 없음 · 첫 줄 기본 선택 · ↑↓ · Enter·Tab 으로 고름
// · '@전체' = 이 업무를 볼 수 있는 사람 모두(서버가 멘션 알림) · 안내 '@로 사람 부르기'
import assert from 'node:assert/strict';

export async function mention300({ owner, ctx, sql, BASE }) {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 멘션 자동완성', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
  const people = (await ctx.owner.ok('GET', `/api/tasks/${t.id}/mentionable`)).users.filter((u) => u.id !== ctx.ownerId);
  assert.ok(people.length >= 2, `멘션 후보 ${people.length}명`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  const input = owner.getByTestId('task-page').getByTestId('comment-input');
  await input.waitFor();
  assert.equal(await owner.getByLabel('멘션할 사람').count(), 0, "아래 '멘션할 사람' 고르기 없음");
  await owner.getByTestId('mention-hint').getByText(/@로 사람 부르기/).waitFor();
  assert.match(await input.getAttribute('placeholder'), /@로 사람 부르기/);
  // '@' → 목록(맨 위 @전체, 첫 줄 기본 선택) → ↓ → Enter = 두 번째 사람
  await input.click(); await input.pressSequentially('확인 부탁 @');
  const list = owner.getByTestId('mention-suggest');
  await list.waitFor();
  const opts = list.getByRole('option');
  assert.match(await opts.first().innerText(), /@전체/);
  assert.equal(await opts.first().getAttribute('aria-selected'), 'true', '첫 줄 기본 선택');
  await input.press('ArrowDown');
  assert.equal(await opts.nth(1).getAttribute('aria-selected'), 'true');
  const second = await opts.nth(1).innerText();
  await input.press('Enter');
  await list.waitFor({ state: 'detached' });
  const got = /@(\S+) $/.exec(await input.inputValue())?.[1];
  assert.ok(got && got !== '전체' && people.some((p) => p.name === got) && second.includes(got), `고른 이름이 입력창에(Enter 는 등록이 아님): ${await input.inputValue()} / ${second}`);
  // '@전' → Tab = @전체
  await input.pressSequentially('@전');
  await list.waitFor();
  await input.press('Tab');
  assert.match(await input.inputValue(), /@전체 $/);
  // Esc = 목록만 닫힘
  await input.pressSequentially('@');
  await list.waitFor();
  await input.press('Escape');
  await list.waitFor({ state: 'detached' });
  await owner.getByTestId('task-page').getByTestId('comment-input').press('Control+Enter');
  await owner.getByTestId('task-page').getByTestId('comments').getByText(/확인 부탁/).first().waitFor();
  const [c] = await sql`select mentions from comments where task_id = ${t.id} order by created_at desc limit 1`;
  assert.equal(new Set(c.mentions).size, people.length, `@전체 = 볼 수 있는 ${people.length}명 모두 멘션(${c.mentions.length})`);
  const n = await sql`select count(distinct user_id)::int as n from notifications where type = 'mention' and entity_id = ${t.id}`;
  assert.equal(n[0].n, people.length, '멘션 알림도 모두');
}
