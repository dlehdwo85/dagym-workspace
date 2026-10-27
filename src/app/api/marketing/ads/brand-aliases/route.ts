import { handler, body } from '@/lib/api';
import { brandAliasesInput, setBrandAliases } from '@/lib/marketingAds';

// 221차 #531 브랜드마다 캠페인 이름에서 찾는 낱말(관리자)
export const PUT = handler(async ({ req, user }) => setBrandAliases(user, await body(req, brandAliasesInput)));
