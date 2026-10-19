import { handler, body } from '@/lib/api';
import { channelToggle, listChannels, setChannel } from '@/lib/mktChannels';

/** 게시 채널: 목록·연결 상태(토큰 제외) / 회사별 켜기·끄기(관리자) */
export const GET = handler(async ({ user }) => listChannels(user));
export const PUT = handler(async ({ req, user }) => setChannel(user, await body(req, channelToggle)));
