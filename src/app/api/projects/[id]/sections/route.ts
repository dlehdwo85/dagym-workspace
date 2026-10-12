import { handler, body } from '@/lib/api';
import { createSection, listSections, sectionInput } from '@/lib/sections';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ sections: await listSections(user, params.id) }));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => createSection(user, params.id, await body(req, sectionInput)), { idempotent: true });
