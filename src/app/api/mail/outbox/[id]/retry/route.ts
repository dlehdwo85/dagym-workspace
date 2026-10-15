import { after } from 'next/server';
import { handler } from '@/lib/api';
import { processOutbox, retryOutbox } from '@/lib/mailbox';

export const preferredRegion = 'icn1';
export const maxDuration = 60;
export const POST = handler<{ id: string }>(async ({ user, params }) => {
  const out = await retryOutbox(user, params.id);
  after(() => processOutbox(params.id).catch(() => {}));
  return out;
});
