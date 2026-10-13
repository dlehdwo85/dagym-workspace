import { handler, body } from '@/lib/api';
import { setSubscription, subscriptionInput } from '@/lib/plans';

export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setSubscription(user, params.tenant, await body(req, subscriptionInput)));
