// #516 승인함 '시안 없음'(+#544 초안 보관 묶음·[승인 요청]): 시안 없는 승인 대기 글은 '승인할 시안' 수에서 빠지고 빨간 묶음 · 카드 빨간 띠 '시안 없음 — 글만으로는 승인할 수 없습니다' · [승인] 없음
// · [지금 만들기] → 서버가 그려 붙임(크레딧 0) → 승인할 시안으로 올라가 [승인]·[AI 이미지로 다시 · 약 6.5크레딧] (구조 시험 — 운영 사진 고르기·그림 품질은 실제 화면에서)
import assert from 'node:assert/strict';

export async function mktVisual({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 시안 브랜드' })).id;
  await sql`update mkt_brands set color = '#0F766E' where id = ${brand}`;
  const [{ tenant }] = await sql`select tenant from mkt_brands where id = ${brand}`; const created_by = ctx.ownerId;
  // 운영 10/24 상황: 자동 제작이 글만 만들고 이미지 제작 카드를 연 채 승인 대기
  const [ac] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, brand_id, quality)
    values (${tenant}, 'E2E 시안 없는 자동 글', 'instagram', 'feed', now() + interval '2 days', 'pending', 1, ${created_by}, true, now(), ${brand}, ${sql.json({ passed: true, issues: [] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${ac.id}, 1, '입주민 예약 문의, 아직 전화로 받으세요?\n한 화면에서 정리하세요.', ${[]}, 'AI 자동 제작', ${created_by})`;
  await sql`insert into mkt_production_requests (tenant, content_id, version, kind, brief, est_credits, status) values (${tenant}, ${ac.id}, 1, 'image', '실사', 0, 'open')`;
  const manual = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E 시안 없는 손 글', channel: 'facebook', brandId: brand, body: '사진을 아직 안 붙인 글', mediaIds: [] });

  await owner.setViewportSize({ width: 1366, height: 1300 });
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-approvable-count').waitFor();
  const tabs = owner.getByTestId('mkt-brand-tabs');
  if (await tabs.waitFor({ timeout: 5000 }).then(() => true, () => false)) await tabs.getByRole('button', { name: /^E2E 시안 브랜드/ }).click(); // 탭은 자료가 온 뒤 그려짐(바로 보면 없을 수 있음)
  assert.match(await owner.getByTestId('mkt-approvable-count').innerText(), /승인할 시안 0건/, '시안 없는 글은 승인할 시안 수에서 뺌');
  const group = owner.getByTestId('mkt-no-visual');
  await group.waitFor();
  assert.match(await group.locator(':scope > summary').innerText(), /시안 없음 — 시안을 붙여야 승인할 수 있습니다 2건/);
  const card = group.getByTestId('approval-card').filter({ hasText: 'E2E 시안 없는 자동 글' });
  await card.getByTestId('approval-no-media-band').waitFor();
  assert.equal(await card.getByTestId('approval-no-media').getAttribute('data-blocked'), 'true');
  assert.equal(await card.getByTestId('card-approve').count(), 0, '글만으로는 [승인] 없음');
  await card.getByTestId('card-changes').waitFor(); // 수정 요청은 그대로
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${SHOTS}/243-approval-no-visual.png` });
  // [지금 만들기] → 서버 그리기 → 승인할 시안으로
  await card.getByTestId('approval-make-visual').click();
  const ready = owner.getByTestId('approval-card').filter({ hasText: 'E2E 시안 없는 자동 글' });
  await ready.getByTestId('card-approve').waitFor({ timeout: 30000 });
  assert.equal(await ready.getByTestId('approval-no-media').count(), 0);
  await ready.getByRole('button', { name: '시안 1 크게 보기' }).waitFor();
  assert.ok(await ready.getByRole('button', { name: '시안 1 크게 보기' }).locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), '그린 시안이 보임');
  assert.match(await ready.getByTestId('card-ai-image').innerText(), /AI 이미지로 다시 · 약 6\.5크레딧/);
  assert.match(await owner.getByTestId('mkt-approvable-count').innerText(), /승인할 시안 1건/);
  assert.match(await owner.getByTestId('mkt-no-visual').locator(':scope > summary').innerText(), /1건/, '손 글은 아직 시안 없음');
  await ready.scrollIntoViewIfNeeded();
  await ready.screenshot({ path: `${SHOTS}/244-approval-visual-made.png` });
  const [v] = await sql`select c.current_version, c.status, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${ac.id}`;
  assert.deepEqual([v.current_version, v.status, v.media_ids.length], [2, 'pending', 1]);
  assert.match(v.note, /^시안 그리기\(서버·크레딧 0\)/);
  assert.equal((await sql`select status from mkt_production_requests where content_id = ${ac.id}`)[0].status, 'canceled', '열린 이미지 카드는 서버 그리기로 대체');
  // 손 글(페이스북)도 [지금 만들기] 가능
  await owner.getByTestId('mkt-no-visual').getByTestId('approval-card').filter({ hasText: 'E2E 시안 없는 손 글' }).getByTestId('approval-make-visual').waitFor();
  assert.ok(manual.id);
  // #516 후속(로컬 10/24 글자 겹침): 서버가 그린 시안은 [브랜드 색으로 다시 그리기](무료) — 새 버전, 그대로 승인 대기
  const redraw = owner.getByTestId('approval-card').filter({ hasText: 'E2E 시안 없는 자동 글' }).getByTestId('card-redraw');
  assert.equal(await redraw.innerText(), '브랜드 색으로 다시 그리기');
  await redraw.click();
  let w;
  for (let i = 0; i < 80; i++) { [w] = await sql`select c.current_version, c.status, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${ac.id}`; if (w.current_version === 3) break; await owner.waitForTimeout(250); }
  assert.deepEqual([w.current_version, w.status], [3, 'pending']);
  assert.match(w.note, /^시안 다시 그리기\(서버·크레딧 0\)/);
  await owner.getByTestId('approval-card').filter({ hasText: 'E2E 시안 없는 자동 글' }).getByTestId('card-approve').waitFor();
  // 로컬 10/24 09:00: 옮길 날짜가 없어 멈춘 글은 취소하지 않고 '미뤄진 글' 묶음 → [날짜 골라 다시 올리기] = 승인 대기로
  const from = new Date(Date.now() - 20 * 3600e3);
  await sql`update mkt_contents set status = 'hold', scheduled_at = null, quality = quality || ${sql.json({ postponed: { from: from.toISOString(), at: new Date().toISOString() } })} where id = ${ac.id}`;
  await owner.reload();
  const row = owner.getByTestId('mkt-postponed').getByTestId('mkt-postponed-row').filter({ hasText: 'E2E 시안 없는 자동 글' });
  await row.waitFor();
  assert.match(await owner.getByTestId('mkt-postponed').locator('summary').innerText(), /미뤄진 글 — 옮길 날짜가 없어 멈춘 글 1건\(취소 아님\)/);
  assert.match(await row.innerText(), /원래 .* 게시/);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 2 * 86400e3));
  await row.getByTestId('mkt-postponed-date').fill(day);
  await row.getByTestId('mkt-postponed-time').fill('12:30');
  await row.getByTestId('mkt-postponed-reschedule').click();
  await owner.getByTestId('mkt-postponed').waitFor({ state: 'detached' });
  const [back] = await sql`select status, (scheduled_at at time zone 'Asia/Seoul')::text as at, quality->'postponed' as p from mkt_contents where id = ${ac.id}`;
  assert.deepEqual([back.status, back.at.slice(0, 16), back.p], ['pending', `${day} 12:30`, null]);
  await owner.getByTestId('approval-card').filter({ hasText: 'E2E 시안 없는 자동 글' }).first().waitFor();
  // #544(대표 10/24): 브랜드 템플릿 전 정기 자동 시안 = 초안 보관 — 승인 숫자·예정(초안)과 따로 접힌 '초안 보관' 묶음, 바로 [승인] 없음 → [승인 요청] = 승인 대기
  const [v3] = await sql`select media_ids from mkt_versions where content_id = ${ac.id} and version = 3`;
  const [hc] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, brand_id, quality)
    values (${tenant}, 'E2E 초안 보관 자동 글', 'instagram', 'feed', now() + interval '3 days', 'draft', 1, ${created_by}, true, now(), ${brand}, ${sql.json({ passed: true, issues: [], held: { at: new Date().toISOString(), reason: 'template' } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${hc.id}, 1, '관리사무소 공지, 아직 종이로 붙이세요?', ${v3.media_ids}, 'AI 자동 제작', ${created_by})`;
  await owner.reload();
  const held = owner.getByTestId('mkt-held');
  await held.waitFor();
  assert.match(await held.locator(':scope > summary').innerText(), /^초안 보관 — 브랜드 템플릿 준비 전 자동 시안 1건\(승인함에 올리지 않음\)$/);
  assert.equal(await owner.getByTestId('mkt-draft').filter({ hasText: 'E2E 초안 보관 자동 글' }).count(), 0, '예정(초안) 묶음과 따로');
  await held.locator(':scope > summary').click();
  const hrow = held.getByTestId('mkt-held-row').filter({ hasText: 'E2E 초안 보관 자동 글' });
  await hrow.getByTestId('approval-card').waitFor();
  assert.equal(await hrow.getByTestId('card-approve').count(), 0, '초안은 바로 승인 없음');
  await hrow.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/225-mkt-held.png` });
  await hrow.getByTestId('mkt-held-submit').click();
  await owner.getByText('승인 요청했습니다 — 승인 대기로 올렸습니다').waitFor();
  await held.waitFor({ state: 'detached' });
  assert.equal((await sql`select status from mkt_contents where id = ${hc.id}`)[0].status, 'pending');
}
