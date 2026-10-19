import { handler, body } from '@/lib/api';
import { rescheduleOutbox, scheduleInput } from '@/lib/mailbox';

/** 예약 메일 시각 바꾸기·취소 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => rescheduleOutbox(user, params.id, await body(req, scheduleInput)));
