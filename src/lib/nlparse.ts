/**
 * V8 4번: "내일 3시 김민수 견적서 보내기" → 제목·마감일·시각·담당자.
 * 음성 받아쓰기와 키보드 입력 모두에 쓴다. 화면에서는 "인식한 내용 적용" 으로 확인 후 반영한다.
 */
export type Parsed = { title: string; dueDate: string | null; dueTime: string | null; assigneeId: string | null; assigneeName: string | null; matched: string[];
  /** V8 9번: "!높음" "#프로젝트" "매주" */
  priority: 'low' | 'normal' | 'high' | 'urgent' | null; projectId: string | null; projectName: string | null; rrule: string | null };

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dowOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const NUM: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10, 열한: 11, 열두: 12 };
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s] ?? NaN);

export function parseTaskText(text: string, people: { id: string; name: string }[], today: string, projects: { id: string; name: string }[] = []): Parsed {
  let t = ` ${text.trim()} `;
  const matched: string[] = [];
  const cut = (re: RegExp) => { const m = re.exec(t); if (m) { matched.push(m[0].trim()); t = t.replace(m[0], ' '); } return m; };
  let due: string | null = null, time: string | null = null;
  // 우선순위 "!높음 !긴급 !낮음", 프로젝트 "#이름", 반복 "매일·매주·매월·평일마다"
  let priority: Parsed['priority'] = null, project: { id: string; name: string } | null = null, rrule: string | null = null;
  const pm = cut(/\s!(긴급|급함|높음|중요|보통|낮음)\s/);
  if (pm) priority = ({ 긴급: 'urgent', 급함: 'urgent', 높음: 'high', 중요: 'high', 보통: 'normal', 낮음: 'low' } as const)[pm[1] as '긴급'];
  const hm = /\s#([^\s#]+)\s/.exec(t);
  if (hm) { const p = projects.find((x) => x.name === hm[1]) ?? projects.find((x) => x.name.replace(/\s/g, '').includes(hm[1])); if (p) { cut(/\s#[^\s#]+\s/); project = p; } }
  const rm = cut(/\s(매일|매주|매달|매월|평일마다|주중\s*매일)\s/);

  // 날짜
  let m: RegExpExecArray | null;
  if ((m = cut(/\s(오늘)(까지)?\s/))) due = today;
  else if ((m = cut(/\s(내일)(까지)?\s/))) due = addDays(today, 1);
  else if ((m = cut(/\s(모레)(까지)?\s/))) due = addDays(today, 2);
  else if ((m = cut(/\s(글피)(까지)?\s/))) due = addDays(today, 3);
  else if ((m = cut(/\s(\d{1,2})\s*월\s*(\d{1,2})\s*일(까지)?\s/))) {
    const y = Number(today.slice(0, 4)); let d = `${y}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
    if (d < today) d = `${y + 1}-${d.slice(5)}`; due = d;
  } else if ((m = cut(/\s(\d{1,2})\/(\d{1,2})(까지)?\s/))) {
    const y = Number(today.slice(0, 4)); let d = `${y}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
    if (d < today) d = `${y + 1}-${d.slice(5)}`; due = d;
  } else if ((m = cut(/\s(\d{1,3}|[한두세네]|다섯|여섯|일곱)\s*(일|주)\s*(후|뒤)(에|까지)?\s/))) {
    const n = num(m[1]); due = addDays(today, m[2] === '주' ? n * 7 : n);
  } else if ((m = cut(/\s(다음\s*주|담주|이번\s*주)\s*([일월화수목금토])(요일)?(까지|에)?\s/))) {
    const target = DOW.indexOf(m[2]);
    const mon = addDays(today, -((dowOf(today) + 6) % 7)); // 이번 주 월요일
    const base = /이번/.test(m[1]) ? mon : addDays(mon, 7);
    due = addDays(base, (target + 6) % 7);
  } else if ((m = cut(/\s([일월화수목금토])요일(까지|에)?\s/))) {
    const target = DOW.indexOf(m[1]); let diff = (target - dowOf(today) + 7) % 7; if (diff === 0) diff = 7; due = addDays(today, diff);
  }

  // 시각: "오후 3시 30분", "3시 반", "15:00", "오전 10시"
  if ((m = cut(/\s(오전|오후|아침|저녁|밤)?\s*(\d{1,2}|[한두세네]|다섯|여섯|일곱|여덟|아홉|열|열한|열두)\s*시\s*(반|(\d{1,2})\s*분)?(까지|에)?\s/))) {
    let h = num(m[2]); const min = m[3] === '반' ? 30 : m[4] ? Number(m[4]) : 0;
    if (m[1] === '오후' || m[1] === '저녁' || m[1] === '밤') { if (h < 12) h += 12; } else if (!m[1] && h >= 1 && h <= 7) h += 12; // 업무 시간 기준: "3시" = 오후 3시
    if (h >= 0 && h <= 23) time = `${pad(h)}:${pad(Math.round(min / 15) * 15 === 60 ? 45 : Math.round(min / 15) * 15)}`;
  } else if ((m = cut(/\s(\d{1,2}):(\d{2})(까지|에)?\s/))) {
    const h = Number(m[1]), mi = Number(m[2]); if (h <= 23 && mi < 60) time = `${pad(h)}:${pad(Math.round(mi / 15) * 15 === 60 ? 45 : Math.round(mi / 15) * 15)}`;
  }
  if (time && !due) due = today;

  // 담당자: 이름(@·님·씨·에게·한테 붙어도) — 긴 이름 먼저
  let assignee: { id: string; name: string } | null = null;
  for (const p of [...people].sort((a, b) => b.name.length - a.name.length)) {
    const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\s@?${esc}(님|씨)?(에게|한테|께|이|가)?\\s`);
    if (re.test(t)) { cut(re); assignee = p; break; }
  }
  const title = t.replace(/\s+/g, ' ').trim().replace(/^(까지|에|에게)\s+/, '');
  if (rm) {
    const dow = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][dowOf(due ?? today)];
    rrule = rm[1] === '매일' ? 'FREQ=DAILY' : rm[1] === '매주' ? `FREQ=WEEKLY;BYDAY=${dow}` : /매달|매월/.test(rm[1]) ? `FREQ=MONTHLY;BYMONTHDAY=${Number((due ?? today).slice(8))}` : 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    if (!due) due = today;
  }
  return { title: title || text.trim(), dueDate: due, dueTime: time, assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? null, matched,
    priority, projectId: project?.id ?? null, projectName: project?.name ?? null, rrule };
}

/** 음성 받아쓰기 (Web Speech API, 한국어). 지원 안 하면 null */
export function speechSupported() {
  return typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}
export function listenOnce(onText: (t: string) => void, onEnd: (err?: string) => void) {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SR) { onEnd('unsupported'); return () => {}; }
  const r = new SR();
  r.lang = 'ko-KR'; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
  r.onresult = (e: any) => onText(String(e.results?.[0]?.[0]?.transcript ?? ''));
  r.onerror = (e: any) => onEnd(e?.error ?? 'error');
  r.onend = () => onEnd();
  try { r.start(); } catch { onEnd('error'); }
  return () => { try { r.stop(); } catch { /* 이미 끝남 */ } };
}
