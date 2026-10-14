import { body, handler } from '@/lib/api';
import { assigneesInput, setInquiryAssignees } from '@/lib/inquiries';

export const PUT = handler(async ({ req, user }) => setInquiryAssignees(user, await body(req, assigneesInput)));
