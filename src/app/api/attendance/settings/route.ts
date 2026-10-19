import { handler, body, clientIp } from '@/lib/api';
import { saveSettings, settingsInput } from '@/lib/attendance';

export const PUT = handler(async ({ req, user }) => saveSettings(user, await body(req, settingsInput), clientIp(req)));
