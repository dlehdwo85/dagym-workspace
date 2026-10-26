import { handler } from '@/lib/api';
import { startRegen } from '@/lib/mktPhotoGen';

export const maxDuration = 120;
/** 189차 #621 사진 AI 설명 목록 [AI로 다시 만들기] — 관리자만 · 얼굴이 보이지 않는 사진만 · 크레딧 한도 안 · 결과는 정기 실행이 자료실 '마케팅/AI 생성(실사 참고)'에 */
export const POST = handler<{ id: string }>(async ({ user, params }) => startRegen(user, params.id));
