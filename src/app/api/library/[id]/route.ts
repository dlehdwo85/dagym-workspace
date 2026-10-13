import { handler, body } from '@/lib/api';
import { deleteLibraryFile, libraryPatch, loadLibraryFile, updateLibraryFile } from '@/lib/library';

export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const { text_content, storage_key: _k, ...f } = await loadLibraryFile(user, params.id);
  return { file: { ...f, has_text: !!text_content } };
});
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateLibraryFile(user, params.id, await body(req, libraryPatch)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteLibraryFile(user, params.id));
