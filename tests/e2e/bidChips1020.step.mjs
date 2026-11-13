// 395차 #1020(대표 11/08 "할일 개수는 뺍니다 댓글과 첨부 표시만 표시 · 기존 업무들도 적용 · 현설 표기 요청"):
// 업무 줄에 '할 일 n/m'(체크리스트)·하위 업무 n/m 칩 없음 · 댓글 수는 그대로 · 입찰 업무 줄은 늘 현설 칩(일시·필수 / 없음 / 공고문 참조 / 확인 필요)
import assert from 'node:assert/strict';

export async function bidChips1020({ owner, ctx, sql, BASE }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const mk = async (title, bidInfo) => {
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ctx.ownerId, orgUnitId: ctx.hq, dueDate: ymd(9), approvalRequired: false, checklist: ['공고문 검토', '서류 준비'] })).id;
    await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: `e2e1020-${title}`, name: title, bid: true, ...(bidInfo === undefined ? {} : { bidInfo }) })} where id = ${id}`;
    return id;
  };
  const base = { v: 1, apt: true, deadline: `${ymd(9)}T17:00`, deadlineLabel: null, updatedAt: new Date().toISOString() };
  const ids = [
    await mk('E2E1020 현설 일시', { ...base, briefing: { kind: '필수', at: `${ymd(6)}T11:00:00+09:00`, place: null, required: true }, briefingNone: false }),
    await mk('E2E1020 현설 없음', { ...base, briefing: null, briefingNone: true }),
    await mk('E2E1020 공고문 참조', { ...base, briefing: { kind: '공고문 참조', at: null, place: null, required: false }, briefingNone: false }),
    await mk('E2E1020 옛 업무', undefined),
  ];
  await ctx.owner.ok('POST', `/api/tasks/${ids[0]}/comments`, { body: 'E2E1020 댓글' }).catch(() => {});
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/tasks?view=my&q=E2E1020`);
    const row = (t) => owner.locator('[data-row]').filter({ hasText: t }).first();
    await row('E2E1020 현설 일시').waitFor();
    const chip = async (t) => (await row(t).getByTestId('row-bid-briefing').innerText()).trim();
    const d = ymd(6); const md = `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
    assert.equal(await chip('E2E1020 현설 일시'), `현설 ${md} 11시 필수`);
    assert.equal(await chip('E2E1020 현설 없음'), '현설 없음');
    assert.equal(await chip('E2E1020 공고문 참조'), '현설 공고문 참조');
    assert.equal(await chip('E2E1020 옛 업무'), '현설 확인 필요', '고정 칸이 아직 없는 옛 입찰 업무도 칩');
    for (const t of ['E2E1020 현설 일시', 'E2E1020 현설 없음']) assert.equal(await row(t).locator('[title="체크리스트"], [title="하위 업무"]').count(), 0, `${t}: 할 일 개수 칩 없음`);
    assert.ok(!(await row('E2E1020 현설 없음').innerText()).includes('0/2'), '할 일 0/2 글자 없음');
  } finally {
    for (const id of ids) await ctx.owner.ok('DELETE', `/api/tasks/${id}`).catch(() => {});
  }
}
