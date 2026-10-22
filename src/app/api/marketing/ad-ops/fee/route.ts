import { handler, body } from '@/lib/api';
import { feeInput, setAgencyFee } from '@/lib/adOps';

/** 광고 최적화 1차 ④ '대행사 대비 절감액' 기준 수수료율(관리자, null = 기본 15%) */
export const PUT = handler(async ({ req, user }) => setAgencyFee(user, await body(req, feeInput)));
