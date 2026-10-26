import { handler, body } from '@/lib/api';
import { deleteLibraryFile, libraryPatch, loadLibraryFile, updateLibraryFile } from '@/lib/library';
import { seesInternals } from '@/lib/customerScope';

export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const { text_content, storage_key: _k, ...f } = await loadLibraryFile(user, params.id);
  // 189차 #602: 생성 기록(요청 주소·모델·오류)은 슈퍼관리자·우리 회사만
  if (!seesInternals(user) && f.meta) f.meta = (await import('@/lib/mktPhotoGen')).customerMeta(f.meta);
  return { file: { ...f, has_text: !!text_content } };
});
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateLibraryFile(user, params.id, await body(req, libraryPatch)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteLibraryFile(user, params.id));
