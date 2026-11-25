import { handler, body, clientIp } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { featureInput, featureList, setFeature } from '@/lib/features';

/** #1181 상업화 마감 4번 · #1175 플랫폼 운영 › 회사 상세 '기능' — GET 기능 표 · PUT {key, on(null = 기본값으로), note?}(슈퍼관리자만, 감사 기록) */
export const GET = handler<{ tenant: string }>(async ({ user, params }) => { if (!user.platformAdmin) throw notFound(); return { features: await featureList(params.tenant) }; });
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setFeature(user, params.tenant, await body(req, featureInput), clientIp(req), { platform: true }));
