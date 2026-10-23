/** #450 공공데이터포털 '활용신청 필요(서비스 15157820)' 요약 → 그 서비스 신청 화면 바로 가기(로컬 10/23: 키는 그대로 두고 포털에서 [활용신청]) */
export const portalService = (s: string | null | undefined) => s?.match(/활용신청 필요\(서비스 (\d{6,9})\)/)?.[1] ?? null;
export const portalUrl = (n: string) => `https://www.data.go.kr/data/${n}/openapi.do`;
export function PortalApplyLink({ summary }: { summary: string | null | undefined }) {
  const n = portalService(summary); if (!n) return null;
  return <a href={portalUrl(n)} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-brand-700 underline" data-testid="portal-apply-link">포털 {n} 활용신청 열기 ↗</a>;
}
