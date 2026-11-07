import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { audit } from '@/lib/log';
import { setSystemCap, systemCapKrw, systemSpend, SYSTEM_LABEL } from '@/lib/ai/systemShare';

/** 382차 #1004 플랫폼 운영 › AI·제작 도구 — 자동 수집 AI(회사 한도 밖) 이번 달 사용·안전 상한(원). 슈퍼관리자만 */
const guard = (u: any) => { if (!u.platformAdmin || u.support) throw notFound(); };
const view = async () => { const sql = db(); const [cap, s] = await Promise.all([systemCapKrw(sql), systemSpend(sql)]); return { label: SYSTEM_LABEL, capKrw: cap, ...s, pct: cap > 0 ? Math.round((s.krw / cap) * 100) : null }; };
export const GET = handler(async ({ user }) => { guard(user); return view(); });
export const PUT = handler(async ({ req, user }) => {
  guard(user);
  const i = await body(req, z.object({ capKrw: z.number().int().min(0).max(10_000_000) }));
  const r = await setSystemCap(i.capKrw, user.id);
  await audit(db(), user.id, 'platform.ai_system_cap', 'app_settings', null, { capKrw: r.krw }).catch(() => {});
  return view();
});
