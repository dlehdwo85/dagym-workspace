/**
 * #1096 지점 주간보고 — 읽기 화면·인쇄(A4) 공용(훅 없음: 서버·클라이언트 모두에서 씀).
 * 양식 A(커뮤니티 주간 운영 보고서): 머리(기준일시·작성) · 1. 이용 인원 현황(이용권·락커) · 2. 시설 점검 보고 · 3. 특이사항·건의사항·민원
 */
export type Line = { item: string; status: string; action: string; state: string; evidence: string[] };
export type Body = {
  usage: { item: string; count: string; note?: string }[]; lockers: { name: string; used: string; total: string }[];
  facilities: { name: string; visitors: string; cleaning: string; condition: string; lines: Line[] }[];
  issues: { title: string; details: string[]; state: string; evidence: string[] }[]; notes: string;
};
export const STATE_TONE: Record<string, string> = { '완료': 'text-emerald-700', '진행 중': 'text-sky-700', '확인 필요': 'text-amber-700' };
const th = 'border border-slate-300 bg-slate-50 px-2 py-1 text-left font-semibold';
const td = 'border border-slate-300 px-2 py-1 align-top';
const rate = (u: string, t: string) => { const a = Number(u), b = Number(t); return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? `${Math.round((a / b) * 100)}%` : '-'; };

export function ReportView({ unit, day, start, end, body }: { unit: string; day: string; start: string; end: string; body: Body }) {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  return (
    <article className="space-y-4 text-[13px] leading-relaxed text-slate-900" data-testid="branch-report-view">
      <header className="border-b-2 border-slate-800 pb-2">
        <h1 className="text-lg font-bold">{unit} 커뮤니티 주간 운영 보고서</h1>
        <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-slate-600"><span>기준일시 {md(day)}(금) 11:00 기준 · 기간 {md(start)}~{md(end)}</span><span>작성 주식회사 다짐 (DAGYM)</span></div>
      </header>
      <section>
        <h2 className="mb-1.5 font-bold">1. 이용 인원 현황</h2>
        {body.usage.length ? <table className="w-full border-collapse"><thead><tr><th className={th}>항목</th><th className={th}>인원</th></tr></thead>
          <tbody>{body.usage.map((x, k) => <tr key={k}><td className={td}>{x.item}</td><td className={td}>{x.count}{x.note ? <span className="ml-1 text-slate-500">({x.note})</span> : null}</td></tr>)}</tbody></table>
          : <p className="text-slate-500">이용 인원 자료 없음(확인 필요)</p>}
        {body.lockers.length > 0 && <table className="mt-2 w-full border-collapse"><thead><tr><th className={th}>락커 구분</th><th className={th}>사용</th><th className={th}>전체</th><th className={th}>사용률</th></tr></thead>
          <tbody>{body.lockers.map((x, k) => <tr key={k}><td className={td}>{x.name}</td><td className={td}>{x.used}</td><td className={td}>{x.total}</td><td className={td}>{rate(x.used, x.total)}</td></tr>)}</tbody></table>}
      </section>
      <section>
        <h2 className="mb-1.5 font-bold">2. 시설 점검 보고</h2>
        {body.facilities.length ? body.facilities.map((f, k) => (
          <div key={k} className="mb-2 break-inside-avoid">
            <table className="w-full border-collapse"><thead><tr><th className={th} colSpan={3}>{f.name}</th></tr><tr><th className={th}>총 이용인원</th><th className={th}>청소 상태</th><th className={th}>시설 상태</th></tr></thead>
              <tbody><tr><td className={td}>{f.visitors || '-'}</td><td className={td}>{f.cleaning || '-'}</td><td className={td}>{f.condition || '-'}</td></tr></tbody></table>
            {f.lines.length > 0 && <ul className="mt-1 space-y-0.5 pl-1">{f.lines.map((l, j) => <li key={j}>· {l.item} : {l.status}{l.action ? ` / ${l.action}` : ''} <span className={STATE_TONE[l.state] ?? ''}>[{l.state}]</span></li>)}</ul>}
          </div>)) : <p className="text-slate-500">시설 점검 자료 없음(확인 필요)</p>}
      </section>
      <section>
        <h2 className="mb-1.5 font-bold">3. 특이사항 · 건의사항 · 민원</h2>
        {body.issues.length ? <ol className="list-decimal space-y-1.5 pl-5">{body.issues.map((x, k) => (
          <li key={k} className="break-inside-avoid"><b>{x.title}</b> <span className={STATE_TONE[x.state] ?? ''}>[{x.state}]</span>
            {x.details.length > 0 && <ul className="mt-0.5 space-y-0.5">{x.details.map((d, j) => <li key={j}>- {d}</li>)}</ul>}</li>))}</ol>
          : <p className="text-slate-500">없음</p>}
        {body.notes && <p className="mt-2 whitespace-pre-line text-slate-700">{body.notes}</p>}
      </section>
    </article>
  );
}
