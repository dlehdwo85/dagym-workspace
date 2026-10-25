/**
 * 로컬 검수 10/19 → #235 ⓑ(대표 노션 '네이버 블로그 자동 작성 툴' 기준): 블로그는 휴대폰에서 읽기 쉽게 — 한 문장 한 줄, 3~5줄마다 빈 줄,
 * 소제목(■)·사진 자리([사진 n] 설명)·인용구(“ ”로 감싼 한 줄)는 제 줄(앞뒤 빈 줄). 피드·릴스 등은 줄바꿈을 그대로 둔다. 화면(게시 도우미)과 서버(자동 원고)가 같이 씀.
 */
export const PHOTO_LINE = /^\[\s*사진\s*(P?)\s*(\d{1,2})\s*\]\s*(.*)$/i;
export const QUOTE_LINE = /^[“"「『].{2,}[”"」』]$/;
export const HEAD_LINE = /^(?:■|##|\[소제목\])/;
/** 소제목·사진 자리·인용구 줄 — 글자만 이어지는 덩어리를 끊는 줄 */
export const specialLine = (l: string) => HEAD_LINE.test(l) || PHOTO_LINE.test(l) || QUOTE_LINE.test(l);
/** 문장 끝(. ! ? 。 뒤 띄어쓰기)에서 나눔 — 숫자 뒤 점(1. · 3.5)·주소(example.com)는 그대로 */
const splitSentences = (line: string) => line.split(/(?<=[^\d\s][.!?。]["”’)」』]*)\s+/).map((x) => x.trim()).filter(Boolean);
/** 3~5줄 묶음: 5줄까지는 한 묶음, 넘으면 4줄 안팎으로 고르게 */
function groups(ls: string[]) {
  if (ls.length <= 5) return ls.length ? [ls.join('\n')] : [];
  const g = Math.ceil(ls.length / 4); const base = Math.floor(ls.length / g); let extra = ls.length % g; const out: string[] = []; let k = 0;
  for (let i = 0; i < g; i++) { const n = base + (extra-- > 0 ? 1 : 0); out.push(ls.slice(k, k + n).join('\n')); k += n; }
  return out;
}
export function layoutBody(kind: string | null | undefined, body: string) {
  const t = body.replace(/\r\n/g, '\n').trim();
  if (kind !== 'blog') return t;
  const norm = t.replace(/[ \t]*\n?[ \t]*■[ \t]*/g, '\n\n■ ').replace(/([^\n])[ \t]*(\[\s*사진\s*P?\s*\d{1,2}\s*\])/gi, '$1\n$2').trim();
  const out: string[] = [];
  for (const block of norm.split(/\n{2,}/)) {
    let run: string[] = [];
    const flush = () => { out.push(...groups(run)); run = []; };
    for (const raw of block.split('\n')) {
      const l = raw.trim(); if (!l) continue;
      if (!specialLine(l)) { run.push(...splitSentences(l)); continue; }
      flush();
      // 소제목에 문장이 붙어 온 경우(마침표로 끝난 첫 문장 뒤에 글이 더 있음): 첫 문장은 소제목 줄로 떼고 나머지는 본문
      const m = HEAD_LINE.test(l) ? l.match(/^([^.。]*?[^\d\s][.。]["”’)」』]*)\s+(.+)$/) : null;
      out.push(m ? m[1] : l);
      if (m) run.push(...splitSentences(m[2]));
    }
    flush();
  }
  return out.join('\n\n');
}
/**
 * #235 ⓑ 블로그 사진 자리: 새 원고 = '[사진 P번호]'(후보 번호 — P 없이 번호만 써도) → '[사진 n] 설명'(n = 글에 나온 순서, 설명 = 사진 AI 설명 한 줄).
 * 모르는 번호·같은 사진 두 번·max 넘는 줄은 지움. 수정본(후보 없음) = 지난 원고의 '[사진 n] …' 줄을 번호로 되살림(새 번호·'P' 줄은 지움)
 */
export function placePhotos(body: string, cand: { id: string; caption: string }[], prev = '', max = 15) {
  const old = new Map<number, string>();
  for (const raw of prev.split('\n')) { const l = raw.trim(); const m = l.match(PHOTO_LINE); if (m && !m[1] && !old.has(Number(m[2]))) old.set(Number(m[2]), l); }
  const ids: string[] = []; const kept = new Set<number>(); const out: string[] = [];
  for (const raw of body.split('\n')) {
    const m = raw.trim().match(PHOTO_LINE);
    if (!m) { out.push(raw); continue; }
    const k = Number(m[2]);
    if (cand.length) {
      const p = cand[k - 1];
      if (p && !ids.includes(p.id) && ids.length < max) { ids.push(p.id); out.push(`[사진 ${ids.length}] ${p.caption}`.trim()); }
    } else if (!m[1] && old.has(k) && !kept.has(k)) { kept.add(k); out.push(old.get(k)!); }
  }
  return { body: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), ids };
}
/** 블로그 형식 숫자(검사·보고서): 글자 수(사진 줄·줄바꿈 빼고) · 사진 줄 · 인용구 · 소제목 · 글자만 이어진 가장 긴 덩어리(소제목·인용구·사진 줄이 끊음)와 그 첫 줄 */
export function blogStats(body: string) {
  let chars = 0, photos = 0, quotes = 0, heads = 0, run = 0, maxRun = 0, start = '', runStart = '';
  for (const raw of body.split('\n')) {
    const l = raw.trim(); if (!l) continue;
    const n = [...l].length;
    if (PHOTO_LINE.test(l)) { photos++; run = 0; continue; }
    chars += n;
    if (QUOTE_LINE.test(l)) { quotes++; run = 0; continue; }
    if (HEAD_LINE.test(l)) { heads++; run = 0; continue; }
    if (!run) start = l;
    run += n; if (run > maxRun) { maxRun = run; runStart = start; }
  }
  return { chars, photos, quotes, heads, maxRun, runStart };
}
/** 복사할 제목: 시험 표시([시험])는 뗀다 */
export const publishTitle = (title: string) => title.replace(/^\s*\[시험\]\s*/, '').trim();
