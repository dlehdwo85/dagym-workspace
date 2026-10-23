/**
 * #194(#183 7-3) 앱 1.1.3 문자에 파일 바로 첨부: 고른 순서대로 합계 10MB·10개까지는 문자에 붙이고, 넘치는 파일만 14일 내려받기 주소로.
 * 큰 첨부는 문자 앱·통신사 규칙(MMS·RCS)에 따라 줄이거나 못 보낼 수 있어 주소로 보낸다(로컬 9f4f670a 약속).
 */
export const SMS_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
export const SMS_ATTACH_MAX_FILES = 10;
export function planSmsAttach<T extends { size: number }>(files: T[], maxBytes = SMS_ATTACH_MAX_BYTES, maxFiles = SMS_ATTACH_MAX_FILES) {
  const direct: T[] = [], link: T[] = [];
  let bytes = 0;
  for (const f of files) {
    const size = Math.max(0, Number(f.size) || 0);
    if (direct.length < maxFiles && bytes + size <= maxBytes) { direct.push(f); bytes += size; } else link.push(f);
  }
  return { direct, link, bytes };
}
