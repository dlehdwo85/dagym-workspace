/**
 * #1096 로컬 운영 확인(11/21): AI 가 '시설 상태' 칸에 원문에 없는 값(청소 상태의 '청결')을 옮겨 적음.
 * 청소 상태·시설 상태는 주간보고 글(D)의 그 시설 블록에 적힌 '청소상태'·'시설상태' 값에서만 받는다 — 숫자 검사와 같은 원칙.
 *  - 시설 블록: `<골프장>`·`[헬스장]`·`【독서실】` 로 시작하는 줄부터 다음 머리 줄 전까지. 그 시설 블록이 없으면 글 전체에서 찾음
 *  - 청소 상태: 값이 그 시설의 '청소상태' 뒤에 적힌 글 안에 있어야 함
 *  - 시설 상태: 위와 같고, 등급 단어(양호·부분양호·미흡·청결 등)여야 함 — "시설상태 : 런닝머신 인버터 청소완료" 처럼 설명만 있으면 '확인 필요'
 * 순수 함수(서버·시험 공용, 외부 모듈 없음).
 */
export const CHECK = '확인 필요';
export const CONDITION_GRADES = ['부분양호', '양호', '미흡', '불량', '보통', '우수', '청결', '정상', '이상없음', '점검필요', '수리필요'];

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const HEADER = /^\s*[<[【]\s*([^>\]】]{1,30}?)\s*[>\]】]/;
const LABEL: Record<'cleaning' | 'condition', RegExp> = {
  cleaning: /청소\s*상태\s*[:：]?\s*([^/\n|,]+)/g,
  condition: /시설\s*상태\s*[:：]?\s*([^/\n|,]+)/g,
};

/** 글을 머리 줄(<시설>) 단위 블록으로 — 머리 줄 내용도 그 블록에 포함 */
function blocks(dText: string): { head: string; text: string }[] {
  const out: { head: string; text: string }[] = [];
  for (const line of dText.split(/\r?\n/)) {
    const h = line.match(HEADER);
    if (h) out.push({ head: h[1], text: line });
    else if (out.length) out[out.length - 1].text += '\n' + line;
  }
  return out;
}

/** 그 시설의 '청소상태'·'시설상태' 뒤에 적힌 값들(시설 블록이 없으면 글 전체) */
export function statusValues(dText: string, facility: string, field: 'cleaning' | 'condition'): string[] {
  const f = norm(facility);
  const own = f ? blocks(dText).filter((b) => { const h = norm(b.head); return h && (h.includes(f) || f.includes(h)); }) : [];
  const src = own.length ? own.map((b) => b.text).join('\n') : dText;
  return Array.from(src.matchAll(LABEL[field]), (m) => m[1].trim()).filter(Boolean);
}

/** 글 속 등급 단어(긴 것부터 — '부분양호' 안의 '양호'를 따로 세지 않음) */
const BY_LEN = [...CONDITION_GRADES].sort((a, b) => b.length - a.length);
export function gradesIn(text: string): string[] {
  let t = norm(text); const out: string[] = [];
  for (const g of BY_LEN) if (t.includes(g)) { out.push(g); t = t.split(g).join('|'); }
  return out;
}

/** 칸 값 검사: 빈 값·'확인 필요'는 그대로, 원문(그 시설의 해당 줄)에 없거나 시설 상태가 등급 단어가 아니면 '확인 필요' */
export function checkFacilityStatus(dText: string, facility: string, field: 'cleaning' | 'condition', value: string): string {
  const v = value.trim();
  if (!v || v === CHECK) return value;
  const nv = norm(v);
  const vals = statusValues(dText, facility, field);
  if (CONDITION_GRADES.includes(nv)) return vals.some((x) => gradesIn(x).includes(nv)) ? value : CHECK;
  if (field === 'condition') return CHECK; // 시설 상태는 등급 단어만
  return vals.some((x) => norm(x).includes(nv)) ? value : CHECK;
}

/**
 * #1105(대표 11/21): 지점 관리자들이 점검 줄에 '0'·'O'·'○' 하나만 적으면 '이상 없음' 뜻.
 * 원문(주간보고 글)에서 그 점검 줄을 찾아 콜론 뒤 값이 그 표시 하나뿐일 때만 status '이상 없음', state '완료'(근거 번호는 그대로, 없으면 그 줄 번호).
 * "진행0"처럼 다른 글자와 붙은 0, 인원·금액 칸은 건드리지 않음. 찾는 줄 = 근거로 든 D 줄 + 그 시설 블록에서 항목 이름이 든 줄
 */
const OK_MARK = /^(?:0|o|O|○|ㅇ)$/;
export function applyOkMark<T extends { item: string; status: string; state: string; evidence: string[] }>(dText: string, facility: string, line: T): T {
  const lines = dText.split(/\r?\n/);
  const item = norm(line.item.replace(/여부$/, ''));
  const fac = norm(facility);
  let head = '';
  const cands = new Set<number>();
  for (const r of line.evidence) { const m = r.match(/^D(\d+)$/); if (m && Number(m[1]) >= 1 && Number(m[1]) <= lines.length) cands.add(Number(m[1])); }
  lines.forEach((l, k) => {
    const h = l.match(HEADER); if (h) head = norm(h[1]);
    const inFac = !fac || !head || head.includes(fac) || fac.includes(head);
    if (item && inFac && norm(l).includes(item)) cands.add(k + 1);
  });
  for (const n of [...cands].sort((a, b) => a - b)) {
    const l = lines[n - 1];
    const i = Math.max(l.lastIndexOf(':'), l.lastIndexOf('：'));
    if (i < 0) continue;
    if (item && !norm(l.slice(0, i)).includes(item) && !line.evidence.includes(`D${n}`)) continue;
    if (OK_MARK.test(l.slice(i + 1).trim())) return { ...line, status: '이상 없음', state: '완료', evidence: line.evidence.length ? line.evidence : [`D${n}`] };
  }
  return line;
}

/**
 * 로컬 11/21 재확인: '청결 / 연습실 내부룸 먼지로 청소완료'처럼 등급 단어 뒤에 설명이 붙으면 통째로 '확인 필요'가 되던 것(과잉 거부).
 * 등급 단어로 시작하면(뒤에 띄어쓰기·'/'·괄호·쉼표 등이 오거나 끝) 등급만 칸에 받고, 뒤 설명은 따로 돌려준다.
 */
export function splitGrade(value: string): { grade: string | null; rest: string } {
  const v = value.trim();
  for (const g of BY_LEN) {
    const m = v.match(new RegExp(`^${g.split('').join('\\s*')}(?=$|[\\s/,(:：·\\-])`));
    if (m) return { grade: m[0], rest: v.slice(m[0].length).replace(/^[\s/,:：·()\-–—]+/, '').replace(/[\s)]+$/, '').trim() };
  }
  return { grade: null, rest: v };
}

type CheckLine = { item: string; status: string; action: string; state: '완료' | '진행 중' | '확인 필요'; evidence: string[] };
const tokens = (s: string) => s.split(/[\s/,·()]+/).map(norm).filter((t) => t.length >= 2);
/** 원문에서 그 설명이 든 줄 번호(낱말이 가장 많이 겹치는 줄, 60% 이상) — 없으면 0 */
function sourceLine(dText: string, text: string): number {
  const ts = tokens(text); if (!ts.length) return 0;
  let best = 0, at = 0;
  dText.split(/\r?\n/).forEach((l, k) => { const n = norm(l); const hit = ts.filter((t) => n.includes(t)).length; if (hit > best) { best = hit; at = k + 1; } });
  return best >= Math.max(1, Math.ceil(ts.length * 0.6)) ? at : 0;
}
/**
 * 시설 하나의 청소 상태·시설 상태 정리: 등급으로 시작하면 등급만 받고(원문 검사 그대로), 뒤 설명이나 받지 못한 설명은 원문에 있을 때만 점검 줄로 살림
 * (이미 같은 내용의 점검 줄이 있으면 더하지 않음). 원문에 없는 설명은 버림(지어낸 것일 수 있음)
 */
export function fixFacilityStatus(dText: string, f: { name: string; cleaning: string; condition: string; lines: CheckLine[] }) {
  const extra: CheckLine[] = [];
  const keep = (text: string) => {
    const ts = tokens(text); if (!ts.length) return;
    const dup = [...f.lines, ...extra].some((l) => { const c = norm(`${l.item}${l.status}${l.action}`); return ts.filter((t) => c.includes(t)).length >= Math.min(2, ts.length); });
    const n = dup ? 0 : sourceLine(dText, text);
    if (n) extra.push({ item: text, status: /완료/.test(text) ? '완료' : '', action: '', state: /완료/.test(text) ? '완료' : CHECK, evidence: [`D${n}`] });
  };
  const one = (field: 'cleaning' | 'condition', value: string) => {
    const s = splitGrade(value);
    const checked = checkFacilityStatus(dText, f.name, field, s.grade && s.rest ? s.grade : value);
    if (s.grade && s.rest) keep(s.rest);
    else if (checked === CHECK && value.trim() && value.trim() !== CHECK && !s.grade) keep(value.trim()); // 등급이 아닌 설명만 들어온 경우
    return checked;
  };
  const cleaning = one('cleaning', f.cleaning), condition = one('condition', f.condition);
  return { cleaning, condition, extra };
}

/**
 * 로컬 11/21 재확인 ①: 점검 줄 이름에 원문 칸 이름이 붙어 나옴("청소상태 부가 설명 : 연습실 내부룸 먼지로 청소완료", "시설상태 : 런닝머신 인버터 청소완료").
 * 칸 이름을 떼고, 이름이 '…완료'로 끝나면 이름은 내용만("런닝머신 인버터 청소"), 상태가 비었으면 '완료'. '예정'이 있으면 그대로
 */
const FIELD_PREFIX = /^\s*(?:청소|시설)\s*상태\s*(?:부가\s*설명|설명|비고)?\s*[:：]\s*/;
export function tidyCheckLine<T extends { item: string; status: string }>(line: T): T {
  let item = line.item.replace(FIELD_PREFIX, '').trim(); let status = line.status;
  const m = item.match(/^(.+?)\s*완료$/);
  if (m && !/예정/.test(item)) { item = m[1].trim(); if (!status.trim()) status = '완료'; }
  if (!item) return line;
  return item === line.item && status === line.status ? line : { ...line, item, status };
}

/**
 * 로컬 11/21 재확인 ②: 원문에 '청소완료'가 있는데 점검 줄 상태가 '확인 필요'로 나옴.
 * 줄 글(이름·상태·조치)에 '완료'가 있고, 근거 D 줄(없으면 원문에서 찾은 줄)에도 '완료'가 있으면 '완료'('예정'이 있으면 그대로)
 */
export function settleDone<T extends { item: string; status: string; action: string; state: string; evidence: string[] }>(dText: string, line: T): T {
  if (line.state !== CHECK) return line;
  const text = `${line.item} ${line.status} ${line.action}`;
  if (!/완료/.test(text) || /예정/.test(text)) return line;
  const lines = dText.split(/\r?\n/);
  const refs = line.evidence.map((r) => r.match(/^D(\d+)$/)).filter((m): m is RegExpMatchArray => !!m).map((m) => Number(m[1])).filter((n) => n >= 1 && n <= lines.length);
  const found = refs.length ? 0 : sourceLine(dText, `${line.item} ${line.status}`.replace(FIELD_PREFIX, ''));
  const look = refs.length ? refs : found ? [found] : [];
  if (!look.some((n) => /완료/.test(lines[n - 1]) && !/예정/.test(lines[n - 1]))) return line;
  return { ...line, state: '완료', status: line.status.trim() || '완료', evidence: refs.length ? line.evidence : [`D${found}`] };
}
