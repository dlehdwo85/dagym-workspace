import { handler, body } from '@/lib/api';
import { courseInput, saveCourse } from '@/lib/check/rounds';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveCourse(user, params.id, await body(req, courseInput)));
