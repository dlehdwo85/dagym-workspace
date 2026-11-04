import { handler, body } from '@/lib/api';
import { importCampaign, importCandidates, importInput } from '@/lib/adOps';

/** 358차: 네이버 광고 화면에서 직접 만든 캠페인 목록(가져올 후보) — 관리자, 읽기만 */
export const GET = handler(async ({ req, user }) => importCandidates(user, req.nextUrl.searchParams.get('accountId') ?? ''));
/** 358차: 기존 캠페인 가져오기 — 네이버는 읽기만, 워크인에 연결(끄기·켜기·하루 예산·그룹 입찰가·그룹 끄기/켜기) */
export const POST = handler(async ({ req, user }) => importCampaign(user, await body(req, importInput)));
