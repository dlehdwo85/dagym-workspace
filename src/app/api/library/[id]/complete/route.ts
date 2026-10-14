import { handler } from '@/lib/api';
import { completeLibraryFile } from '@/lib/library';

export const maxDuration = 60; // 올린 뒤 자동 정리(AI)
export const POST = handler<{ id: string }>(async ({ user, params }) => completeLibraryFile(user, params.id));
