import { handler } from '@/lib/api';
import { platformPaymentDetail } from '@/lib/billing';

/** #1160 결제 상세(회사·요금제·카드·승인 시각·영수증·취소 내역·되돌릴 요금제) */
export const GET = handler<{ id: string }>(async ({ user, params }) => platformPaymentDetail(user, params.id));
