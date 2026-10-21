import { handler } from '@/lib/api';
import { deleteRule } from '@/lib/assignees';

/** #100 담당자 지정 규칙 지우기(관리자) */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteRule(user, params.id));
