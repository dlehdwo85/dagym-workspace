import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { hfSettings, saveHfSettings } from '@/lib/higgsfield';

/** 플랫폼 운영: Higgsfield 키(암호화 보관, 값은 돌려주지 않음)·연동 켜기·모델 표(크레딧) */
const guard = (u: any) => { if (!u.platformAdmin || u.support) throw notFound(); };
export const GET = handler(async ({ user }) => { guard(user); const { apiKey: _k, ...s } = await hfSettings(); void _k; return s; });
export const PUT = handler(async ({ req, user }) => {
  guard(user);
  const i = await body(req, z.object({ apiKey: z.string().max(400).nullable().optional(), enabled: z.boolean().optional(), base: z.string().url().max(200).nullable().optional(),
    models: z.array(z.object({ id: z.string().trim().min(1).max(40), kind: z.enum(['image', 'video']), name: z.string().trim().min(1).max(80), credits: z.number().min(0).max(10000), enabled: z.boolean(), note: z.string().max(200).optional() })).max(20).optional() }));
  const { apiKey: _k, ...s } = await saveHfSettings(i, user.id); void _k; return s;
});
