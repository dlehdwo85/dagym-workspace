import { handler, body } from '@/lib/api';
import { createLibraryFile, libraryInput, listLibrary } from '@/lib/library';

export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  return listLibrary(user, { q: p.get('q') ?? undefined, folder: p.get('folder') ?? undefined, limit: Number(p.get('limit')) || undefined });
});
export const POST = handler(async ({ req, user }) => createLibraryFile(user, await body(req, libraryInput)), { idempotent: true });
