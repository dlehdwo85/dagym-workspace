import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { loadAttachment } from '@/lib/attachments';
import { getObject } from '@/lib/storage';
import { badRequest } from '@/lib/errors';
import { db } from '@/lib/db';
import { activity } from '@/lib/log';
import { tenantOf, type SessionUser } from '@/lib/types';
import { buildZip, type ZipFile } from '@/lib/zip';

const MAX_TOTAL = 300 * 1024 * 1024;
const input = z.object({ ids: z.array(zUuid).min(1).max(200) });

/** 332차(대표 11/02 16:1x ④): 선택한 첨부를 zip 하나로 — 볼 수 있는 파일만(링크·올리는 중·기밀 권한 없는 것은 뺌, 응답 머리 x-skipped), 한 번에 300MB 까지 */
async function zipOf(user: SessionUser, ids: string[]) {
  const { storageSecurity, userSeesConfidential } = await import('@/lib/library');
  const files: ZipFile[] = []; let skipped = 0, total = 0; let taskId: string | null = null; let seesConf: boolean | null = null;
  for (const id of ids) {
    let a: any;
    try { a = (await loadAttachment(user, id)).a; } catch { skipped++; continue; }
    if (a.kind !== 'file' || a.upload_status !== 'ready' || !a.storage_key) { skipped++; continue; }
    const lib = await storageSecurity(tenantOf(user), a.storage_key);
    if (lib?.deleted) { skipped++; continue; }
    if (lib?.security === 'confidential') { if (seesConf === null) seesConf = await userSeesConfidential(user.id); if (!seesConf) { skipped++; continue; } }
    total += Number(a.size_bytes ?? 0);
    if (total > MAX_TOTAL) throw badRequest('한 번에 300MB 까지 묶을 수 있습니다 — 나눠서 내려받아 주세요');
    files.push({ name: a.file_name, data: await getObject(a.storage_key), mtime: a.created_at ? new Date(a.created_at) : undefined });
    taskId = taskId ?? a.task_id ?? null;
  }
  if (!files.length) throw badRequest('내려받을 수 있는 파일이 없습니다(링크·올리는 중인 파일은 빠짐)');
  const sql = db();
  const [t] = taskId ? await sql<{ title: string }[]>`select title from tasks where id = ${taskId}` : [];
  if (taskId) await activity(sql, 'task', taskId, user.id, 'file_downloaded', { name: `첨부 ${files.length}개(zip)`, count: files.length, zip: true }).catch(() => {});
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).replace(/-/g, '');
  const name = `${(t?.title ?? '첨부').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || '첨부'}_첨부${files.length}개_${day}.zip`;
  return new NextResponse(new Uint8Array(buildZip(files)), { headers: { 'content-type': 'application/zip', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'x-skipped': String(skipped), 'x-count': String(files.length), 'cache-control': 'no-store' } });
}
export const POST = handler(async ({ req, user }) => zipOf(user, (await body(req, input)).ids));
/** 앱(기기 브라우저로 넘김)용: ?ids=a,b,c */
export const GET = handler(async ({ req, user }) => zipOf(user, input.parse({ ids: (req.nextUrl.searchParams.get('ids') ?? '').split(',').map((x: string) => x.trim()).filter(Boolean) }).ids));
