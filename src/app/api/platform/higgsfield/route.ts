import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { hfSettings, hfTest, saveHfSettings } from '@/lib/higgsfield';

/** 플랫폼 운영: Higgsfield 키(키 ID·시크릿, 암호화 보관, 값은 돌려주지 않음)·연동 켜기·모델 표(크레딧) · POST = [연결 시험](과금 없는 상태 조회) */
const guard = (u: any) => { if (!u.platformAdmin || u.support) throw notFound(); };
const view = (s: Awaited<ReturnType<typeof hfSettings>>) => { const { apiKey: _k, ...rest } = s; void _k; return rest; };
export const GET = handler(async ({ user }) => { guard(user); return view(await hfSettings()); });
export const PUT = handler(async ({ req, user }) => {
  guard(user);
  const i = await body(req, z.object({ apiKey: z.string().max(400).nullable().optional(), keyId: z.string().max(200).nullable().optional(), keySecret: z.string().max(400).nullable().optional(), enabled: z.boolean().optional(), base: z.string().url().max(200).nullable().optional(),
    models: z.array(z.object({ id: z.string().trim().min(1).max(120), kind: z.enum(['image', 'video']), name: z.string().trim().min(1).max(80), credits: z.number().min(0).max(10000), usd: z.number().min(0).max(1000).nullable().optional(), enabled: z.boolean(), note: z.string().max(200).optional() })).max(20).optional(),
    pricing: z.enum(['credits', 'usd']).optional(), usdKrw: z.number().min(100).max(10000).optional() }));
  return view(await saveHfSettings(i, user.id));
});
export const POST = handler(async ({ user }) => { guard(user); const r = await hfTest(user.id); return { ...r, settings: view(await hfSettings()) }; });
