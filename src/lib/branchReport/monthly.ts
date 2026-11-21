import { z } from 'zod';

/**
 * #1096 2단계 — 월간 업무 보고서(양식 B) + 시설별 이용 현황(양식 C) + 미완료 추적. 대표 11/21 양식 구조(로컬 전달):
 *  B: 머리(작성자·소속 '주식회사 다짐 운영팀'·기간 1일~말일·보고일·결재 칸) · ■ 당월 중요업무 내역(업무내용|결과/산출물, 3개 안팎)
 *     · ■ 업무 진행사항(주차|실천업무|중점 확인사항|결과|비고) · ■ 차월 업무목표 및 실천사항(업무목표|실천사항)
 *  C: 시설 | 전달 인원 | 이번달 인원 | 증감 | 증감률(▲▼%) + 전 시설 합계
 * 입력은 그 달(보고일 금요일이 그 달) 제출된 주간보고만. B 세 칸만 AI, C·미완료는 프로그램이 주간보고에서 그대로 계산(AI 가 숫자·상태를 바꾸지 못함).
 * 순수 함수(서버·시험 공용).
 */
export const monthRange = (ym: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const [y, m] = ym.split('-').map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { start: `${ym}-01`, end };
};
export const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 그 달의 몇째 주(보고일 금요일 기준: 1~7일 = 1주차 …) */
export const weekLabel = (friday: string) => `${Math.floor((Number(friday.slice(8, 10)) - 1) / 7) + 1}주차(${md(friday)})`;

const s = (n: number) => z.string().max(n).default('');
const ev = z.array(z.string().max(20)).max(20).default([]);
export const monthlyBodySchema = z.object({
  important: z.array(z.object({ work: s(300), result: s(500), evidence: ev, check: z.boolean().default(false) })).max(10).default([]),
  progress: z.array(z.object({ week: s(40), task: s(500), focus: s(300), result: s(500), note: s(300), evidence: ev, check: z.boolean().default(false) })).max(10).default([]),
  next: z.array(z.object({ goal: s(300), actions: s(500) })).max(10).default([]),
  usage: z.array(z.object({ item: s(100), prev: s(40), cur: s(40) })).max(40).default([]),
  unfinished: z.array(z.object({ title: s(300), since: s(20), lastWeek: s(20), state: s(20) })).max(60).default([]),
  resolved: z.array(z.object({ title: s(300), doneWeek: s(20) })).max(60).default([]),
  notes: z.string().max(2000).default(''),
  sources: z.object({ w: z.array(z.object({ ref: z.string(), reportId: z.string(), day: z.string() })).default([]) }).default({ w: [] }),
});
export type MonthlyBody = z.infer<typeof monthlyBodySchema>;

/** 주간보고 본문(주간 양식에서 필요한 것만) */
export type WeeklyIn = { id: string; day: string; body: {
  usage?: { item: string; count: string }[];
  facilities?: { name: string; visitors?: string; lines?: { item: string; status?: string; action?: string; state: string }[] }[];
  issues?: { title: string; details?: string[]; state: string }[];
} };

const norm = (t: string) => t.replace(/\s+/g, '').toLowerCase();

/** 미완료 추적: 주마다 특이사항·점검 줄의 상태를 이어 봄 — 마지막 상태가 완료가 아니면 미완료, 앞에서 진행 중·확인 필요였다가 뒤에 완료면 '완료로 바뀜'(완료 주) */
export function trackItems(weeklies: WeeklyIn[]) {
  const map = new Map<string, { title: string; since: string; lastWeek: string; state: string; wasOpen: boolean; doneWeek: string }>();
  for (const w of [...weeklies].sort((a, b) => a.day.localeCompare(b.day))) {
    const items = [
      ...(w.body.issues ?? []).map((x) => ({ title: x.title, state: x.state })),
      ...(w.body.facilities ?? []).flatMap((f) => (f.lines ?? []).map((l) => ({ title: `${f.name} · ${l.item}`, state: l.state }))),
    ].filter((x) => x.title.trim());
    for (const x of items) {
      const k = norm(x.title);
      const cur = map.get(k);
      if (!cur) { map.set(k, { title: x.title.trim(), since: w.day, lastWeek: w.day, state: x.state, wasOpen: x.state !== '완료', doneWeek: x.state === '완료' ? w.day : '' }); continue; }
      const doneNow = x.state === '완료' && cur.state !== '완료';
      map.set(k, { ...cur, lastWeek: w.day, state: x.state, wasOpen: cur.wasOpen || x.state !== '완료', doneWeek: doneNow ? w.day : x.state === '완료' ? cur.doneWeek : '' });
    }
  }
  const all = [...map.values()];
  return {
    unfinished: all.filter((x) => x.state !== '완료').map((x) => ({ title: x.title, since: md(x.since), lastWeek: md(x.lastWeek), state: x.state })),
    resolved: all.filter((x) => x.state === '완료' && x.wasOpen && x.doneWeek && x.doneWeek !== x.since).map((x) => ({ title: x.title, doneWeek: md(x.doneWeek) })),
  };
}

/** 양식 C: 이번달 = 그 달 마지막 주간보고의 이용 인원, 전달 = 지난달 마지막 주간보고의 이용 인원(없으면 빈칸) — 항목 이름이 같은 것끼리 */
export function usageC(month: WeeklyIn[], prev: WeeklyIn | null) {
  const last = (ws: WeeklyIn[], item: string) => { for (const w of [...ws].sort((a, b) => b.day.localeCompare(a.day))) { const u = (w.body.usage ?? []).find((x) => norm(x.item) === norm(item)); if (u) return u.count; } return ''; };
  const names: string[] = [];
  for (const w of [...month].sort((a, b) => b.day.localeCompare(a.day))) for (const u of w.body.usage ?? []) if (u.item.trim() && !names.some((n) => norm(n) === norm(u.item))) names.push(u.item.trim());
  return names.map((item) => ({ item, prev: prev ? last([prev], item) : '', cur: last(month, item) }));
}
/** 숫자 읽기('443명'·'1,234' → 수) — 숫자가 아니면 null */
export const numOf = (v: string) => { const m = v.replace(/,/g, '').match(/^\s*(-?\d+(?:\.\d+)?)\s*(명|건|개|회)?\s*$/); return m ? Number(m[1]) : null; };
/** 합계(로컬 11/21: 다른 칸처럼 단위를 붙임 — 값들이 같은 단위(명·건·개·회)면 '543명') — 빈 칸·숫자 아닌 값이 있으면 빈 글 */
export const sumCol = (vals: string[]) => {
  const n = vals.map(numOf);
  if (!vals.length || n.some((x) => x === null)) return '';
  const units = new Set(vals.map((v) => String(v ?? '').match(/(명|건|개|회)\s*$/)?.[1]).filter(Boolean));
  return `${n.reduce<number>((a, x) => a + (x ?? 0), 0)}${units.size === 1 ? [...units][0] : ''}`;
};
/** 증감·증감률(▲▼) — 둘 다 숫자일 때만 */
export function delta(prev: string, cur: string) {
  const a = numOf(prev), b = numOf(cur);
  if (a === null || b === null) return { diff: '', rate: '' };
  const d = b - a;
  const rate = a === 0 ? '' : `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${Math.abs(Math.round((d / a) * 1000) / 10)}%`;
  return { diff: `${d > 0 ? '+' : ''}${d}`, rate };
}

/** AI 에 줄 주간보고 요약(W1… 번호) — 개인정보는 주간보고 단계에서 이미 가림 */
export function weeklyDigest(weeklies: WeeklyIn[]) {
  const ws = [...weeklies].sort((a, b) => a.day.localeCompare(b.day));
  const text = ws.map((w, k) => {
    const b = w.body;
    const parts = [`W${k + 1} ${weekLabel(w.day)} 주간보고`];
    if (b.usage?.length) parts.push(`이용 인원: ${b.usage.map((u) => `${u.item} ${u.count}`).join(' / ')}`);
    for (const f of b.facilities ?? []) parts.push(`[${f.name}]${f.visitors ? ` 총 이용인원 ${f.visitors}` : ''}\n${(f.lines ?? []).map((l) => `- ${l.item} : ${[l.status, l.action].filter(Boolean).join(' / ')} (${l.state})`).join('\n')}`);
    for (const x of b.issues ?? []) parts.push(`특이사항: ${x.title} (${x.state})${x.details?.length ? `\n${x.details.map((d) => `  - ${d}`).join('\n')}` : ''}`);
    return parts.join('\n');
  }).join('\n\n');
  return { text, sources: ws.map((w, k) => ({ ref: `W${k + 1}`, reportId: w.id, day: w.day })) };
}

export const MONTHLY_SYSTEM = `다짐 커뮤니티(아파트 단지 커뮤니티 시설 위탁 운영) 지점의 '월간 업무 보고서' 초안을 만듭니다. 한국어, JSON 만.
자료: 그 달 제출된 주간보고 요약(W1, W2 …)과 프로그램이 정리한 미완료·완료로 바뀐 항목. 개인정보는 이미 가려져 있습니다 — 되살리지 마세요.
양식:
1. important(당월 중요업무 내역): 3개 안팎 — work(업무내용) · result(결과/산출물) · evidence(근거 W번호). 민원 처리·보수/점검·운영 변화 중 중요한 것. 같은 일을 여러 주에 말했으면 하나로 합치고 최종 결과를 씀(완료된 주 포함).
2. progress(업무 진행사항): 주간보고 한 주에 한 줄 — week('1주차(11/7)'처럼 자료의 주차 그대로) · task(실천업무) · focus(중점 확인사항) · result(결과) · note(비고, 없으면 빈 글) · evidence(그 주 W번호).
3. next(차월 업무목표 및 실천사항): 미완료 항목과 되풀이된 문제에서만 — goal(업무목표) · actions(실천사항). 자료에 없는 새 사업·숫자 목표를 지어내지 않음.
규칙: 숫자·날짜·금액은 자료에 있는 것만. 모르면 '확인 필요'. 끝나지 않은 일을 완료라고 쓰지 않음.`;
export const MONTHLY_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['important', 'progress', 'next', 'notes'],
  properties: {
    important: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['work', 'result', 'evidence'], properties: { work: { type: 'string' }, result: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } } } },
    progress: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['week', 'task', 'focus', 'result', 'note', 'evidence'], properties: { week: { type: 'string' }, task: { type: 'string' }, focus: { type: 'string' }, result: { type: 'string' }, note: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } } } },
    next: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['goal', 'actions'], properties: { goal: { type: 'string' }, actions: { type: 'string' } } } },
    notes: { type: 'string' },
  },
};

/** AI 결과 검사: 없는 W번호는 지움 · 근거가 하나도 없거나 자료에 없는 숫자가 든 줄은 check(확인 필요 표시) */
export function verifyMonthly(b: MonthlyBody, ctx: { refs: Set<string>; text: string }) {
  const plain = ctx.text.replace(/,/g, '');
  const numsOk = (v: string) => (v.match(/\d[\d,]*/g) ?? []).map((x) => x.replace(/,/g, '')).every((d) => new RegExp(`(?<!\\d)${d}(?!\\d)`).test(plain));
  let fixed = 0;
  const fix = <T extends { evidence: string[]; check: boolean }>(x: T, texts: string[]): T => {
    const e = x.evidence.filter((r) => ctx.refs.has(r));
    const check = !e.length || !texts.every(numsOk);
    if (check !== x.check || e.length !== x.evidence.length) fixed++;
    return { ...x, evidence: e, check };
  };
  return {
    body: { ...b, important: b.important.map((x) => fix(x, [x.work, x.result])), progress: b.progress.map((x) => fix(x, [x.task, x.focus, x.result, x.note])) },
    fixed,
  };
}
