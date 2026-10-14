// V20 업무 월별 보관·이월: 이월 표시·이월만 보기, 완료 칩 = 이번 달만 펼침·지난달은 펼칠 때 불러오기·달 이동, 리포트 월별 기록
import assert from 'node:assert/strict';
export async function v20({ owner, ctx, sql, BASE, SHOTS, tick }) {
  const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
  const ym = kst(new Date()).slice(0, 7);
  const prev = (() => { const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const carry = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V20 이월 업무', assigneeId: ctx.ownerId, dueDate: `${prev}-15`, approvalRequired: false })).id;
  const old = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V20 지난달 완료', assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await ctx.owner.ok('PATCH', `/api/tasks/${old}`, { status: 'done' });
  await sql`update tasks set completed_at = ${`${prev}-20T12:00:00+09:00`} where id = ${old}`;
  // 이월 표시 + 이월만 보기
  await owner.goto(BASE + '/tasks');
  const row = owner.locator(`[data-row="${carry}"]`);
  await row.waitFor();
  assert.equal((await row.getByTestId('carried').innerText()).trim(), `이월 · ${Number(prev.slice(5))}월부터`);
  await owner.getByRole('button', { name: /필터/ }).first().click();
  await owner.getByTestId('filter-carried').check();
  await owner.locator('[data-row]').first().waitFor();
  const shown = await owner.locator('[data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')));
  assert.ok(shown.includes(carry), '이월 업무 보임');
  assert.ok((await owner.locator('[data-row] [data-testid="carried"]').count()) === shown.length, '이월만 보기 = 모두 이월 표시');
  await owner.getByTestId('filter-carried').uncheck();
  // 완료 칩: 이번 달만 펼침, 지난달은 접힘 → 펼칠 때만 그 달 요청
  const asked = [];
  owner.on('request', (r) => { const u = r.url(); if (u.includes('doneMonth=')) asked.push(new URL(u).searchParams.get('doneMonth')); });
  await owner.getByTestId('done-chip').getByRole('button').click();
  const groups = owner.getByTestId('task-groups');
  await groups.locator(`[data-done-month="${ym}"][data-open="1"]`).waitFor();
  const prevSec = groups.locator(`[data-done-month="${prev}"]`);
  await prevSec.waitFor();
  assert.equal(await prevSec.getAttribute('data-open'), null, '지난달은 접힘');
  assert.ok(!asked.includes(prev), '접힌 달은 아직 안 불러옴');
  await prevSec.getByRole('button', { expanded: false }).first().click();
  await prevSec.getByText('V20 지난달 완료').waitFor();
  assert.ok(asked.includes(prev), '펼칠 때 그 달만 불러옴');
  await owner.getByTestId('done-month-nav').getByRole('button', { name: '이전 달' }).click();
  await owner.getByTestId('done-month-nav').getByText(`${prev.slice(0, 4)}년 ${Number(prev.slice(5))}월`).waitFor();
  await owner.screenshot({ path: `${SHOTS}/v20-done-archive.png` });
  await owner.getByTestId('done-chip').getByRole('button').click(); // 해제
  // 월 마감 기록 → 리포트
  await tick();
  await owner.goto(`${BASE}/reports?month=${prev}`);
  const mc = owner.getByTestId('month-closes');
  await mc.locator(`[data-month-row="${prev}"]`).waitFor(); // 회사 전체 행(담당자별은 누르면 펼침 — 숫자는 API 시험에서 검증)
  await owner.screenshot({ path: `${SHOTS}/v20-month-close.png`, fullPage: true });
  // 뒤 단계(순서 끌기 시험)에 영향 없게 이 단계 업무 정리
  for (const id of [carry, old]) await ctx.owner.ok('DELETE', `/api/tasks/${id}`);
}
