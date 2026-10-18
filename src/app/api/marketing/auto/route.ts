import { handler, body } from '@/lib/api';
import { automationView, saveSettings, settingsInput } from '@/lib/mktAuto';

/** V41 4-3 + V43 자동 제작: 설정·한도·사용량·규칙·제작 요청·크레딧 원장 */
export const GET = handler(async ({ user }) => automationView(user));
export const PUT = handler(async ({ req, user }) => saveSettings(user, await body(req, settingsInput)));
