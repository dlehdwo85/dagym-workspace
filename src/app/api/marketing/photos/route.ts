import { handler } from '@/lib/api';
import { photosView } from '@/lib/mktPhotos';

/** #235 ⓒ 자동 제작 › 사진 AI 설명: 마케팅 사진 숫자(설명·아직·바탕 가능·그래픽) + 최근 60장 */
export const GET = handler(async ({ user }) => photosView(user));
