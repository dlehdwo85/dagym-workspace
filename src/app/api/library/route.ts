import { handler, body } from '@/lib/api';
import { createLibraryFile, libraryInput, listLibrary } from '@/lib/library';

export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  return listLibrary(user, { q: p.get('q') ?? undefined, folder: p.get('folder') ?? undefined, limit: Number(p.get('limit')) || undefined, review: p.get('review') === '1', space: p.get('space') ?? undefined,
    scope: p.get('scope') ?? undefined, teamId: p.get('teamId') ?? undefined }); // 292차 #804·#814 회사 전체·우리 팀·내 파일(비우면 볼 수 있는 것 전부)
});
export const POST = handler(async ({ req, user }) => createLibraryFile(user, await body(req, libraryInput)), { idempotent: true });
