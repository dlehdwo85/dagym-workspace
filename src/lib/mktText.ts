/**
 * 로컬 검수 10/19: 블로그 원고가 한 덩어리로 오면 읽기 어렵다 — 소제목(■)은 앞에 빈 줄을 두고 따로 시작,
 * 빈 줄 없는 긴 문단은 2문장씩 나눔. 피드·릴스 등은 줄바꿈을 그대로 둔다. 화면(게시 도우미)과 서버(자동 원고)가 같이 씀.
 */
export function layoutBody(kind: string | null | undefined, body: string) {
  const t = body.replace(/\r\n/g, '\n').trim();
  if (kind !== 'blog') return t;
  return t.replace(/[ \t]*\n?[ \t]*■[ \t]*/g, '\n\n■ ').trim()
    .split(/\n{2,}/).map((block) => {
      const b = block.trim();
      if (b.includes('\n')) return b; // 이미 줄을 나눠 온 것(소제목 줄 + 본문)은 그대로
      const sents = b.match(/[^.!?。]+[.!?。]+["”’)]*\s*|[^.!?。]+$/g) ?? [b];
      if (sents.length <= 3) return b;
      // 소제목(■)에 문장이 붙어 온 경우: 첫 문장은 소제목 줄에 두고 나머지를 2문장씩
      const head = b.startsWith('■') ? [sents.shift()!.trim()] : [];
      const out: string[] = [];
      for (let k = 0; k < sents.length; k += 2) out.push(sents.slice(k, k + 2).join('').trim());
      return [...head, ...out].join('\n\n');
    }).join('\n\n');
}
/** 복사할 제목: 시험 표시([시험])는 뗀다 */
export const publishTitle = (title: string) => title.replace(/^\s*\[시험\]\s*/, '').trim();
