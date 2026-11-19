/** 계약의 '남은 날' 한 줄 — 목록·홈 카드가 같이 씀(이 파일은 DB 를 부르지 않음). 자동 연장 + 통보 기한이 있으면 통보 마감일 기준 */
export type AgreementLeft = { state: string; basisKind: 'notice' | 'end' | null; daysLeft: number | null };
export function agreementLeftText(a: AgreementLeft) {
  if (a.state === 'ended') return '종료';
  if (a.state === 'open_ended') return '기한 없음';
  if (a.state === 'expired') return `만료 ${Math.abs(a.daysLeft ?? 0)}일 지남`;
  if (a.state === 'renew_check') return '연장 확인 필요';
  if (a.state === 'notice_passed') return `통보 기한 지남 · 만료 D-${a.daysLeft ?? 0}`;
  return a.basisKind === 'notice' ? `통보 기한 D-${a.daysLeft}` : a.daysLeft === 0 ? '오늘 만료' : `D-${a.daysLeft}`;
}
