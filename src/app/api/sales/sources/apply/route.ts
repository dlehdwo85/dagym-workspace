import { handler, body } from '@/lib/api';
import { applyInput, applySuggestion } from '@/lib/sales/sources';

export const POST = handler(async ({ req, user }) => applySuggestion(user, await body(req, applyInput)));
