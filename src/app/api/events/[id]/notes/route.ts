import { handler, body } from '@/lib/api';
import { getNotes, notesInput, saveNotes } from '@/lib/eventtasks';

export const GET = handler<{ id: string }>(async ({ user, params, req }) => getNotes(user, params.id, req.nextUrl.searchParams.get('occurrenceStart')));
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => saveNotes(user, params.id, await body(req, notesInput)));
