import { handler } from '@/lib/api';
import { editSource } from '@/lib/attachmentEdit';

/** #533 [고치기] 편집기가 읽는 원본(같은 출처·고칠 수 있는 사람만). 주소로 바로 열어도 그 자리에서 그려지지 않게 attachment + nosniff */
export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const { a, bytes } = await editSource(user, params.id);
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': a.mime_type || 'application/octet-stream', 'content-disposition': 'attachment', 'x-content-type-options': 'nosniff', 'cache-control': 'private, no-store' } });
});
