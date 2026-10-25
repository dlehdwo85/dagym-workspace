/**
 * #258(로컬 10/25 10:25 'PDF 글자 칸보다 긴 글은 잘림'): 칸에 글 맞추기 — 칸 폭에서 줄을 바꾸고(띄어쓰기 자리, 칸보다 긴 낱말은 글자 단위)
 * 칸 높이에 다 들어가는 가장 큰 글자 크기를 고른다(최대 14pt · 한 줄이면 칸 높이의 fill 배 — 예전 한 줄 크기와 같음). 글은 자르지 않고,
 * 가장 작은 크기에서도 넘치면 over. 서버(PDF 에 찍기 — PDF 글꼴 폭)와 편집 화면(화면 글꼴 폭)이 같은 식을 쓴다. 단위는 pt.
 * width(t) = 글자 크기 1 일 때 폭(글자 크기에 비례)
 */
export const FIT_LINE = 1.25; // 줄 간격(글자 크기 배)
export function wrapText(value: string, maxW: number, width: (t: string) => number) {
  const out: string[] = [];
  for (const para of value.replace(/\r\n?/g, '\n').split('\n')) {
    let cur = '', cw = 0;
    const push = () => { out.push(cur.trimEnd()); cur = ''; cw = 0; };
    for (const tok of para.split(/(\s+)/)) {
      if (!tok) continue;
      const tw = width(tok);
      if (cw + tw <= maxW) { cur += tok; cw += tw; continue; }
      if (/^\s/.test(tok)) { if (cur) push(); continue; } // 줄 끝 띄어쓰기는 버림
      if (cur.trim()) push(); else { cur = ''; cw = 0; }
      if (tw <= maxW) { cur = tok; cw = tw; continue; }
      for (const ch of tok) { const w = width(ch); if (cur && cw + w > maxW) push(); cur += ch; cw += w; }
    }
    out.push(cur.trimEnd());
  }
  return out;
}
export function fitText(value: string, boxW: number, boxH: number, width: (t: string) => number, o: { max?: number; min?: number; fill?: number } = {}) {
  const min = o.min ?? 5, top = Math.max(min, Math.min(o.max ?? 14, boxH * (o.fill ?? 0.78))), maxW = boxW - 2;
  const memo = new Map<string, number>();
  const w = (t: string) => { let v = memo.get(t); if (v === undefined) memo.set(t, (v = width(t))); return v; };
  const at = (size: number) => { const lines = wrapText(value, maxW / size, w); return { size, lines, over: lines.length * size * FIT_LINE > boxH + 0.01 }; };
  const first = at(top); if (!first.over) return first;
  // 0.5pt 씩 작게(작을수록 줄 수·높이가 줄어듦) — 들어가는 가장 큰 크기를 반 나눠 찾기
  let lo = 1, hi = Math.floor((top - min) / 0.5), best: ReturnType<typeof at> | null = null;
  while (lo <= hi) { const j = (lo + hi) >> 1, r = at(top - 0.5 * j); if (r.over) lo = j + 1; else { best = r; hi = j - 1; } }
  return best ?? at(min);
}
