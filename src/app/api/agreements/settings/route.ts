import { handler, body } from '@/lib/api';
import { getSettings, saveSettings, settingsInput } from '@/lib/agreements';

/** 회사 기본 알림 날짜(비우면 90·60·30·7일 전) */
export const GET = handler(async ({ user }) => getSettings(user));
export const PUT = handler(async ({ req, user }) => saveSettings(user, await body(req, settingsInput)));
