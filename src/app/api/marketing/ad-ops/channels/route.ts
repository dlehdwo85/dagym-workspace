import { handler } from '@/lib/api';
import { naverChannels } from '@/lib/adOps';

/** 네이버 비즈채널(웹사이트) 목록 — 세팅안에서 고르기 */
export const GET = handler(async ({ req, user }) => naverChannels(user, req.nextUrl.searchParams.get('accountId') ?? ''));
