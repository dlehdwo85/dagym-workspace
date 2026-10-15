'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, RotateCcw, Upload } from 'lucide-react';
import { api, broadcastRefresh } from '@/components/client';
import { Button, Card, PageHeader, cx, inputCls, toast } from '@/components/ui';

/** V30 P1 ① 엑셀·CSV 로 업무 가져오기 — 파일 → 열 짝 → 미리보기(담당자 맞추기) → 만들기 → (하루 안) 되돌리기 */
const FIELDS = [['title', '제목', true], ['assignee', '담당자'], ['dueDate', '마감일'], ['priority', '우선순위'], ['status', '상태'], ['description', '설명'], ['startDate', '시작일'], ['project', '프로젝트'], ['tags', '태그']] as const;
type Field = typeof FIELDS[number][0];
type Parsed = { headers: string[]; rows: string[][]; mapping: Partial<Record<Field, number>> };
type Row = { row: number; skip: boolean; empty?: boolean; errors: string[]; warnings: string[];
  task?: { title: string; assigneeId: string | null; assigneeRaw: string | null; assigneeName: string | null; dueDate: string | null; startDate: string | null; priority: string; status: string; tags: string[] } };
type Preview = { rows: Row[]; unmatched: { value: string; why: 'none' | 'many'; rows: number }[]; people: { id: string; name: string; title: string | null }[]; counts: { total: number; ready: number; errors: number; skipped: number } };
const PRI: Record<string, string> = { urgent: '긴급', high: '높음', normal: '보통', low: '낮음' };
const ST: Record<string, string> = { todo: '진행 전', in_progress: '진행 중', on_hold: '보류' };

const toBase64 = (f: File) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => fail(r.error); r.readAsDataURL(f); });

export default function TaskImport() {
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [amap, setAmap] = useState<Record<string, string | null>>({});
  const [skip, setSkip] = useState<number[]>([]);
  const [pv, setPv] = useState<Preview | null>(null);
  /** 고른 뒤에도 고르는 칸이 남도록 한 번 못 찾은 이름은 기억 */
  const [known, setKnown] = useState<Preview['unmatched']>([]);
  const [done, setDone] = useState<{ importId: string; created: number; failed: { row: number; message: string }[]; skipped: number } | null>(null);
  const [undone, setUndone] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  async function pick(f: File | undefined) {
    if (!f) return;
    if (!/\.(xlsx|csv|txt|tsv)$/i.test(f.name)) { toast.error(/\.xls$/i.test(f.name) ? '옛 엑셀(.xls)은 읽지 못합니다 — .xlsx 또는 CSV 로 저장해 주세요' : '.xlsx 또는 .csv 파일을 골라 주세요'); return; }
    if (f.size > 3 * 1024 * 1024) { toast.error('파일이 너무 큽니다(3MB 까지) — CSV 로 저장하면 작아집니다'); return; }
    setBusy('parse'); setDone(null); setPv(null); setSkip([]); setAmap({}); setKnown([]);
    try {
      const r = await api<Parsed>('/api/tasks/import/parse', { body: { fileName: f.name, data: await toBase64(f) } });
      setParsed(r); setMapping(r.mapping); setFile(f.name);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); if (inp.current) inp.current.value = ''; }
  }
  const body = () => ({ headers: parsed!.headers, rows: parsed!.rows, mapping, assigneeMap: amap, skipRows: skip });
  useEffect(() => {
    if (!parsed) return;
    if (mapping.title === undefined) { setPv(null); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try { const r = await api<Preview>('/api/tasks/import/preview', { body: body() }); if (n === seq.current) { setPv(r); setKnown((k) => [...k, ...r.unmatched.filter((x) => !k.some((y) => y.value === x.value))]); } }
      catch (e: any) { if (n === seq.current) toast.error(e.message); }
    }, 250);
    return () => clearTimeout(t);
  }, [parsed, mapping, amap, skip]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run() {
    if (!pv?.counts.ready) return;
    setBusy('apply');
    try {
      const r = await api<NonNullable<typeof done>>('/api/tasks/import', { body: body() });
      setDone(r); setUndone(false); broadcastRefresh();
      toast.ok(`업무 ${r.created}건을 만들었습니다`);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function undo() {
    if (!done || !confirm(`방금 가져온 업무 ${done.created}건을 휴지통으로 옮길까요?`)) return;
    try { const r = await api<{ removed: number }>('/api/tasks/import/undo', { body: { importId: done.importId } }); setUndone(true); broadcastRefresh(); toast.ok(`${r.removed}건을 휴지통으로 옮겼습니다`); }
    catch (e: any) { toast.error(e.message); }
  }
  function reset() { setKnown([]); setParsed(null); setPv(null); setDone(null); setFile(null); setMapping({}); setAmap({}); setSkip([]); }
  const toggle = (k: number) => setSkip((s) => s.includes(k) ? s.filter((x) => x !== k) : [...s, k]);

  return (
    <div className="mx-auto max-w-5xl space-y-4" data-testid="task-import">
      <PageHeader title="엑셀로 업무 가져오기" icon={FileSpreadsheet} sub="엑셀(.xlsx)·CSV 의 줄 하나가 업무 하나가 됩니다. 담당자는 이름이나 이메일로 맞춥니다."
        actions={<Link href="/tasks" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" />업무로</Link>} />

      {done ? (
        <Card className="space-y-3 p-4" data-testid="import-done">
          <p className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="size-5 text-emerald-600" />{undone ? '가져온 업무를 휴지통으로 옮겼습니다' : `업무 ${done.created}건을 만들었습니다`}</p>
          {!undone && <p className="text-sm text-ink-2">담당자에게는 사람마다 알림 1건만 보냈습니다.{done.skipped > 0 && ` 오류·뺀 줄 ${done.skipped}개는 만들지 않았습니다.`}</p>}
          {done.failed.length > 0 && <ul className="space-y-0.5 text-sm text-red-700">{done.failed.map((f) => <li key={f.row}>{f.row + 2}번째 줄: {f.message}</li>)}</ul>}
          <div className="flex flex-wrap gap-2">
            <Link href="/tasks" className="inline-flex h-9 items-center rounded-input bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700" data-testid="import-go-tasks">업무 목록 보기</Link>
            {!undone && done.created > 0 && <Button variant="secondary" onClick={undo} data-testid="import-undo"><RotateCcw />되돌리기(하루 안)</Button>}
            <Button variant="ghost" onClick={reset}>다른 파일 가져오기</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-4">
            <div className={cx('flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-line p-6 text-center', busy === 'parse' && 'opacity-60')}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
              {busy === 'parse' ? <Loader2 className="size-6 animate-spin text-ink-3" /> : <Upload className="size-6 text-ink-3" />}
              <p className="text-sm">{file ? <><b>{file}</b> — 다른 파일로 바꾸려면 다시 고르세요</> : <>파일을 여기로 끌어다 놓거나 <b>눌러서 고르세요</b></>}</p>
              <p className="text-xs text-ink-3">.xlsx · .csv (3MB, 500줄까지) · 첫 줄은 머리글(제목·담당자·마감일…)</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => inp.current?.click()} disabled={!!busy} data-testid="import-pick"><FileSpreadsheet />파일 고르기</Button>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- 파일 내려받기(API) */}
                <a href="/api/tasks/import/template" className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-sm hover:bg-slate-50" data-testid="import-template"><Download className="size-4" />예시 양식 내려받기</a>
              </div>
              <input ref={inp} type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="import-file" />
            </div>
          </Card>

          {parsed && (
            <Card className="space-y-3 p-4" data-testid="import-mapping">
              <h2 className="text-sm font-semibold">① 어떤 열이 무엇인가요? <span className="font-normal text-ink-3">(머리글로 자동으로 맞췄습니다 — 다르면 고르세요)</span></h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {FIELDS.map(([f, label, req]) => (
                  <label key={f} className="space-y-1 text-xs">
                    <span className="font-medium text-ink-2">{label}{req && <span className="text-red-600"> *</span>}</span>
                    <select className={cx(inputCls, 'py-1.5 text-sm', mapping[f] !== undefined && 'border-brand-600')} value={mapping[f] ?? ''} data-testid={`map-${f}`}
                      onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value === '') delete n[f]; else n[f] = Number(e.target.value); return n; })}>
                      <option value="">— 없음 —</option>
                      {parsed.headers.map((h, k) => <option key={k} value={k}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {parsed && pv && known.length > 0 && (
            <Card className="space-y-2 border-amber-300 p-4" data-testid="import-unmatched">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold"><AlertTriangle className="size-4 text-amber-600" />② 담당자를 골라 주세요 <span className="font-normal text-ink-3">(안 고르면 담당 없음으로 만듭니다)</span></h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {known.map((m) => (
                  <label key={m.value} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 break-all"><b>{m.value}</b> <span className="text-xs text-ink-3">{m.why === 'many' ? '같은 이름 여럿' : '못 찾음'} · {m.rows}줄</span></span>
                    <select className={cx(inputCls, '!w-44 shrink-0 py-1.5')} value={amap[m.value] ?? ''} data-testid="unmatched-select"
                      onChange={(e) => setAmap((a) => ({ ...a, [m.value]: e.target.value || null }))}>
                      <option value="">담당 없음</option>
                      {pv.people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.title ? ` ${p.title}` : ''}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {parsed && pv && (
            <Card className="space-y-3 p-4" data-testid="import-preview">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <h2 className="mr-auto font-semibold">{known.length ? '③' : '②'} 미리보기</h2>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700" data-testid="count-ready">만들 업무 {pv.counts.ready}</span>
                {pv.counts.errors > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700" data-testid="count-errors">오류 {pv.counts.errors}</span>}
                {pv.counts.skipped > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-ink-2">뺌 {pv.counts.skipped}</span>}
              </div>
              {/* PC: 표 */}
              <div className="hidden max-h-[60vh] overflow-auto rounded-input border border-line md:block">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs text-ink-2">
                    <tr><th className="w-10 p-2">넣기</th><th className="w-10 p-2">줄</th><th className="p-2">제목</th><th className="p-2">담당자</th><th className="p-2">마감일</th><th className="p-2">우선순위</th><th className="p-2">상태</th><th className="p-2">확인할 점</th></tr>
                  </thead>
                  <tbody>
                    {pv.rows.filter((r) => !r.empty).map((r) => (
                      <tr key={r.row} className={cx('border-t border-line align-top', r.skip && 'opacity-50', !r.skip && r.errors.length > 0 && 'bg-red-50/60')} data-testid="preview-row" data-state={r.skip ? 'skip' : r.errors.length ? 'error' : 'ok'}>
                        <td className="p-2"><input type="checkbox" checked={!r.skip && !r.errors.length} disabled={r.errors.length > 0} onChange={() => toggle(r.row)} aria-label={`${r.row + 2}번째 줄 넣기`} /></td>
                        <td className="p-2 text-xs text-ink-3">{r.row + 2}</td>
                        <td className="max-w-xs p-2 font-medium">{r.task?.title || <span className="text-ink-3">(없음)</span>}</td>
                        <td className="p-2">{r.task?.assigneeName ?? (r.task?.assigneeRaw ? <span className="text-amber-700">{r.task.assigneeRaw} ?</span> : <span className="text-ink-3">없음</span>)}</td>
                        <td className="whitespace-nowrap p-2">{r.task?.dueDate ?? <span className="text-ink-3">—</span>}</td>
                        <td className="p-2">{PRI[r.task?.priority ?? 'normal']}</td>
                        <td className="p-2">{ST[r.task?.status ?? 'todo']}</td>
                        <td className="p-2 text-xs">{r.errors.map((e) => <p key={e} className="text-red-700">{e}</p>)}{r.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 휴대폰: 카드 */}
              <ul className="space-y-2 md:hidden">
                {pv.rows.filter((r) => !r.empty).map((r) => (
                  <li key={r.row} className={cx('rounded-input border border-line p-3 text-sm', r.skip && 'opacity-50', !r.skip && r.errors.length > 0 && 'border-red-300 bg-red-50/60')} data-testid="preview-card">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" checked={!r.skip && !r.errors.length} disabled={r.errors.length > 0} onChange={() => toggle(r.row)} />
                      <span className="min-w-0 flex-1">
                        <b className="line-clamp-2">{r.task?.title || '(제목 없음)'}</b>
                        <span className="mt-0.5 block text-xs text-ink-2">{r.row + 2}번째 줄 · {r.task?.assigneeName ?? (r.task?.assigneeRaw ? `${r.task.assigneeRaw}?` : '담당 없음')} · {r.task?.dueDate ? `마감 ${r.task.dueDate}` : '마감 없음'} · {PRI[r.task?.priority ?? 'normal']}</span>
                      </span>
                    </label>
                    {(r.errors.length > 0 || r.warnings.length > 0) && <div className="mt-1 text-xs">{r.errors.map((e) => <p key={e} className="text-red-700">{e}</p>)}{r.warnings.map((w) => <p key={w} className="text-amber-700">{w}</p>)}</div>}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end max-sm:sticky max-sm:bottom-20 max-sm:z-10">
                <Button onClick={run} disabled={!pv.counts.ready || !!busy} className="max-sm:w-full" data-testid="import-run">
                  {busy === 'apply' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}업무 {pv.counts.ready}건 만들기</Button>
              </div>
            </Card>
          )}
          {parsed && mapping.title === undefined && <p className="text-sm text-red-700">제목 열을 골라 주세요.</p>}
        </>
      )}
    </div>
  );
}
