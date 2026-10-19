import { handler } from '@/lib/api';
import { exportContacts } from '@/lib/contacts';

export const GET = handler(async ({ user }) => {
  const r = await exportContacts(user);
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
});
