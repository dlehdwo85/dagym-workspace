import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { loadAttachment } from '@/lib/attachments';
import { db } from '@/lib/db';
import { tenantOf } from '@/lib/types';

/** 332차(대표 11/02 16:1x ④ [자료실로]): 선택한 첨부를 자료실에 등록(이미 있으면 그대로 두고 그 폴더를 알려 줌) — 업무 첨부 자동 등록이 꺼진 회사도 사람이 고른 것은 등록 */
export const POST = handler(async ({ req, user }) => {
  const { ids } = await body(req, z.object({ ids: z.array(zUuid).min(1).max(200) }));
  const { registerTaskAttachment } = await import('@/lib/library');
  const sql = db(); let added = 0, already = 0, skipped = 0; const folders = new Set<string>();
  for (const id of ids) {
    let a: any;
    try { a = (await loadAttachment(user, id)).a; } catch { skipped++; continue; }
    if (a.kind !== 'file' || a.upload_status !== 'ready' || !a.storage_key || !a.task_id) { skipped++; continue; }
    const [dup] = await sql<{ folder: string }[]>`select folder from library_files where tenant = ${tenantOf(user)} and storage_key = ${a.storage_key} and deleted_at is null limit 1`;
    if (dup) { already++; folders.add(dup.folder); continue; }
    const fid = await registerTaskAttachment(user, a, Number(a.size_bytes ?? 0), { force: true });
    if (!fid) { skipped++; continue; }
    added++;
    const [f] = await sql<{ folder: string }[]>`select folder from library_files where id = ${fid}`; if (f) folders.add(f.folder);
  }
  return { added, already, skipped, folders: [...folders] };
});
