import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { loadAttachment } from '@/lib/attachments';
import { downloadUrl } from '@/lib/storage';
import { badRequest } from '@/lib/errors';

/** 권한 확인 후 짧은 수명의 서명 URL 로 이동 (원본 링크는 원본 서비스 권한을 그대로 따른다) */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const { a } = await loadAttachment(user, params.id);
  if (a.kind === 'link') return NextResponse.redirect(a.url, 302);
  if (a.upload_status !== 'ready') throw badRequest('업로드가 끝나지 않은 파일입니다');
  const inline = req.nextUrl.searchParams.get('inline') === '1' && /^(image\/|application\/pdf)/.test(a.mime_type ?? '');
  const url = await downloadUrl(a.storage_key, a.file_name, inline);
  return NextResponse.redirect(new URL(url, req.nextUrl.origin), 302);
});
