// 238차(#742 대표 10/28 '화면 전환이 느림'): Intl.DateTimeFormat 은 만드는 비용이 큼(휴대폰에서 1개 수 ms) — 업무 목록처럼 줄마다 새로 만들면
// 화면 하나에 수백 ms(CPU 4배 느림 측정: 업무 화면 전환의 약 15%). 같은 언어·옵션은 한 번 만들어 다시 씀. 서버·화면 공용(의존성 없음)
const cache = new Map<string, Intl.DateTimeFormat>();
export function dtf(locale?: string | string[], options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${options ? JSON.stringify(options) : ''}`;
  let f = cache.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, options); cache.set(key, f); }
  return f;
}
