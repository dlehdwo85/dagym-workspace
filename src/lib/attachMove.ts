import type { Sql } from './db';

/** 332차(대표 11/02 16:1x ⑤ — 업무를 합치면서 같은 공고문이 한 업무에 둘): 업무를 합칠 때 첨부를 옮기되 같은 파일(같은 저장 파일 · 같은 이름·크기 · 같은 링크)은 하나만.
 *  겹치는 것은 (휴지통으로 가는) 원래 업무에 그대로 둔다 — 되살리면 그대로 보임 */
export async function moveAttachmentsDedupe(sql: Sql, fromIds: string[], toId: string): Promise<{ moved: number; skipped: number }> {
  let moved = 0, skipped = 0;
  for (const from of fromIds) {
    if (from === toId) continue;
    const r = await sql`update attachments a set task_id = ${toId} where a.task_id = ${from} and a.deleted_at is null
      and not exists (select 1 from attachments k where k.task_id = ${toId} and k.deleted_at is null and k.id <> a.id
        and ((k.storage_key is not null and k.storage_key = a.storage_key)
          or (k.kind = 'file' and a.kind = 'file' and k.file_name = a.file_name and k.size_bytes is not distinct from a.size_bytes)
          or (k.kind = 'link' and a.kind = 'link' and k.url = a.url)))`;
    moved += r.count;
    const [left] = await sql<{ n: number }[]>`select count(*)::int as n from attachments where task_id = ${from} and deleted_at is null`;
    skipped += left.n;
  }
  return { moved, skipped };
}
