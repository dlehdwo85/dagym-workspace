import { handler, body, clientIp } from '@/lib/api';
import { createPdfContract, pdfContractInput } from '@/lib/contracts';

/** 전자계약 2차: 올린 계약서 + 서명자별 칸 배치로 만들어 보내기 */
export const POST = handler(async ({ req, user }) => createPdfContract(user, await body(req, pdfContractInput), clientIp(req)), { idempotent: true });
