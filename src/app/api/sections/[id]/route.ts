import { handler, body } from '@/lib/api';
import { deleteSection, sectionInput, updateSection } from '@/lib/sections';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateSection(user, params.id, await body(req, sectionInput.partial())));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteSection(user, params.id));
