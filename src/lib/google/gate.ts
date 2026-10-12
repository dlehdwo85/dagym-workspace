import { HttpError } from '../errors';
import { googleSyncEnabled } from './client';

/** 선택 기능이 꺼져 있으면 Google 관련 API 는 존재하지 않는 것처럼 404 */
export function featureGate() {
  if (!googleSyncEnabled()) throw new HttpError(404, 'feature_disabled', 'Google Calendar 동기화는 선택 기능이며 현재 꺼져 있습니다');
}
export const featureGateOk = () => googleSyncEnabled();
