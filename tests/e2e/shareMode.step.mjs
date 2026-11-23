// #1129(대표 11/23) 자료실 › [공개 방식]: 보기는 누구나 · 대표만 바꿈(영향 건수 미리 보기 → 확인) → 회사 전체 공유면 다른 지점 직원도 업무를 봄
// → 업무 상세 '공개 범위' = 이 부서·팀만이면 다시 안 보임 → 부서·팀별로 되돌림(뒤 시험에 영향 없게 늘 되돌림)
import assert from 'node:assert/strict';
import { Client } from '../helpers.mjs';

export async function shareMode({ owner, ctx, sql, BASE, SHOTS }) {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '판교 현장 비품 정리(공개 시험)', assigneeId: ctx.staffB.id, orgUnitId: ctx.siteB })).id;
  // 보는 사람: 이 단계에서 새로 만든 강남점 직원(앞 단계에서 직원 A 는 격리 팀 구성원이 되어 회사 전체 공유로도 넓어지지 않음 — 그것도 확인)
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'e2e-share1129@dagym.test', name: '공개시험직원', role: 'staff', orgUnitIds: [ctx.siteA] });
  const viewer = new Client('share1129');
  await viewer.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'share1129-pass-1234', ai: true });
  try {
    assert.equal((await viewer.req('GET', `/api/tasks/${t}`)).status, 404, '기본(부서·팀별): 다른 지점 직원은 못 봄');
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(BASE + '/library');
    await owner.getByTestId('share-mode-open').click();
    const dlg = owner.getByTestId('share-mode-dialog'); await dlg.waitFor();
    assert.match(await owner.getByTestId('share-mode-open').innerText(), /공개 방식: 부서·팀별/);
    await dlg.getByTestId('share-mode-company').click();
    await dlg.getByTestId('share-mode-preview').waitFor();
    assert.match(await dlg.getByTestId('share-mode-preview').innerText(), /업무 \d+건/);
    await owner.screenshot({ path: `${SHOTS}/1129-share-mode.png` });
    await dlg.getByTestId('share-mode-save').click();
    await owner.getByTestId('confirm-ok').click();
    await owner.waitForFunction(() => /회사 전체 공유/.test(document.querySelector('[data-testid="share-mode-open"]')?.textContent ?? ''));
    // 직원 A: 다른 지점 업무가 보임(보기만) — 안 보이면 업무의 부서·팀과 격리 여부를 함께 보여 줌
    const seen = await viewer.req('GET', `/api/tasks/${t}`);
    if (seen.status !== 200) {
      const diag = await sql`select t.team_id, tm.name, tm.isolated, tm.archived, t.org_unit_id, t.share, (select share_mode from tenants where id = 'default') mode
        from tasks t left join teams tm on tm.id = t.team_id where t.id = ${t}`;
      assert.fail(`회사 전체 공유인데 새 직원이 못 봄(${seen.status}) ${JSON.stringify(diag[0])}`);
    }
    const iso = (await sql`select exists (select 1 from team_members m join teams x on x.id = m.team_id where m.user_id = ${ctx.staffA.id} and x.isolated and not x.archived) as v`)[0].v;
    if (iso) assert.equal((await ctx.staffA.client.req('GET', `/api/tasks/${t}`)).status, 404, '격리 팀 구성원(직원 A)은 회사 전체 공유로도 넓어지지 않음');
    assert.equal(seen.body.perms?.edit ?? false, false, '보기만(고치기 없음)');
    // 업무 상세 '공개 범위' = 이 부서·팀만 → 직원 A 는 다시 못 봄
    await owner.goto(`${BASE}/?task=${t}`);
    const sel = owner.getByTestId('global-task-panel').getByTestId('detail-share'); await sel.waitFor();
    await sel.selectOption('team');
    await owner.waitForFunction(async (id) => (await fetch(`/api/tasks/${id}`).then((r) => r.json())).task?.share === 'team', t);
    assert.equal((await viewer.req('GET', `/api/tasks/${t}`)).status, 404, '이 업무만 부서·팀');
  } finally {
    await ctx.owner.req('PUT', '/api/org/share-mode', { mode: 'team' });
  }
  assert.equal((await ctx.owner.ok('GET', '/api/org/share-mode')).mode, 'team');
}
