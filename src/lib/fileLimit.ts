import { z } from 'zod';
import { db } from './db';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { DEFAULT_FILE_MAX_MB, FILE_MAX_CHOICES_MB, PLATFORM_MAX_BYTES, mbText, tenantFileMaxBytes } from './storage';

/**
 * #1128(대표 11/23 '자료실 50MB 제한 — 올리는 건 자유롭게 하되 최대 용량을 정할 수 있으면'): 회사의 '파일 한 개 최대 크기'.
 * 보기 = 회사 사람 누구나(올리기 안내 글에 씀) · 바꾸기 = 회사 정보 편집 권한(회사 관리자). 회사 전체 저장 한도(요금제)는 따로 그대로.
 */
export async function getFileMax(u: SessionUser) {
  const bytes = await tenantFileMaxBytes(tenantOf(u));
  const mb = Math.round(bytes / 1024 / 1024);
  return { mb, text: mbText(mb), choices: FILE_MAX_CHOICES_MB.map((m) => ({ mb: m, text: mbText(m) })), defaultMb: DEFAULT_FILE_MAX_MB, platformMaxMb: PLATFORM_MAX_BYTES / 1024 / 1024, contentReadMb: 50 };
}
export const fileMaxInput = z.object({ mb: z.union([z.literal(50), z.literal(200), z.literal(1024), z.literal(2048)]) });
export async function setFileMax(u: SessionUser, i: z.infer<typeof fileMaxInput>, ip: string | null) {
  await (await import('./menuPerms')).requireAnyMenu(u, ['company', 'ops'], 'edit');
  const sql = db(); const t = tenantOf(u);
  const before = await getFileMax(u);
  await sql`update tenants set file_max_mb = ${i.mb} where id = ${t}`;
  await audit(sql, u.id, 'tenant.file_max', 'tenant', null, { tenant: t, from: before.mb, to: i.mb }, ip);
  return getFileMax(u);
}
