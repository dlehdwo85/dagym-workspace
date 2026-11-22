// #1113 'AI 티' 제거 — 주요 8화면을 390·768·1440 폭으로 찍어 고친 전/후 비교(SHOT_OUT 폴더, SHOT_TAG = before|after). 화면 검사는 하지 않고 사진만.
import { mkdirSync } from 'node:fs';

export async function shots1113({ owner, ctx, sql, BASE }) {
  const out = process.env.SHOT_OUT; if (!out) return;
  const tag = process.env.SHOT_TAG || 'shot'; mkdirSync(out, { recursive: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true }).catch(() => {});
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }).catch(() => {});
  let [t] = await sql`select id from tasks where deleted_at is null and parent_id is null order by created_at desc limit 1`;
  if (!t) t = await ctx.owner.ok('POST', '/api/tasks', { title: '1113 화면 사진용 업무', description: '설명' });
  const pages = [['home', '/'], ['tasks', '/tasks'], ['task', `/tasks/${t.id}`], ['approvals', '/approvals'], ['sales', '/s/sales'], ['marketing', '/s/marketing'], ['branch', '/branch-reports'], ['settings', '/settings']];
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    await owner.setViewportSize({ width: w, height: h });
    for (const [name, path] of pages) {
      await owner.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
      await owner.waitForTimeout(600);
      await owner.screenshot({ path: `${out}/${tag}-${name}-${w}.png`, fullPage: false });
    }
  }
  await owner.setViewportSize({ width: 1366, height: 900 });
}
