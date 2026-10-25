// #651(대표 10/25 23:20 기업마당 143건 깨진 글자): 공공 원천 응답 바이트 → 한글 해독. 다른 모듈을 가져오지 않는 잎 모듈(시험에서 .ts 로 바로 불러옴)
/** 한글 비율 점수 — 완성형 한글 +1, 치환 문자(�) −3, 한자·호환 자모·CJK 기호·전각(깨진 해독에 많이 나오는 범위) −1, 공백·제어 문자 제외. 글자가 없으면 0 */
export function koreanScore(s: string): number {
  let hangul = 0, bad = 0, cjk = 0, n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c <= 0x20) continue;
    n++;
    if (c >= 0xac00 && c <= 0xd7a3) hangul++;
    else if (c === 0xfffd) bad++;
    else if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0x3200 && c <= 0x33ff) || (c >= 0xff00 && c <= 0xffef)) cjk++;
  }
  return n ? (hangul - bad * 3 - cjk) / n : 0;
}
/** 제목·본문이 깨진 해독인지 — 치환 문자가 있거나 한글보다 한자·치환 문자가 많으면 */
export const garbledText = (s: string | null | undefined) => !!s && (s.includes('�') || koreanScore(s) < 0);
const EUC = /^(euc-?kr|ks_?c[_-]?5601[_-]?1987|cp949|x-windows-949|windows-949|ks_?c_?5601|iso-2022-kr)$/i;
/**
 * 바이트 → 글자. ① HTTP Content-Type 의 charset 이 있으면 그대로 ② 없으면 UTF-8 로 읽어 치환 문자가 없으면 UTF-8
 * ③ 치환 문자가 있으면 UTF-8·EUC-KR 둘 다 읽어 한글 비율이 높은 쪽(예전엔 '�' 하나만 있어도 EUC-KR 로 바꿔, 깨진 바이트가 섞인 UTF-8 응답 전체를 잘못 읽었음)
 */
export function decodeKoreanText(bytes: Uint8Array, contentType?: string | null): { text: string; encoding: 'utf-8' | 'euc-kr'; by: 'charset' | 'clean' | 'score' } {
  const cs = (contentType ?? '').match(/charset\s*=\s*"?([\w-]+)/i)?.[1] ?? '';
  if (cs && EUC.test(cs)) return { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'euc-kr', by: 'charset' };
  if (cs && /^utf-?8$/i.test(cs)) return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8', by: 'charset' };
  const head = bytes.subarray(0, 256 * 1024);
  const u = new TextDecoder('utf-8', { fatal: false }).decode(head);
  if (!u.includes('�')) return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8', by: 'clean' };
  const k = new TextDecoder('euc-kr').decode(head);
  return koreanScore(k) > koreanScore(u) ? { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'euc-kr', by: 'score' } : { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8', by: 'score' };
}
