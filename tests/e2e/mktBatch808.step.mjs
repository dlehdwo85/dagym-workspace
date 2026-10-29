// 270차 #808(대표 10/29 '11월 3일(화) 게시 4건 · 11월 6일(금) 게시 4건'): 승인함 주 단위 묶음 칸 안을 게시 날짜(서울)별 머리줄로 — 날짜마다 건수·승인 수
import assert from 'node:assert/strict';

export async function mktBatch808({ owner, ctx, sql, BASE }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E808 바디랩' })).id;
  // 다음 주 월요일(서울) → 화 10:00 2건 · 금 10:00 2건
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const dow = new Date(`${today}T12:00:00+09:00`).getUTCDay();
  const mon = new Date(Date.parse(`${today}T12:00:00+09:00`) + (((8 - dow) % 7) || 7) * 864e5).toISOString().slice(0, 10);
  const at = (plus, hh) => new Date(Date.parse(`${mon}T${hh}:00:00+09:00`) + plus * 864e5);
  const ids = [];
  for (const [plus, hh, st] of [[1, '10', 'pending'], [1, '13', 'approved'], [4, '10', 'pending'], [4, '13', 'pending']]) {
    const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, quality, auto)
      values ('default', ${brand}, ${`E2E808 ${plus}-${hh}`}, 'instagram', 'feed', ${at(plus, hh)}, ${st}, 1, ${sql.json({ batch: { week: mon, status: 'released', released: true } })}, true) returning id`;
    await sql`insert into mkt_versions (content_id, version, body) values (${c.id}, 1, '시험 본문')`;
    ids.push(c.id);
  }
  try {
    await owner.goto(`${BASE}/s/marketing/approvals`);
    const box = owner.getByTestId('mkt-batch-box').filter({ hasText: 'E2E808' }).first();
    await box.waitFor({ timeout: 30_000 });
    const heads = await box.getByTestId('mkt-batch-day-head').allInnerTexts();
    const md = (plus) => { const d = at(plus, '10'); const k = new Date(d.getTime() + 9 * 3600e3); return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`; };
    assert.equal(heads.length, 2, heads.join(' / '));
    assert.match(heads[0], new RegExp(`^${md(1)}\\(화\\) 게시 2건 · 승인 1/2$`));
    assert.match(heads[1], new RegExp(`^${md(4)}\\(금\\) 게시 2건 · 승인 0/2$`));
    assert.match(await box.getByTestId('mkt-batch-days').innerText(), new RegExp(`${md(1)}\\(화\\) 2건 · ${md(4)}\\(금\\) 2건`));
  } finally {
    await sql`delete from mkt_contents where id = any(${ids}::uuid[])`;
  }
}
