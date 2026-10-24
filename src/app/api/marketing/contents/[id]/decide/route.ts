import { handler, body, clientIp } from '@/lib/api';
import { decide, decideInput } from '@/lib/marketing';

// #545: 자동 제작 글의 수정 요청은 이 요청 안에서 AI 가 글을 다시 쓰고 시안을 다시 그림(다듬기와 같은 120초)
export const maxDuration = 120;

/** 승인·수정 요청·보류(버전 단위) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => decide(user, params.id, await body(req, decideInput), clientIp(req)));
