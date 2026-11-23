/**
 * #1096 2단계 — 월간 업무 보고서(양식 B) + 시설별 이용 현황(양식 C) + 미완료. 읽기 화면·인쇄(A4) 공용(훅 없음).
 */
import { memberTables, type MemberSel, type PassKind } from '@/lib/branchReport/memberList';

export type MonthlyBody = {
  important: { work: string; result: string; evidence: string[]; check?: boolean }[];
  progress: { week: string; task: string; focus: string; result: string; note: string; evidence: string[]; check?: boolean }[];
  next: { goal: string; actions: string }[];
  usage: { item: string; prev: string; cur: string; diff?: string; rate?: string }[];
  /** #1106: 하이링크 이용현황 파일에서 읽은 합계 줄(원문 그대로) · 올린 파일 표시 · 주간 값 제안 */
  usageTotal?: { item: string; prev: string; cur: string; diff: string; rate: string } | null;
  usageFile?: { name: string; size: number; parsed: boolean; rows: number; at: string } | null;
  usageWeekly?: { item: string; prev: string; cur: string }[];
  members?: MembersBody | null;
  unfinished: { title: string; since: string; lastWeek: string; state: string }[];
  resolved: { title: string; doneWeek: string }[];
  notes: string;
  /** #1116 서버가 정함 — 최근 6개월 흐름 · 이번 달 민원·특이사항 */
  flow?: MonthFlowView | null;
  issuesMonth?: { title: string; first: string; last: string; state: string; details: string[]; weeks: number }[] | null;
};
export type MonthFlowView = { months: string[]; rows: { key: string; label: string; vals: (number | null)[]; money?: boolean }[]; notes: string[] };
/** #1116 표지 표시 · #1117 승인 뒤에만 '고객사 제출용'(그 전은 '초안 — 고객사 제출 금지'·'승인 대기 — …') */
export type Mark = { final: boolean; text: string };
export function ClientMark({ mark }: { mark?: Mark }) {
  const m = mark ?? { final: false, text: '초안 — 고객사 제출 금지' };
  return <span className={`ml-2 inline-block rounded border px-1.5 py-0.5 align-middle text-[11px] font-semibold ${m.final ? 'border-teal-700 text-teal-800' : 'border-amber-500 text-amber-700'}`} data-testid="branch-client-mark">{m.text}</span>;
}
const STATE_TONE2: Record<string, string> = { '완료': 'text-emerald-700', '진행 중': 'text-sky-700', '확인 필요': 'text-amber-700' };
/** #1116 최근 6개월 흐름(표 + 작은 막대) — 막대는 그 줄의 가장 큰 값 기준 */
export function FlowSection({ flow }: { flow: MonthFlowView }) {
  const ml = (m: string) => `${Number(m.slice(5, 7))}월`;
  return (
    <section data-testid="branch-flow">
      <h2 className="mb-1.5 font-bold">■ 최근 6개월 흐름 <span className="text-xs font-normal text-slate-500">({flow.months[0]} ~ {flow.months[flow.months.length - 1]})</span></h2>
      <table className="w-full border-collapse"><thead><tr><th className={th}>구분</th>{flow.months.map((m) => <th key={m} className={`${th} text-right`}>{ml(m)}</th>)}</tr></thead>
        <tbody>{flow.rows.map((r) => { const max = Math.max(0, ...r.vals.map((v) => v ?? 0)); return (
          <tr key={r.key} data-testid={`branch-flow-${r.key}`}><td className={`${td} whitespace-nowrap`}>{r.label}</td>{r.vals.map((v, k) => (
            <td key={k} className={`${td} text-right tabular-nums`}>{v === null ? '-' : v.toLocaleString('ko-KR')}
              {v !== null && max > 0 && <div className="mt-0.5 h-1 rounded-sm bg-teal-700" style={{ width: `${Math.max(4, Math.round((v / max) * 100))}%`, marginLeft: 'auto', printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }} />}</td>))}</tr>); })}</tbody></table>
      {flow.notes.map((n) => <p key={n} className="mt-1 text-[11px] text-slate-500">{n}</p>)}
    </section>
  );
}
/** #1116 이번 달 민원·특이사항(처리 결과 포함) — 그 달 주간보고에서 */
export function MonthIssuesSection({ items }: { items: NonNullable<MonthlyBody['issuesMonth']> }) {
  return (
    <section data-testid="branch-month-issues">
      <h2 className="mb-1.5 font-bold">■ 이번 달 민원·특이사항(처리 결과 포함)</h2>
      {items.length ? <table className="w-full border-collapse"><thead><tr><th className={`${th} w-8`}>#</th><th className={th}>내용</th><th className={th}>처음 보고</th><th className={th}>처리 결과</th></tr></thead>
        <tbody>{items.map((x, k) => <tr key={k}><td className={td}>{k + 1}</td><td className={td}><div className="font-medium">{x.title}</div>{x.details.length > 0 && <ul className="mt-0.5 list-disc pl-4 text-[12px] text-slate-700">{x.details.map((d, j) => <li key={j}>{d}</li>)}</ul>}</td>
          <td className={`${td} whitespace-nowrap`}>{x.first}</td><td className={`${td} whitespace-nowrap ${STATE_TONE2[x.state] ?? ''}`}>{x.state}{x.last !== x.first ? <span className="text-slate-500"> · {x.last} 기준</span> : null}</td></tr>)}</tbody></table>
        : <p className="text-slate-500">이번 달 주간보고에 적힌 민원·특이사항이 없습니다</p>}
    </section>
  );
}
const th = 'border border-slate-300 bg-slate-50 px-2 py-1 text-left font-semibold';
const td = 'border border-slate-300 px-2 py-1 align-top';
/** 숫자 읽기('443명'·'1,234' → 수) — 숫자가 아니면 null (서버 monthly.ts numOf 와 같은 규칙) */
export const numOf = (v: string) => { const m = String(v ?? '').replace(/,/g, '').match(/^\s*(-?\d+(?:\.\d+)?)\s*(명|건|개|회)?\s*$/); return m ? Number(m[1]) : null; };
export function delta(prev: string, cur: string) {
  const a = numOf(prev), b = numOf(cur);
  if (a === null || b === null) return { diff: '', rate: '' };
  const d = b - a;
  return { diff: `${d > 0 ? '+' : ''}${d}`, rate: a === 0 ? '' : `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${Math.abs(Math.round((d / a) * 1000) / 10)}%` };
}
/** 합계(로컬 11/21: 다른 칸처럼 단위를 붙임 — 값들이 같은 단위(명·건·개·회)면 '543명') — 빈 칸·숫자 아닌 값이 있으면 빈 글 */
export const sumCol = (vals: string[]) => {
  const n = vals.map(numOf);
  if (!vals.length || n.some((x) => x === null)) return '';
  const units = new Set(vals.map((v) => String(v ?? '').match(/(명|건|개|회)\s*$/)?.[1]).filter(Boolean));
  return `${n.reduce<number>((a, x) => a + (x ?? 0), 0)}${units.size === 1 ? [...units][0] : ''}`;
};
export const usageTotal = (usage: MonthlyBody['usage']) => ({ prev: sumCol(usage.map((x) => x.prev)), cur: sumCol(usage.map((x) => x.cur)) });

/** #1112·#1115 하이링크 회원목록 집계 — 화면·인쇄 공용. 표는 memberTables(이용권 현황·수강권 현황·전체 합계) 그대로 */
export type MembersBody = { v?: number; month: string; fileName: string; at: string; excluded: number; exclude: boolean; stats: unknown; statsAll: unknown;
  prev: { month: string; stats: unknown; statsAll: unknown } | null; kinds?: Record<string, PassKind>; unconfirmed?: string[] };
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const num = (n: number, money?: boolean) => (money ? won(n) : n.toLocaleString('ko-KR'));
export const signed = (n: number | null, money?: boolean) => (n === null ? '-' : `${n > 0 ? '+' : ''}${num(n, money)}`);
export const rateText = (r: number | null) => (r === null ? '-' : `${r > 0 ? '▲' : r < 0 ? '▼' : ''}${Math.abs(r)}%`);
export function MembersSection({ m, title = true, sel }: { m: MembersBody; title?: boolean; sel?: MemberSel }) {
  const tables = memberTables(m, sel);
  return (
    <section data-testid="branch-members" className="space-y-3">
      {title && <h2 className="mb-1.5 font-bold">회원 현황(하이링크 회원목록)</h2>}
      {tables.map((tb) => (
        <div key={tb.key} data-testid={`branch-members-${tb.key}`}>
          <h3 className="mb-1 text-[13px] font-semibold">{tb.title}</h3>
          <table className="w-full border-collapse"><thead><tr><th className={th}>구분</th><th className={th}>전달</th><th className={th}>이번달</th><th className={th}>증감</th><th className={th}>증감률</th></tr></thead>
            <tbody>{tb.rows.map((x) => (
              <tr key={x.label} className={[x.drop && 'text-red-700', x.total && 'font-semibold'].filter(Boolean).join(' ') || undefined}><td className={td}>{x.label}</td><td className={td}>{x.prev === null ? '-' : num(x.prev, x.money)}</td><td className={td}>{num(x.cur, x.money)}</td>
                <td className={td}>{signed(x.diff, x.money)}</td><td className={td}>{rateText(x.rate)}{x.drop ? ' (30% 넘게 줄어듦)' : ''}</td></tr>))}</tbody></table>
          {tb.folded && tb.folded.length > 0 && <details className="mt-1 text-[12px] text-slate-600"><summary className="cursor-pointer">활성 0인 강좌 {tb.folded.length}개</summary>{tb.folded.join(' · ')}</details>}
          {tb.notes.map((n) => <p key={n} className="mt-1 text-[11px] text-slate-500">{n}</p>)}
        </div>))}
    </section>
  );
}

export function MonthlyView({ unit, start, end, author, reportDay, body, mark }: { unit: string; start: string; end: string; author: string; reportDay: string; body: MonthlyBody; mark?: Mark }) {
  const st = body.usageTotal; const calc = usageTotal(body.usage);
  const tot = st ?? { item: '전 시설 합계', prev: calc.prev, cur: calc.cur, diff: '', rate: '' }; const td2 = delta(tot.prev, tot.cur);
  const file = body.usageFile;
  return (
    <article className="space-y-4 text-[13px] leading-relaxed text-slate-900" data-testid="branch-monthly-view">
      <header className="flex items-start justify-between gap-3 border-b-2 border-slate-800 pb-2">
        <div>
          <h1 className="text-lg font-bold">{unit} 월간 업무 보고서<ClientMark mark={mark} /></h1>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-slate-600">
            <span>작성자</span><span>{author || '-'}</span><span>소속</span><span>주식회사 다짐 운영팀</span>
            <span>기간</span><span>{start} ~ {end}</span><span>보고일</span><span>{reportDay}</span>
          </div>
        </div>
        <table className="shrink-0 border-collapse text-center text-xs"><tbody><tr><td className={th}>결재</td><td className={th}>담당</td></tr><tr><td className={`${td} h-10`} /><td className={`${td} h-10 w-16`} /></tr></tbody></table>
      </header>
      <section>
        <h2 className="mb-1.5 font-bold">■ 당월 중요업무 내역</h2>
        {body.important.length ? <table className="w-full border-collapse"><thead><tr><th className={`${th} w-8`}>#</th><th className={th}>업무내용</th><th className={th}>결과/산출물</th></tr></thead>
          <tbody>{body.important.map((x, k) => <tr key={k}><td className={td}>{k + 1}</td><td className={td}>{x.work}</td><td className={td}>{x.result}</td></tr>)}</tbody></table> : <p className="text-slate-500">없음</p>}
      </section>
      <section>
        <h2 className="mb-1.5 font-bold">■ 업무 진행사항</h2>
        {body.progress.length ? <table className="w-full border-collapse"><thead><tr><th className={th}>주차</th><th className={th}>실천업무</th><th className={th}>중점 확인사항</th><th className={th}>결과</th><th className={th}>비고</th></tr></thead>
          <tbody>{body.progress.map((x, k) => <tr key={k}><td className={`${td} whitespace-nowrap`}>{x.week}</td><td className={td}>{x.task}</td><td className={td}>{x.focus}</td><td className={td}>{x.result}</td><td className={td}>{x.note}</td></tr>)}</tbody></table> : <p className="text-slate-500">없음</p>}
      </section>
      <section>
        <h2 className="mb-1.5 font-bold">■ 차월 업무목표 및 실천사항</h2>
        {body.next.length ? <table className="w-full border-collapse"><thead><tr><th className={th}>업무목표</th><th className={th}>실천사항</th></tr></thead>
          <tbody>{body.next.map((x, k) => <tr key={k}><td className={td}>{x.goal}</td><td className={td}>{x.actions}</td></tr>)}</tbody></table> : <p className="text-slate-500">없음</p>}
      </section>
      {body.issuesMonth && <MonthIssuesSection items={body.issuesMonth} />}
      {body.unfinished.length > 0 && <section>
        <h2 className="mb-1.5 font-bold">■ 미완료(다음 달 확인)</h2>
        <table className="w-full border-collapse"><thead><tr><th className={th}>항목</th><th className={th}>상태</th><th className={th}>처음</th><th className={th}>마지막 주</th></tr></thead>
          <tbody>{body.unfinished.map((x, k) => <tr key={k}><td className={td}>{x.title}</td><td className={td}>{x.state}</td><td className={td}>{x.since}</td><td className={td}>{x.lastWeek}</td></tr>)}</tbody></table>
      </section>}
      <section className="break-before-page">
        <h2 className="mb-1.5 font-bold">시설별 이용 현황</h2>
        {body.usage.length ? <table className="w-full border-collapse"><thead><tr><th className={th}>시설</th><th className={th}>전달 인원</th><th className={th}>이번달 인원</th><th className={th}>증감</th><th className={th}>증감률</th></tr></thead>
          <tbody>{body.usage.map((x, k) => { const d = delta(x.prev, x.cur); return <tr key={k}><td className={td}>{x.item}</td><td className={td}>{x.prev || '-'}</td><td className={td}>{x.cur || '-'}</td><td className={td}>{x.diff || d.diff || '-'}</td><td className={td}>{x.rate || d.rate || '-'}</td></tr>; })}
            <tr className="font-semibold"><td className={td}>{tot.item || '전 시설 합계'}</td><td className={td}>{tot.prev || '-'}</td><td className={td}>{tot.cur || '-'}</td><td className={td}>{tot.diff || td2.diff || '-'}</td><td className={td}>{tot.rate || td2.rate || '-'}</td></tr></tbody></table>
          : <p className="text-slate-500" data-testid="branch-usage-empty">{file ? `하이링크 이용현황 첨부: ${file.name} — 표를 읽지 못해 원본을 첨부했습니다` : '하이링크 이용현황 미첨부 — 월간 화면에서 하이링크 이용현황(PDF·엑셀)을 올려 주세요'}</p>}
        <p className="mt-1 text-[11px] text-slate-500">{file ? `출처: 하이링크 이용현황(${file.name})${file.parsed ? '' : ' — 원본 첨부'}` : body.usage.length ? '직접 입력한 값' : ''}</p>
      </section>
      {body.flow && <FlowSection flow={body.flow} />}
      {body.members && <MembersSection m={body.members} />}
      {body.notes && <section><h2 className="mb-1 font-bold">메모</h2><p className="whitespace-pre-line">{body.notes}</p></section>}
    </article>
  );
}
