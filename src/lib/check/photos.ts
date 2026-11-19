import { z } from 'zod';
import { db } from '../db';
import { badRequest, notFound } from '../errors';
import { requireMenu, menuLevel } from '../menuPerms';
import { downloadUrl, putObject } from '../storage';
import { tenantOf, type SessionUser } from '../types';

/**
 * 점검 사진 — 1단계는 점검 항목의 '기준 사진'(양호한 모습)만. 화면이 올리기 전에 줄여서(긴 변 1600px) 보낸다.
 * 회사 저장공간 한도에 들어간다(currentUsage 가 chk_photos 를 함께 셈). 파일은 회사별 경로(chk/<회사>/…)에 두고, 여는 주소는 권한을 본 뒤 잠깐 쓰는 서명 주소로.
 */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
export const MAX_ITEM_PHOTOS = 6;
export const photoInput = z.object({
  fileName: z.string().trim().min(1).max(120),
  mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/, 'JPG·PNG·WEBP 사진만 올릴 수 있습니다'),
  /** base64(줄인 사진) */
  data: z.string().min(8).max(Math.ceil(MAX_PHOTO_BYTES * 1.37) + 16),
});
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** 기준 사진 올리기 — 가이드 편집 권한 */
export async function addItemPhoto(u: SessionUser, itemId: string, i: z.infer<typeof photoInput>) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  if (!(await sql`select 1 from chk_items where id = ${itemId} and tenant = ${t}`).length) throw notFound();
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from chk_photos where tenant = ${t} and owner_kind = 'item' and owner_id = ${itemId}`;
  if (n >= MAX_ITEM_PHOTOS) throw badRequest(`기준 사진은 항목마다 ${MAX_ITEM_PHOTOS}장까지 올릴 수 있습니다`);
  const buf = Buffer.from(i.data.replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw badRequest('사진을 읽지 못했습니다');
  if (buf.length > MAX_PHOTO_BYTES) throw badRequest('사진이 너무 큽니다(3MB 까지) — 다시 찍거나 작은 사진으로 올려 주세요');
  await (await import('../plans')).assertStorage(u, buf.length);
  const id = crypto.randomUUID();
  const key = `chk/${t}/item/${itemId}/${id}.${EXT[i.mimeType]}`;
  await putObject(key, buf, i.mimeType);
  await sql`insert into chk_photos (id, tenant, owner_kind, owner_id, storage_key, file_name, mime_type, size_bytes, upload_status, by_user)
    values (${id}, ${t}, 'item', ${itemId}, ${key}, ${i.fileName}, ${i.mimeType}, ${buf.length}, 'ready', ${u.id})`;
  return { id, sizeBytes: buf.length };
}
export async function itemPhotos(tenant: string, itemIds: string[]) {
  if (!itemIds.length) return new Map<string, { id: string; fileName: string | null }[]>();
  const rows = await db()<{ id: string; owner_id: string; file_name: string | null }[]>`select id, owner_id, file_name from chk_photos
    where tenant = ${tenant} and owner_kind = 'item' and owner_id = any(${itemIds}::uuid[]) and upload_status = 'ready' order by created_at`;
  const m = new Map<string, { id: string; fileName: string | null }[]>();
  for (const r of rows) m.set(r.owner_id, [...(m.get(r.owner_id) ?? []), { id: r.id, fileName: r.file_name }]);
  return m;
}
/** 사진 지우기 — 가이드 편집 권한(기록만 지움) */
export async function removePhoto(u: SessionUser, id: string) {
  await requireMenu(u, 'check_guide', 'edit');
  const r = await db()`delete from chk_photos where id = ${id} and tenant = ${tenantOf(u)} and owner_kind = 'item' returning id`;
  if (!r.length) throw notFound();
  return { ok: true };
}
/** 사진 열기: 가이드를 보는 사람, 또는 '직원 공유' 표시된 사용 중 항목의 기준 사진이면 같은 회사 누구나. 그 밖에는 없는 것처럼(404) */
export async function photoUrl(u: SessionUser, id: string) {
  const sql = db(); const t = tenantOf(u);
  const [p] = await sql<{ storage_key: string; file_name: string | null; mime_type: string | null; owner_kind: string; owner_id: string }[]>`
    select storage_key, file_name, mime_type, owner_kind, owner_id from chk_photos where id = ${id} and tenant = ${t} and upload_status = 'ready'`;
  if (!p) throw notFound();
  if ((await menuLevel(u, 'check_guide')) === 'none') {
    const [shared] = p.owner_kind === 'item' ? await sql`select 1 from chk_items where id = ${p.owner_id} and tenant = ${t} and active and share_staff` : [];
    if (!shared) throw notFound();
  }
  return downloadUrl(p.storage_key, p.file_name ?? 'photo.jpg', true, 300, p.mime_type ?? undefined);
}
