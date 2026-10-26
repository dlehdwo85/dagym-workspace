/** 한국 전화번호 — 숫자만 / 표시용 하이픈(서버·화면 공용, 순수 함수).
 *  184차 #711(대표 10/26 18:00 '명함 휴대폰 번호에 하이픈이 없음'): 프로필에 숫자만 저장된 번호도 명함·문자 서명에서 010-0000-0000 꼴로 */
export function normPhone(s: string | null | undefined): string | null {
  if (!s) return null;
  let d = s.replace(/[^0-9+]/g, '');
  if (d.startsWith('+82')) d = '0' + d.slice(3).replace(/^0/, '');
  d = d.replace(/\D/g, '');
  return d.length >= 7 ? d : null;
}
/** 010-1234-5678 · 011-123-4567 · 02-123-4567 · 02-1234-5678 · 031-123-4567 · 070-1234-5678 · 0505-123-4567 · 0507-1234-5678 · 1588-1234 — 모르는 꼴이면 원래 글자 그대로 */
export function krPhone(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  const d = normPhone(s); if (!d) return s.trim();
  const n = d.length;
  if (/^1[5-9]\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4)}`; // 대표번호 15XX·16XX·18XX
  if (d.startsWith('02')) return n === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : n === 10 ? `02-${d.slice(2, 6)}-${d.slice(6)}` : s.trim();
  if (/^050[2-8]/.test(d)) return n === 11 ? `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : n === 12 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : s.trim();
  if (d.startsWith('0')) return n === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : n === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : s.trim();
  return s.trim();
}
