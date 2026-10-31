import { handler, body } from '@/lib/api';
import { recordingInput, recordingList, recordingStart } from '@/lib/mktSlideshow';

/** 273차 #811 1) 앱 화면 녹화(관리자): GET ?contentId= 고를 녹화 목록 · POST { contentId, fileId } 녹화 영상에 자막·끝 화면·배경음을 붙여 새 판 — 생성 비용 0 */
export const GET = handler(async ({ req, user }) => recordingList(user, req.nextUrl.searchParams.get('contentId') ?? ''));
export const POST = handler(async ({ req, user }) => recordingStart(user, await body(req, recordingInput)));
