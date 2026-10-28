import { handler, body } from '@/lib/api';
import { campaignBrandInput, setCampaignBrand } from '@/lib/marketingAds';

// 221차 #531 캠페인 브랜드 직접 지정(관리자)
export const PUT = handler(async ({ req, user }) => setCampaignBrand(user, await body(req, campaignBrandInput)));
