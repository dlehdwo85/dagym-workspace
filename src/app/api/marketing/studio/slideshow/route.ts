import { handler, body } from '@/lib/api';
import { slideshowInput, slideshowStart } from '@/lib/mktSlideshow';

/** 271차 #811 실제 사진으로 영상(관리자): { contentId, photoIds? } — 자료실 실사 3~8장을 천천히 움직여 자막·끝 화면·배경음으로, 생성 비용 0 */
export const POST = handler(async ({ req, user }) => slideshowStart(user, await body(req, slideshowInput)));
