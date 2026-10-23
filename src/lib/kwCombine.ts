/**
 * #499-2 키워드 N단 조합기(테크트리 EP.7 '키워드 조합 절차', 서버·화면 공용 — DB 없음).
 * 핵심 키워드를 단어 그룹 2~4개로 나누고 그룹 순서대로 모든 조합을 만든다(예: [아파트·단지] × [커뮤니티·헬스장] × [운영·위탁운영]).
 * - '빼도 됨' 그룹은 그 그룹 없이 만든 조합도 함께 만든다(예: 첫 그룹을 빼면 '커뮤니티 운영'도).
 * - 띄어쓰기는 보기 좋게 남긴다(네이버에는 붙여 보냄). 띄어쓰기를 빼면 같은 조합·25자 넘는 조합·한 단어만 남는 조합은 뺀다.
 * - 세팅안 키워드는 PLAN_KEYWORDS_MAX 개까지 — 조합이 더 많으면 앞에서부터 자르고 truncated 로 알린다.
 */
export const PLAN_KEYWORDS_MAX = 300; // 네이버 광고그룹 키워드 한도(1,000)보다 작게 — 대표 결정 전 기본값(테크트리 C '최대 300개')
export const KW_MAX_LEN = 25;
export type KwGroup = { words: string[]; optional?: boolean };
export const kwNorm = (k: string) => k.replace(/\s+/g, '').toLowerCase();

export function combineKeywords(groups: KwGroup[], max = PLAN_KEYWORDS_MAX) {
  const gs = groups.map((g) => ({ words: [...new Set(g.words.map((w) => w.trim()).filter(Boolean))], optional: !!g.optional })).filter((g) => g.words.length);
  const keywords: string[] = []; const seen = new Set<string>(); let truncated = false;
  const walk = (i: number, acc: string[]): boolean => { // false = 그만(최대 개수를 넘는 조합이 하나 더 있음)
    if (i === gs.length) {
      if (acc.length < 2) return true; // 한 단어짜리는 핵심 키워드 칸에서
      const k = acc.join(' '); const key = kwNorm(k);
      if ([...k].length > KW_MAX_LEN || seen.has(key)) return true;
      if (keywords.length >= max) { truncated = true; return false; }
      seen.add(key); keywords.push(k);
      return true;
    }
    for (const w of gs[i].words) if (!walk(i + 1, [...acc, w])) return false;
    return gs[i].optional ? walk(i + 1, acc) : true;
  };
  walk(0, []);
  return { keywords, truncated };
}
