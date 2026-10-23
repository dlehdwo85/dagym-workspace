import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { audit } from '@/lib/log';
import { saveTtsSettings, ttsSettings, ttsTest, ttsView } from '@/lib/video/tts';

/** #454 플랫폼 운영 — 영상 내레이션(TTS) 공급자·키(암호화 보관, 돌려주지 않음)·음성. POST = [연결 시험] */
const guard = (u: any) => { if (!u.platformAdmin || u.support) throw notFound(); };
export const GET = handler(async ({ user }) => { guard(user); return ttsView(await ttsSettings()); });
export const PUT = handler(async ({ req, user }) => {
  guard(user);
  const i = await body(req, z.object({ provider: z.enum(['openai', 'elevenlabs', 'clova']).nullable().optional(), apiKey: z.string().max(400).nullable().optional(),
    voice: z.string().trim().max(80).nullable().optional(), model: z.string().trim().max(80).nullable().optional(), base: z.string().url().max(200).nullable().optional() }));
  const out = ttsView(await saveTtsSettings(i, user.id));
  await audit(db(), user.id, 'platform.tts.settings', 'app_settings', null, { provider: out.provider, key: i.apiKey === undefined ? undefined : i.apiKey ? 'set' : 'clear', voice: i.voice !== undefined }).catch(() => {});
  return out;
});
export const POST = handler(async ({ user }) => { guard(user); const r = await ttsTest(user.id); return { ...r, settings: ttsView(await ttsSettings()) }; });
