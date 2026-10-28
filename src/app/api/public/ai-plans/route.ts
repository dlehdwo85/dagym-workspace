import { handler } from '@/lib/api';
import { aiPlanMatrix, publicAiPlans } from '@/lib/aiLimits';

/** #412 요금제별 AI 한도 기준표 — 소개 사이트·요금 안내가 고객 화면과 같은 데이터를 쓴다(로그인 없이, 가격·한도만 — #602 원가·단가·환율은 뺌) */
export const GET = handler(async () => publicAiPlans(await aiPlanMatrix()), { public: true });
