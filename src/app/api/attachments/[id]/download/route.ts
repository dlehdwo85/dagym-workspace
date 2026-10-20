import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { loadAttachment } from '@/lib/attachments';
import { downloadUrl } from '@/lib/storage';
import { badRequest, forbidden, notFound } from '@/lib/errors';
import { tenantOf } from '@/lib/types';
import { db } from '@/lib/db';
import { activity } from '@/lib/log';

/**
 * 권한 확인 후 짧은 수명의 서명 URL 로 이동 (원본 링크는 원본 서비스 권한을 그대로 따른다).
 * V14 49: 업무를 볼 수 있는 사람 누구나 내려받기. ?json=1 이면 이동 대신 주소만(앱: 기기 브라우저·공유로 넘김).
 * 기밀 자료(자료실 기밀 등급)에서 붙인 파일은 기밀 열람 권한이 있어야 한다. 내려받기(미리보기 아님)는 업무 활동에 남긴다(같은 사람·파일 10분에 1번).
 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const { a } = await loadAttachment(user, params.id);
  if (a.kind === 'link') return req.nextUrl.searchParams.get('json') === '1' ? { url: a.url, name: a.doc_title ?? a.url, external: true } : NextResponse.redirect(a.url, 302);
  if (a.upload_status !== 'ready') throw badRequest('업로드가 끝나지 않은 파일입니다');
  const sql = db();
  // V34 C2: 자료실에서 붙인 파일은 매번 자료실 등급(폴더 상속 포함)으로 다시 판단, 자료실에서 지웠으면 더는 못 엶
  const { storageSecurity } = await import('@/lib/library');
  const lib = await storageSecurity(tenantOf(user), a.storage_key);
  if (lib?.deleted) throw notFound('자료실에서 지운 파일입니다');
  if (lib?.security === 'confidential') {
    const { userSeesConfidential } = await import('@/lib/library');
    if (!(await userSeesConfidential(user.id))) throw forbidden('기밀 자료입니다 — 기밀 열람 권한이 있어야 내려받을 수 있습니다');
  }
  const inline = req.nextUrl.searchParams.get('inline') === '1' && /^(image\/|video\/|application\/pdf)/.test(a.mime_type ?? '');
  if (!inline && a.task_id) {
    const [recent] = await sql`select 1 from activities where entity_type = 'task' and entity_id = ${a.task_id} and actor_id = ${user.id} and action = 'file_downloaded'
      and changes->>'attachmentId' = ${a.id} and created_at > now() - interval '10 minutes' limit 1`;
    if (!recent) await activity(sql, 'task', a.task_id, user.id, 'file_downloaded', { name: a.file_name, attachmentId: a.id });
  }
  const url = await downloadUrl(a.storage_key, a.file_name, inline);
  const abs = new URL(url, req.nextUrl.origin).toString();
  if (req.nextUrl.searchParams.get('json') === '1') return { url: abs, name: a.file_name, mime: a.mime_type };
  return NextResponse.redirect(abs, 302);
});
