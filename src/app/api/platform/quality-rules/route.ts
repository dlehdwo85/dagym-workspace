import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { audit } from '@/lib/log';
import { qualityRulesAdmin, rulesInput, saveQualityRules } from '@/lib/mktQuality';

/** #426 플랫폼 운영 › 글 품질 규칙 — 훅·사람다움 통과 점수, 채널별 글자 수(인스타 해시태그 5개 등). 저장하면 다음 제작부터(재배포 없음) */
const guard = (u: { platformAdmin?: boolean; support?: unknown }) => { if (!u.platformAdmin || u.support) throw notFound(); };
export const GET = handler(async ({ user }) => { guard(user); return qualityRulesAdmin(); });
export const PUT = handler(async ({ req, user }) => {
  guard(user);
  const i = await body(req, rulesInput);
  await saveQualityRules(user.id, i);
  await audit(db(), user.id, 'platform.quality_rules', 'app_settings', null, { sections: Object.keys(i) }).catch(() => {});
  return qualityRulesAdmin();
});
