// 183차 #177(로컬 10/23 · 대표 "비슷한 글은 하나만 남기고 나머지 삭제"): 승인함 '수정 요청·보류' 칸 [골라서 지우기] → 2건 체크 → [휴지통으로](확인 창) → 칸에서 빠짐 · 맨 아래 '휴지통 n건' 칸 → [되살리기] → 보류로 복귀
// · 상세 창 [휴지통으로] → 다시 열면 '휴지통에 있는 글' 띠 → [되살리기]
import assert from 'node:assert/strict';

export async function mktTrash({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }); // 단독 실행(E2E_ONLY)에서도 마케팅 공간 켜기
  const brands = (await ctx.owner.ok('GET', '/api/marketing/brands')).brands;
  const brand = brands[0] ?? (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 휴지통 브랜드' }));
  const ids = [];
  for (const t of ['휴지통 시험 보류 1', '휴지통 시험 보류 2', '휴지통 시험 보류 3']) ids.push((await ctx.owner.ok('POST', '/api/marketing/contents', { title: t, channel: 'instagram', brandId: brand.id, body: `${t} 본문입니다. 오늘도 좋은 하루 보내세요.` })).id);
  await sql`update mkt_contents set status = 'hold' where id = any(${ids}::uuid[])`;
  await owner.goto(`${BASE}/s/marketing/approvals?ops=1`);
  const waiting = owner.getByTestId('mkt-waiting');
  await waiting.waitFor();
  if (!(await waiting.evaluate((d) => d.open))) await waiting.locator('summary').click();
  await waiting.getByTestId('mkt-waiting-pick').click();
  for (const id of ids.slice(0, 2)) await waiting.locator(`[data-testid="mkt-waiting-check"][data-id="${id}"]`).check();
  assert.match(await waiting.getByTestId('mkt-waiting-bar').innerText(), /2건 고름/);
  await owner.screenshot({ path: `${SHOTS}/177-mkt-trash-pick.png` });
  owner.once('dialog', (d) => d.accept());
  await waiting.getByTestId('mkt-waiting-trash').click();
  await owner.getByText(/2건을 휴지통으로 옮겼습니다/).waitFor();
  const trash = owner.getByTestId('mkt-trash');
  await trash.waitFor();
  assert.match(await trash.locator('summary').innerText(), /휴지통 \d+건/);
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.deepEqual(ids.map((id) => list.contents.some((c) => c.id === id)), [false, false, true], '지운 2건은 승인함에서 빠지고 셋째는 남음');
  assert.ok(list.trash >= 2, `휴지통 건수 ${list.trash}`);
  await trash.locator('summary').click();
  const row1 = trash.getByTestId('mkt-trash-row').filter({ hasText: '휴지통 시험 보류 1' });
  await row1.waitFor();
  assert.match(await row1.innerText(), /보류였음[\s\S]*\d+일 남음/);
  await owner.screenshot({ path: `${SHOTS}/177-mkt-trash.png` });
  await row1.getByTestId('mkt-trash-restore').click();
  await owner.getByText(/되살렸습니다/).waitFor();
  const [r1] = await sql`select status, deleted_at from mkt_contents where id = ${ids[0]}`;
  assert.deepEqual([r1.status, r1.deleted_at], ['hold', null], '되살린 글은 보류로');
  // 상세 창 [휴지통으로] → 띠 → [되살리기]
  await owner.goto(`${BASE}/s/marketing/approvals?ops=1&c=${ids[2]}`);
  await owner.getByTestId('mkt-detail').waitFor();
  owner.once('dialog', (d) => d.accept());
  await owner.getByTestId('mkt-trash-one').click();
  await owner.getByText(/휴지통으로 옮겼습니다/).waitFor();
  const [r3] = await sql`select status, deleted_from, deleted_at from mkt_contents where id = ${ids[2]}`;
  assert.deepEqual([r3.status, r3.deleted_from, !!r3.deleted_at], ['canceled', 'hold', true]);
  await owner.goto(`${BASE}/s/marketing/approvals?ops=1&c=${ids[2]}`);
  await owner.getByTestId('mkt-trashed').waitFor();
  await owner.getByTestId('mkt-restore-one').click();
  await owner.getByText(/되살렸습니다/).waitFor();
  const [r3b] = await sql`select status, deleted_at from mkt_contents where id = ${ids[2]}`;
  assert.deepEqual([r3b.status, r3b.deleted_at], ['hold', null]);
}
