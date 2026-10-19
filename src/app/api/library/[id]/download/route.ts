import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { libraryDownload } from '@/lib/library';

/** ?json=1 이면 이동 대신 주소만(앱: 기기 브라우저로 넘겨 내려받기) */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  // 워크인 문서(공동 편집)는 저장 파일이 없으니 .docx 로 내보내기
  const { isDocMime } = await import('@/lib/libDocs');
  const [m] = await (await import('@/lib/db')).db()<{ mime_type: string }[]>`select mime_type from library_files where id = ${params.id}`;
  if (m && isDocMime(m.mime_type)) return NextResponse.redirect(new URL(`/api/library/docs/${params.id}/export?format=docx`, req.nextUrl.origin), 302);
  const abs = new URL(await libraryDownload(user, params.id, req.nextUrl.searchParams.get('inline') === '1'), req.nextUrl.origin).toString();
  return req.nextUrl.searchParams.get('json') === '1' ? { url: abs } : NextResponse.redirect(abs, 302);
});
