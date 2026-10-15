import { handler } from '@/lib/api';
import { docJobFile } from '@/lib/ai/docJobs';

export const GET = handler<{ id: string }>(async ({ user, params }) => docJobFile(user, params.id, 'file'));
