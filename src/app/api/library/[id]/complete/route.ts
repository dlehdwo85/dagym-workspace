import { handler } from '@/lib/api';
import { completeLibraryFile } from '@/lib/library';

export const POST = handler<{ id: string }>(async ({ user, params }) => completeLibraryFile(user, params.id));
