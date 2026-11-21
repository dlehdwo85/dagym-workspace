/**
 * #1106(대표 11/21): 월간 보고 C(시설별 이용 현황)는 하이링크가 집계한 이용현황 파일에서 — 워크인이 주간 글로 계산하지 않음.
 * 하이링크 '시설별 이용현황'(시설 | 전달 인원 | 이번달 인원 | 증감 | 증감률 + 전시설 총 이용현황) 글자를 줄 단위가 아니라 낱말 흐름으로 읽음
 * (PDF 글자 추출은 칸 사이 띄어쓰기·줄바꿈이 들쭉날쭉 — '헬스장1,234명1,240명+6명▲ 0.4%'처럼 붙어 나오기도 함). 값은 원문 그대로 둠.
 * 순수 함수(서버·시험 공용).
 */
export type UsageRow = { item: string; prev: string; cur: string; diff: string; rate: string };

const COUNT = /^-?[\d,]+(?:명|건|회)?$/;          // 1,234명 · 0
const SIGNED = /^[+\-][\d,]+(?:명|건|회)?$/;      // +6명 · -95명
const RATE = /^[▲▼△▽]?-?[\d.]+%$/;              // ▲0.4% · 0%
const DASH = /^[-–—]$/;
const HEADER = /^(시설|시설명|구분|전달|전월|지난달|이번달|당월|금월|인원|이용인원|증감|증감률|증감율|비고|시설별|순번|번호|No\.?)$/i;
const HEAD_END = /증감[률율]/; // 머리말 마지막 칸 — 글자가 붙어 나와도 그 뒤부터가 첫 시설 이름
const DATEISH = /^(\d{2,4}(년|\.|-|\/)|\d{1,2}(월|일)$|\(\S+\)$)/;
const TOTAL = /합계|총\s*이용|총계|전\s*시설|전체/;

/** 글자 흐름을 낱말로: 붙어 나온 값 사이를 띄움(단위·% 뒤, ▲▼·+ 앞, 한글·영문 뒤 숫자) */
export function tokens(text: string): string[] {
  const t = text.replace(/[−‒]/g, '-').replace(/ /g, ' ')
    .replace(/(명|건|회|%)(?=\S)/g, '$1 ')
    .replace(/([▲▼△▽])\s+/g, '$1')
    .replace(/(?<=\S)(?=[▲▼△▽+])/g, ' ')
    .replace(/(?<=[가-힣A-Za-z)\]])(?=[\d])/g, ' ');
  return t.split(/\s+/).filter(Boolean);
}
const isNum = (s: string) => COUNT.test(s) || SIGNED.test(s) || RATE.test(s) || DASH.test(s);

/** 표 읽기: 이름 낱말(머리말·날짜는 건너뜀) 뒤에 '전달 · 이번달 · (증감) · (증감률)' 이 오면 한 줄. 합계 줄은 따로 */
export function parseHilinkUsage(text: string): { rows: UsageRow[]; total: UsageRow | null } {
  const ts = tokens(text);
  const rows: UsageRow[] = []; let total: UsageRow | null = null;
  let name: string[] = [];
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i];
    if (!isNum(t)) {
      if (HEAD_END.test(t) && !HEADER.test(t)) { const rest = t.split(HEAD_END).pop() ?? ''; name = rest ? [rest] : []; continue; }
      if (HEADER.test(t) || DATEISH.test(t)) { name = []; continue; }
      name.push(t); if (name.length > 4) name.shift();
      continue;
    }
    if (!name.length || !(COUNT.test(t) || DASH.test(t)) || !(COUNT.test(ts[i + 1] ?? '') || DASH.test(ts[i + 1] ?? ''))) { name = []; continue; }
    const row: UsageRow = { item: name.join(' '), prev: t, cur: ts[i + 1], diff: '', rate: '' };
    let j = i + 2;
    if (ts[j] !== undefined && (SIGNED.test(ts[j]) || COUNT.test(ts[j]) || DASH.test(ts[j])) && !RATE.test(ts[j])) { row.diff = ts[j]; j++; }
    if (ts[j] !== undefined && (RATE.test(ts[j]) || DASH.test(ts[j]))) { row.rate = ts[j]; j++; }
    if (!row.diff && !row.rate) { name = []; continue; } // 두 숫자만 있으면 표 줄로 보지 않음(제목의 날짜·쪽 번호 등)
    if (TOTAL.test(row.item)) total = row; else rows.push(row);
    i = j - 1; name = [];
  }
  return { rows: rows.slice(0, 40), total };
}
