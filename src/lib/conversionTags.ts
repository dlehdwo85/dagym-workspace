import { z } from 'zod';
import { db } from './db';

/**
 * #449 가입 전환 태그 ID — 페이지 소스에 그대로 보이는 공개 측정 ID(비밀 아님).
 * 플랫폼 운영 › 가입 전환 태그에서 넣으면 바로 적용(재배포 없음), 칸이 비면 빌드 환경변수(NEXT_PUBLIC_*) 값.
 * 가입 화면이 GET /api/auth/signup 으로 받아 가입 완료(회사 생성) 순간 한 번 보낸다(동의한 브라우저만, components/conversion.ts).
 */
export type ConversionTags = { googleAds: string; ga4: string; metaPixel: string; naverWa: string };
const KEYS = ['googleAds', 'ga4', 'metaPixel', 'naverWa'] as const;
const env = (): ConversionTags => ({
  googleAds: process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP ?? '', ga4: process.env.NEXT_PUBLIC_GA4_ID ?? '',
  metaPixel: process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '', naverWa: process.env.NEXT_PUBLIC_NAVER_WA ?? '',
});

export const conversionTagsInput = z.object({
  googleAds: z.string().trim().regex(/^(AW-\d{6,15}\/[A-Za-z0-9_-]{4,64})?$/, 'Google Ads 전환은 AW-숫자/전환 라벨 형식입니다(예: AW-123456789/AbCdEfGh)'),
  ga4: z.string().trim().regex(/^(G-[A-Z0-9]{4,20})?$/, 'GA4 측정 ID 는 G- 로 시작합니다'),
  metaPixel: z.string().trim().regex(/^(\d{8,20})?$/, 'Meta 픽셀 ID 는 숫자입니다'),
  naverWa: z.string().trim().regex(/^([A-Za-z0-9_]{4,40})?$/, '네이버 프리미엄로그분석 공통 인증키 형식이 아닙니다'),
}).partial();

async function saved(): Promise<{ value: Partial<ConversionTags>; updatedAt: string | null }> {
  const [r] = await db()<{ value: Partial<ConversionTags>; updated_at: string }[]>`select value, updated_at from app_settings where key = 'conversion_tags'`;
  return { value: r?.value ?? {}, updatedAt: r?.updated_at ?? null };
}

/** 가입 화면이 쓰는 값: 저장값 > 빌드 환경변수 */
export async function conversionTags(): Promise<ConversionTags> {
  const s = (await saved().catch(() => ({ value: {} as Partial<ConversionTags> }))).value; const e = env();
  return Object.fromEntries(KEYS.map((k) => [k, s[k] || e[k]])) as ConversionTags;
}

/** 플랫폼 운영 화면: 실제 쓰이는 값 + 저장값 + 빌드 값이 있는 칸 */
export async function conversionTagsAdmin() {
  const s = await saved(); const e = env();
  return { tags: Object.fromEntries(KEYS.map((k) => [k, s.value[k] || e[k]])) as ConversionTags, saved: s.value, fromEnv: KEYS.filter((k) => !s.value[k] && !!e[k]), updatedAt: s.updatedAt };
}

export async function saveConversionTags(userId: string, i: z.infer<typeof conversionTagsInput>) {
  const sql = db(); const cur = (await saved()).value;
  const next = Object.fromEntries(KEYS.map((k) => [k, (i[k] ?? cur[k] ?? '').trim()]).filter(([, v]) => v)) as Partial<ConversionTags>;
  await sql`insert into app_settings (key, value, updated_by) values ('conversion_tags', ${sql.json(next as never)}, ${userId})
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  return next;
}
