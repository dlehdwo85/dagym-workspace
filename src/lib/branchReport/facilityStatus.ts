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
