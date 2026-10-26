'use client';
// V30 ④ 결재: 휴가·지출결의·품의 요청(회사 양식) = 결재 업무(기존 결재선) · 승인 건 엑셀
// 로컬 10/20 19:10 (#114): ① 결재할 것·올린 것·참조 탭 ② 작성 화면 결재선 미리 보기·변경·참조자 ③ 상태 뱃지(대기·진행 중·승인·반려)+멈춘 단계
// ④ 임시 저장·문서번호·반려 사유 ⑤ 양식 6종(출장·구매·경조사 추가) ⑥ 빈 상태 안내 ⑦ 휴대폰 상단 '결재할 것 n건'(AppShell)
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Download, FileEdit, Plus, Settings2, Stamp, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { MultiUserSelect } from '@/components/pickers';
import { isAdminRole, useSession } from '@/components/session';
import { Button, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Field_ = { key: string; label: string; type: 'text' | 'number' | 'date' | 'daterange' | 'select' | 'textarea' | 'file'; required?: boolean; options?: string[]; hint?: string };
type Form = { id: string | null; kind: string; name: string; fields: Field_[]; lineId: string | null; lineName: string | null; isDefault: boolean };
type Step = { label: string; status: string; by: string | null; at: string | null; comment: string | null };
type Req = { id: string; kind: string; data: Record<string, any>; amount: string | null; status: string; created_at: string; task_id: string | null; event_id: string | null; doc_no: string | null; reject_reason: string | null; line_id: string | null; form_id: string | null; cc_user_ids: string[]; requester_name: string; title: string; steps: Step[] | null; stuck: { label: string; step: number; since: string } | null; my_turn: boolean };
type View = 'todo' | 'mine' | 'cc' | 'all';
const KIND: Record<string, string> = { leave: '휴가', expense: '지출결의', general: '품의', trip: '출장', purchase: '구매', family: '경조사' };
const KINDS = Object.keys(KIND);
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysAgo = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400e3));

/** ③ 상태 뱃지: 임시 저장 · 대기(아직 아무 단계도 승인 전) · 진행 중(한 단계 이상 승인) · 승인 · 반려 · 취소 */
function badgeOf(r: Pick<Req, 'status' | 'steps'>): [string, string, string] {
  if (r.status === 'draft') return ['draft', '임시 저장', 'bg-slate-100 text-ink-2 border border-dashed border-slate-300'];
  if (r.status === 'approved') return ['approved', '승인', 'bg-emerald-100 text-emerald-700'];
  if (r.status === 'rejected') return ['rejected', '반려', 'bg-red-100 text-red-700'];
  if (r.status === 'cancelled') return ['cancelled', '취소', 'bg-slate-100 text-ink-2'];
  const moved = (r.steps ?? []).some((s) => s.status === 'approved');
  return moved ? ['in_progress', '진행 중', 'bg-amber-100 text-amber-800'] : ['waiting', '대기', 'bg-sky-100 text-sky-800'];
}
const EMPTY: Record<View, string> = {
  todo: '결재할 것이 없습니다 — 결재 차례가 오면 여기에 뜨고, 휴대폰 상단에 "결재할 것 n건"으로도 알려 드립니다.',
  mine: '올린 결재가 없습니다 — 위 버튼으로 휴가·지출결의·품의·출장·구매·경조사를 올려 보세요. 쓰다 말면 [임시 저장]으로 두었다가 이어 쓸 수 있습니다.',
  cc: '참조로 지정된 결재가 없습니다 — 요청자가 작성할 때 참조자로 넣으면 여기에 보입니다(결재 권한은 없고 보기만).',
  all: '결재 요청이 없습니다 — 직원이 올리면 여기에 모두 보입니다.',
};

export default function ApprovalsPage() {
  const sp = useSearchParams();
  const { user } = useSession();
  // 처음 탭: ?view= → 관리자는 전체, 그 밖은 내가 올린 것
  const [view, setView] = useState<View>(() => (['todo', 'mine', 'cc', 'all'].includes(sp.get('view') ?? '') ? (sp.get('view') as View) : isAdminRole(user.role) ? 'all' : 'mine'));
  const [kind, setKind] = useState('');
  const list = useApi<{ requests: Req[]; isAdmin: boolean; counts: { todo: number; mine: number; cc: number } }>(`/api/approvals/requests?view=${view}${kind ? `&kind=${kind}` : ''}`);
  const forms = useApi<{ forms: Form[]; canEdit: boolean; lines: { id: string; name: string }[] }>('/api/approvals/forms');
  const [open, setOpen] = useState<{ form: Form; draft?: Req } | null>(null);
  const month = todayKst().slice(0, 7);
  const counts = list.data?.counts;
  const tabs: [View, string, number | undefined][] = [['todo', '내가 결재할 것', counts?.todo], ['mine', '내가 올린 것', counts?.mine], ['cc', '참조', counts?.cc], ...(list.data?.isAdmin ? ([['all', '전체', undefined]] as [View, string, number | undefined][]) : [])];
  const removeDraft = async (r: Req) => {
    if (!confirm('임시 저장을 지울까요?')) return;
    try { await api(`/api/approvals/drafts/${r.id}`, { method: 'DELETE' }); toast.ok('임시 저장을 지웠습니다'); list.reload(); } catch (e: any) { toast.error(e.message); }
  };
  return (
    <div className="mx-auto max-w-4xl space-y-3" data-testid="approvals-page">
      <PageHeader title="결재" icon={Stamp} sub="회사 양식으로 올리면 결재선을 따라 승인됩니다. 휴가가 승인되면 연차·반차가 캘린더에 자동 등록됩니다."
        actions={<div className="flex flex-wrap gap-1.5">{forms.data?.forms.map((f) => <Button key={f.kind} size="sm" variant={f.kind === 'leave' ? 'primary' : 'secondary'} onClick={() => setOpen({ form: f })} data-testid={`approval-new-${f.kind}`}><Plus />{f.name}</Button>)}
          {/* #429 관리자: 결재선·양식·팀별 배정을 여기서 바로 */}
          {forms.data?.canEdit && <Link href="/admin/approval-settings" className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-sm font-medium text-ink-2 hover:bg-slate-50" data-testid="approval-settings-link"><Settings2 className="size-4" />결재 설정</Link>}</div>} />
      {/* ① 탭 */}
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="결재 보기" data-testid="approval-tabs">
        {tabs.map(([v, l, n]) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} data-testid={`approval-tab-${v}`} className={cx('inline-flex h-8 items-center gap-1 rounded-full border px-3 text-xs font-medium', view === v ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>
            {l}{!!n && <span className={cx('min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4', view === v ? 'bg-white/25 text-white' : v === 'todo' ? 'bg-red-500 text-white' : 'bg-slate-200 text-ink-2')} data-testid={`approval-count-${v}`}>{n}</span>}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select className={cx(inputCls, 'h-7 !w-auto max-w-[160px] py-0 pr-7 text-xs')} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="종류" data-testid="approval-kind"><option value="">모든 종류</option>{KINDS.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}</select>
        {list.data?.isAdmin && <a href={`/api/approvals/requests/export?kind=${kind || 'expense'}&month=${month}`} className="ml-auto inline-flex h-7 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs hover:bg-slate-50" data-testid="approvals-export"><Download className="size-3.5" />{month} {KIND[kind] ?? '지출결의'} 엑셀</a>}

      </div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton rows={5} />}
      {list.data && (
        <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card" data-testid="approval-list" data-view={view}>
          {!list.data.requests.length && <li className="p-6 text-center text-sm text-ink-3" data-testid="approval-empty">{EMPTY[view]}</li>}
          {list.data.requests.map((r) => {
            const [code, sl, cls] = badgeOf(r);
            const draft = r.status === 'draft';
            const form = forms.data?.forms.find((f) => (r.form_id && f.id === r.form_id) || (!r.form_id && f.kind === r.kind)) ?? forms.data?.forms.find((f) => f.kind === r.kind);
            const stuckDays = r.stuck && r.status === 'pending' ? daysAgo(r.stuck.since) : 0;
            const inner = (
              <>
                <span className={cx('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', cls)} data-testid="approval-badge" data-code={code}>{sl}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{draft ? `[${KIND[r.kind] ?? r.kind}] 임시 저장 — ${firstValue(r.data) || '내용 없음'}` : r.title}{r.my_turn && <span className="ml-1.5 rounded bg-red-50 px-1 text-[10px] font-semibold text-red-600" data-testid="approval-my-turn">내 차례</span>}</div>
                  <div className="text-xs text-ink-3">
                    {r.doc_no && <span className="mr-1 font-mono text-[11px] text-ink-2" data-testid="approval-doc-no">{r.doc_no}</span>}
                    {r.requester_name} · {fmtDateTime(r.created_at)}
                    {r.steps?.length ? ` · ${r.steps.map((s) => `${s.label} ${s.status === 'approved' ? '✓' : s.status === 'rejected' ? '✗' : s.status === 'pending' ? '…' : '·'}`).join(' → ')}` : ''}
                    {r.event_id && ' · 📅 캘린더 등록됨'}
                  </div>
                  {/* ③ 멈춘 단계 · ④ 반려 사유 */}
                  {r.status === 'pending' && r.stuck && <div className={cx('mt-0.5 text-xs', stuckDays >= 3 ? 'font-medium text-amber-700' : 'text-ink-2')} data-testid="approval-stuck">{r.stuck.label} 단계에서 {stuckDays === 0 ? '오늘부터' : `${stuckDays}일째`} 기다리는 중</div>}
                  {r.status === 'rejected' && r.reject_reason && <div className="mt-0.5 text-xs text-red-700" data-testid="approval-reject-reason">반려 사유: {r.reject_reason}</div>}
                </div>
                {r.amount && !draft && <span className="shrink-0 text-sm font-semibold tabular-nums">{Number(r.amount).toLocaleString('ko-KR')}원</span>}
              </>
            );
            return (
              <li key={r.id}>
                {draft ? (
                  <div className="flex items-start gap-3 px-3 py-2.5" data-testid="approval-row" data-status={r.status}>
                    {inner}
                    <span className="flex shrink-0 gap-1">
                      <Button size="sm" variant="secondary" onClick={() => form && setOpen({ form, draft: r })} data-testid="draft-continue"><FileEdit />이어 쓰기</Button>
                      <button type="button" onClick={() => removeDraft(r)} className="rounded p-1.5 text-ink-3 hover:bg-red-50 hover:text-red-600" aria-label="임시 저장 지우기" data-testid="draft-delete"><Trash2 className="size-4" /></button>
                    </span>
                  </div>
                ) : (
                  <Link href={`/tasks/${r.task_id}`} className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-50" data-testid="approval-row" data-status={r.status}>{inner}</Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && <RequestModal form={open.form} draft={open.draft} lines={forms.data?.lines ?? []} onClose={() => setOpen(null)} onMade={() => { setOpen(null); list.reload(); }} />}
    </div>
  );
}
const firstValue = (d: Record<string, any>) => { for (const v of Object.values(d)) { if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 40); if (v && typeof v === 'object' && v.from) return `${v.from}~${v.to ?? ''}`; } return ''; };

type Preview = { lineId: string | null; lineName: string | null; source: string | null; sourceLabel: string | null; via: string | null; fromForm: boolean; steps: { order: number | null; label: string; type: string; role: string | null; names: string[]; skipped: boolean; cond: string | null }[]; lines: { id: string; name: string }[]; requester: string; missing: boolean };

function RequestModal({ form, draft, lines, onClose, onMade }: { form: Form; draft?: Req; lines: { id: string; name: string }[]; onClose: () => void; onMade: () => void }) {
  const [data, setData] = useState<Record<string, any>>(draft?.data ?? {});
  const [lineId, setLineId] = useState<string>(draft?.line_id ?? '');
  const [cc, setCc] = useState<string[]>(draft?.cc_user_ids ?? []);
  const [busy, setBusy] = useState<'' | 'submit' | 'draft'>('');
  const [draftId, setDraftId] = useState<string | null>(draft?.id ?? null);
  const set = (k: string, v: any) => setData((d) => ({ ...d, [k]: v }));
  // ② 결재선 미리 보기(기안 → 1차·2차·3차 결재자 이름) — 결재선을 바꾸거나 기간·금액이 바뀌면 다시(#429 조건 단계, 입력이 멈춘 뒤)
  const [pd, setPd] = useState('');
  useEffect(() => { const h = setTimeout(() => setPd(JSON.stringify({ period: data.period, leave_type: data.leave_type, amount: data.amount, leave_days: data.leave_days })), 400); return () => clearTimeout(h); }, [data.period, data.leave_type, data.amount, data.leave_days]);
  const preview = useApi<Preview>(`/api/approvals/line-preview?kind=${form.kind}${form.id ? `&formId=${form.id}` : ''}${lineId ? `&lineId=${lineId}` : ''}${pd ? `&d=${encodeURIComponent(pd)}` : ''}`);
  const submit = async () => {
    setBusy('submit');
    try {
      const r = await api('/api/approvals/requests', { body: { kind: form.kind, formId: form.id ?? undefined, data, lineId: lineId || undefined, ccUserIds: cc, draftId: draftId ?? undefined } });
      toast.ok(`${r.docNo} 결재 요청을 올렸습니다 — ${r.needsFile ? '결재 업무에 사진·파일을 붙여 주세요' : '결재자에게 알림이 갔습니다'}`, { label: '열기', run: () => { location.href = r.link; } });
      onMade();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  const saveDraft = async () => {
    setBusy('draft');
    try {
      const body = { kind: form.kind, formId: form.id ?? undefined, data, lineId: lineId || null, ccUserIds: cc };
      const r = draftId ? await api(`/api/approvals/drafts/${draftId}`, { method: 'PATCH', body }) : await api('/api/approvals/drafts', { body });
      setDraftId(r.id); toast.ok('임시 저장했습니다 — "내가 올린 것" 탭에서 이어 쓸 수 있습니다');
      onMade();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <Modal open onClose={onClose} title={`${form.name}${draftId ? ' (임시 저장 이어 쓰기)' : ''}`}>
      <div className="space-y-2" data-testid="approval-form">
        {form.fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint}>
            {f.type === 'select' ? <select className={inputCls} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`}><option value="">선택</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : f.type === 'textarea' ? <textarea className={cx(inputCls, 'min-h-20')} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />
              : f.type === 'daterange' ? <div className="flex items-center gap-2"><input type="date" className={inputCls} value={data[f.key]?.from ?? ''} onChange={(e) => set(f.key, { ...(data[f.key] ?? {}), from: e.target.value, to: data[f.key]?.to || e.target.value })} aria-label={`${f.label} 시작`} data-testid={`af-${f.key}-from`} /><span className="text-ink-3">~</span><input type="date" className={inputCls} value={data[f.key]?.to ?? ''} onChange={(e) => set(f.key, { ...(data[f.key] ?? {}), to: e.target.value })} aria-label={`${f.label} 끝`} data-testid={`af-${f.key}-to`} /></div>
              : f.type === 'date' ? <input type="date" className={inputCls} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />
              : f.type === 'number' ? <input className={inputCls} inputMode="numeric" value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />
              : f.type === 'file' ? <p className="text-xs text-ink-2">요청을 올린 뒤 열리는 결재 업무의 첨부 칸에 올려 주세요(사진·파일).</p>
              : <input className={inputCls} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} data-testid={`af-${f.key}`} />}
          </Field>
        ))}
        {/* ② 결재선 미리 보기·변경 + 참조자 */}
        <div className="rounded-input border border-line bg-slate-50 p-2.5" data-testid="line-preview">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <b className="font-semibold">결재선</b>
            <select className={cx(inputCls, 'h-7 !w-auto max-w-[220px] py-0 pr-7 text-xs')} value={lineId} onChange={(e) => setLineId(e.target.value)} aria-label="결재선 고르기" data-testid="line-select">
              <option value="">자동(팀·양식 배정)</option>
              {lines.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {preview.data?.lineName && <span className="text-ink-3" data-testid="line-source">{preview.data.lineName}{preview.data.sourceLabel ? ` · ${preview.data.sourceLabel}${preview.data.via ? `(${preview.data.via})` : ''}` : ''}</span>}
          </div>
          <LineChain p={preview.data} loading={!preview.data && !preview.error} />
          {preview.data && !preview.data.lineId && <p className="mt-1 text-xs text-red-600">결재선이 없습니다 — 관리자가 결재 › 결재 설정에서 먼저 만들어야 올릴 수 있습니다.</p>}
          {preview.data?.missing && <p className="mt-1 text-xs text-amber-700">결재자가 비어 있는 단계가 있습니다 — 그 단계 역할의 사람이 조직에 없으면 올릴 때 막힙니다.</p>}
          <div className="mt-2 text-xs"><b className="font-semibold">참조자</b> <span className="text-ink-3">(보기·알림만, 결재 권한 없음)</span></div>
          <div className="mt-1" data-testid="cc-select"><MultiUserSelect value={cc} onChange={setCc} /></div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button variant="secondary" onClick={saveDraft} disabled={!!busy} data-testid="approval-draft">임시 저장</Button>
          <Button onClick={submit} disabled={!!busy || (preview.data ? !preview.data.lineId : false)} data-testid="approval-submit">결재 올리기</Button>
        </div>
      </div>
    </Modal>
  );
}
/** 기안(나) → 1차 → 2차 → 3차 … 단계마다 이름. #429 조건이 맞지 않아 건너뛰는 단계는 흐리게(조건 표시) */
function LineChain({ p, loading }: { p: Preview | null | undefined; loading: boolean }) {
  if (loading) return <div className="mt-1.5 h-6 animate-pulse rounded bg-slate-200/60" />;
  if (!p) return null;
  const nodes = [{ label: '기안', names: [p.requester], me: true, skipped: false, cond: null as string | null }, ...p.steps.map((s) => ({ label: s.skipped ? s.label : `${s.order}차 ${s.label}`, names: s.names, me: false, skipped: s.skipped, cond: s.cond }))];
  return (
    <ol className="mt-1.5 flex flex-wrap items-center gap-1 text-xs" data-testid="line-chain">
      {nodes.map((n, i) => (
        <li key={i} className="flex items-center gap-1">
          <span className={cx('inline-flex flex-col rounded-md border px-2 py-1 leading-tight', n.skipped ? 'border-dashed border-slate-300 bg-white text-ink-3 line-through decoration-slate-300' : n.me ? 'border-brand-200 bg-brand-50 text-brand-800' : n.names.length ? 'border-line bg-white' : 'border-red-200 bg-red-50 text-red-700')} data-testid="line-step" data-skipped={n.skipped ? '1' : undefined}>
            <span className="text-[10px] font-semibold text-ink-3">{n.label}{n.cond ? ` · ${n.skipped ? '건너뜀 — ' : ''}${n.cond}` : ''}</span>
            <span>{n.names.length ? n.names.slice(0, 3).join(', ') + (n.names.length > 3 ? ` 외 ${n.names.length - 3}` : '') : '결재자 없음'}</span>
          </span>
          {i < nodes.length - 1 && <span className="text-ink-3">→</span>}
        </li>
      ))}
    </ol>
  );
}
