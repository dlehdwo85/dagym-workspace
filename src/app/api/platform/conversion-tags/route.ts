import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { audit } from '@/lib/log';
import { conversionTagsAdmin, conversionTagsInput, saveConversionTags } from '@/lib/conversionTags';

/** #449 플랫폼 운영 › 가입 전환 태그(Google Ads 전환 ID/라벨·GA4·Meta 픽셀·네이버) — 저장하면 가입 화면에 바로(재배포 없음) */
const guard = (u: { platformAdmin?: boolean; support?: unknown }) => { if (!u.platformAdmin || u.support) throw notFound(); };
export const GET = handler(async ({ user }) => { guard(user); return conversionTagsAdmin(); });
export const PUT = handler(async ({ req, user }) => {
  guard(user);
  const i = await body(req, conversionTagsInput);
  const saved = await saveConversionTags(user.id, i);
  await audit(db(), user.id, 'platform.conversion_tags', 'app_settings', null, { keys: Object.keys(saved) }).catch(() => {});
  return conversionTagsAdmin();
});
