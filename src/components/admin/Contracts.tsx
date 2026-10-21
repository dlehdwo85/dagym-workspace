'use client';
// #116 전자계약서(관리 › 사용자 관리): 보내기 창(서식·칸·서명자·코드 전달) → 링크·코드 넘기기(문자) · 목록 탭 · 상세(서명자·감사 추적·다시 보내기·취소·PDF)
import { useEffect, useState } from 'react';
import { Copy, FileSignature, MessageSquare, RefreshCw, XCircle } from 'lucide-react';
import { api, useApi } from '../client';
import { useSession } from '../session';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '../ui';

type TField = { key: string; label: string; type: 'text' | 'date' | 'number' | 'textarea'; required?: boolean; hint?: string };
type Template = { id: string | null; kind: string; name: string; body: string; fields: TField[]; isDefault: boolean };
type Signer = { role: 'employee' | 'company' | 'witness'; name: string; email?: string; phone?: string; userId?: string; ord: number };
type Delivery = { signerId: string; name: string; role: string; email: string | null; phone: string | null; link: string; code: string; mail: string; smsText: string };
export const ROLE: Record<string, string> = { employee: '근로자', company: '회사', witness: '입회인' };
export const CSTATUS: Record<string, [string, string]> = { draft: ['임시', 'bg-slate-100 text-ink-2'], sent: ['서명 대기', 'bg-sky-100 text-sky-800'], partially_signed: ['일부 서명', 'bg-amber-100 text-amber-800'], completed: ['완료', 'bg-emerald-100 text-emerald-700'], declined: ['거절', 'bg-red-100 text-red-700'], cancelled: ['취소', 'bg-slate-100 text-ink-2'], expired: ['기한 지남', 'bg-slate-100 text-ink-2'] };
const EVENT: Record<string, string> = { created: '작성', sent: '발송', resent: '재발송', opened: '링크 열람', code_ok: '코드 확인', code_fail: '코드 오류', locked: '잠김(5회 오류)', signed: '서명', declined: '거절', completed: '완료(PDF)', cancelled: '취소', pdf_viewed: '완료본 열람' };

export type ContractPreset = { userId?: string; name: string; email?: string; phone?: string | null };

/** 보내기 창 — preset 이 있으면 대상 직원 칸을 채워 둠(초대 직후·목록 버튼) */
export function SendContractModal({ preset, onClose, onSent }: { preset?: ContractPreset; onClose: () => void; onSent?: () => void }) {
  const { user } = useSession();
  const tpls = useApi<{ templates: Template[] }>('/api/contracts/templates');
  const [tplKey, setTplKey] = useState('');
  const tpl = tpls.data?.templates.find((t) => (t.id ?? t.kind) === tplKey) ?? tpls.data?.templates[0];
  const [data, setData] = useState<Record<string, string>>({});
  const [emp, setEmp] = useState({ name: preset?.name ?? '', email: preset?.email ?? '', phone: preset?.phone ?? '' });
  const [signers, setSigners] = useState<Signer[]>([{ role: 'company', name: user.name, email: user.email, userId: user.id, ord: 2 }]);
  const [codeBy, setCodeBy] = useState<'sms' | 'mail'>('sms');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ docNo: string; title: string; delivery: Delivery[] } | null>(null);
  useEffect(() => { if (tpls.data && !tplKey) setTplKey(tpls.data.templates[0]?.id ?? tpls.data.templates[0]?.kind ?? ''); }, [tpls.data, tplKey]);
  const send = async () => {
    if (!tpl) return; setBusy(true);
    try {
      const all: Signer[] = [{ role: 'employee', name: emp.name, email: emp.email || undefined, phone: emp.phone || undefined, userId: preset?.userId, ord: 1 }, ...signers];
      const r = await api('/api/contracts', { body: { templateId: tpl.id ?? undefined, kind: tpl.kind, userId: preset?.userId, employee: { name: emp.name, email: emp.email || undefined, phone: emp.phone || undefined }, data, signers: all, codeBy } });
      setResult(r); onSent?.();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const copy = (s: string) => { navigator.clipboard?.writeText(s); toast.ok('복사했습니다'); };
  return (
    <Modal open onClose={onClose} title={result ? `보냈습니다 — ${result.docNo}` : '전자계약서 보내기'}>
      {result ? (
        <div className="space-y-3 text-sm" data-testid="contract-sent">
          <p className="text-ink-2">{result.title}. 서명 링크는 메일로 보냈고{codeBy === 'mail' ? ' 접속 코드도 메일로 보냈습니다.' : ' 접속 코드는 아래 문구를 문자로 넘겨 주세요(링크와 코드를 따로 보내야 안전합니다).'}</p>
          {result.delivery.map((d) => (
            <div key={d.signerId} className="rounded-input border border-line p-2.5" data-testid="contract-delivery" data-role={d.role}>
              <div className="flex flex-wrap items-center gap-2"><b>{ROLE[d.role]} {d.name}</b><span className="text-xs text-ink-3">{d.email ?? '이메일 없음'} · 메일 {d.mail === 'sent' ? '보냄' : d.mail === 'dev' ? '개발 모드(안 보냄)' : d.mail === 'none' ? '없음' : '실패'}</span></div>
              <div className="mt-1 grid gap-1 text-xs sm:grid-cols-[auto_1fr_auto] sm:items-center">
                <span className="text-ink-3">링크</span><input readOnly className={cx(inputCls, 'py-1 font-mono text-[11px]')} value={d.link} onFocus={(e) => e.target.select()} data-testid="contract-link" /><button type="button" onClick={() => copy(d.link)} className="inline-flex items-center gap-1 text-ink-2"><Copy className="size-3.5" />복사</button>
                <span className="text-ink-3">접속 코드</span><b className="font-mono text-base tracking-[0.3em]" data-testid="contract-code">{d.code}</b><button type="button" onClick={() => copy(d.code)} className="inline-flex items-center gap-1 text-ink-2"><Copy className="size-3.5" />복사</button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {d.phone && <a href={`sms:${d.phone.replace(/[^0-9+]/g, '')}?body=${encodeURIComponent(d.smsText)}`} className="inline-flex h-7 items-center gap-1 rounded-input border border-line bg-white px-2 text-xs" data-testid="contract-sms"><MessageSquare className="size-3.5" />문자로 보내기</a>}
                <button type="button" onClick={() => copy(d.smsText)} className="inline-flex h-7 items-center gap-1 rounded-input border border-line bg-white px-2 text-xs"><Copy className="size-3.5" />문자 문구 복사</button>
              </div>
            </div>
          ))}
          <div className="flex justify-end"><Button onClick={onClose}>닫기</Button></div>
        </div>
      ) : (
        <div className="space-y-3" data-testid="contract-form">
          {!tpls.data ? <Skeleton rows={3} /> : (
            <Field label="서식"><select className={inputCls} value={tplKey} onChange={(e) => { setTplKey(e.target.value); setData({}); }} data-testid="contract-template">{tpls.data.templates.map((t) => <option key={t.id ?? t.kind} value={t.id ?? t.kind}>{t.name}{t.isDefault ? ' (기본 서식)' : ''}</option>)}</select></Field>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="직원 이름 *"><input className={inputCls} value={emp.name} onChange={(e) => setEmp({ ...emp, name: e.target.value })} data-testid="contract-emp-name" /></Field>
            <Field label="이메일(서명 링크)"><input type="email" className={inputCls} value={emp.email} onChange={(e) => setEmp({ ...emp, email: e.target.value })} data-testid="contract-emp-email" /></Field>
            <Field label="전화(접속 코드 문자)"><input className={inputCls} value={emp.phone ?? ''} onChange={(e) => setEmp({ ...emp, phone: e.target.value })} data-testid="contract-emp-phone" /></Field>
          </div>
          {tpl && (
            <div className="grid gap-2 sm:grid-cols-2">
              {tpl.fields.map((f) => (
                <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.hint} className={f.type === 'textarea' ? 'sm:col-span-2' : undefined}>
                  {f.type === 'textarea' ? <textarea className={cx(inputCls, 'min-h-16')} value={data[f.key] ?? ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} data-testid={`cf-${f.key}`} />
                    : <input type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'number' ? 'numeric' : undefined} className={inputCls} value={data[f.key] ?? ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} data-testid={`cf-${f.key}`} />}
                </Field>
              ))}
            </div>
          )}
          <div className="rounded-input border border-line bg-slate-50 p-2.5 text-xs" data-testid="contract-signers">
            <div className="flex items-center justify-between"><b className="font-semibold">서명 순서</b><button type="button" className="text-brand-700 underline" onClick={() => setSigners([...signers, { role: 'witness', name: '', ord: signers.length + 2 }])} data-testid="contract-add-signer">+ 서명자 추가</button></div>
            <ol className="mt-1.5 space-y-1">
              <li className="flex items-center gap-2"><span className="w-5 text-center font-mono">1</span><span className="rounded bg-white px-1.5 py-0.5">근로자</span><span>{emp.name || '(직원 이름)'}</span></li>
              {signers.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-1.5">
                  <input className={cx(inputCls, 'h-7 w-10 py-0 text-center font-mono text-xs')} value={s.ord} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, ord: Math.max(1, Number(e.target.value) || 1) } : x)))} aria-label="순서" />
                  <select className={cx(inputCls, 'h-7 !w-auto py-0 text-xs')} value={s.role} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, role: e.target.value as Signer['role'] } : x)))} aria-label="역할"><option value="company">회사</option><option value="witness">입회인</option><option value="employee">근로자</option></select>
                  <input className={cx(inputCls, 'h-7 w-24 py-0 text-xs')} placeholder="이름" value={s.name} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="이름" />
                  <input className={cx(inputCls, 'h-7 min-w-0 flex-1 py-0 text-xs')} placeholder="이메일" value={s.email ?? ''} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} aria-label="이메일" />
                  <input className={cx(inputCls, 'h-7 w-28 py-0 text-xs')} placeholder="전화" value={s.phone ?? ''} onChange={(e) => setSigners(signers.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} aria-label="전화" />
                  {signers.length > 1 && <button type="button" onClick={() => setSigners(signers.filter((_, j) => j !== i))} className="text-ink-3" aria-label="빼기"><XCircle className="size-4" /></button>}
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-ink-3">같은 숫자는 동시에, 큰 숫자는 앞 순서가 끝난 뒤 보냅니다. 회사 서명자도 같은 링크·코드로 서명합니다.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <b className="font-semibold">접속 코드 전달</b>
            <label className="flex items-center gap-1"><input type="radio" checked={codeBy === 'sms'} onChange={() => setCodeBy('sms')} data-testid="contract-code-sms" />문자(내가 넘김 — 권장)</label>
            <label className="flex items-center gap-1"><input type="radio" checked={codeBy === 'mail'} onChange={() => setCodeBy('mail')} data-testid="contract-code-mail" />메일로 함께</label>
          </div>
          {tpl && <details className="text-xs"><summary className="cursor-pointer text-ink-2">서식 본문 미리 보기</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-input bg-slate-50 p-2 text-[11px] leading-5">{tpl.body}</pre></details>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={send} disabled={busy || !emp.name.trim() || (!emp.email && !emp.phone)} data-testid="contract-send"><FileSignature />보내기</Button></div>
        </div>
      )}
    </Modal>
  );
}

export function ContractsTab({ onSend }: { onSend?: () => void }) {
  const { menus } = useSession();
  const canEdit = (menus?.admin_users ?? 'none') === 'edit';
  const list = useApi<{ contracts: any[] }>('/api/contracts');
  const [open, setOpen] = useState<string | null>(null);
  const [send, setSend] = useState(false);
  return (
    <div className="space-y-2" data-testid="contracts-tab">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-2">근로계약서·비밀유지서약서를 직원에게 보내 가입 없이 전자서명을 받습니다. 완료본은 자료실 › 인사/전자계약서(기밀)에 보관됩니다.</p>
        {canEdit && <Button size="sm" onClick={() => (onSend ? onSend() : setSend(true))} data-testid="contracts-new"><FileSignature />전자계약서 보내기</Button>}
      </div>
      {list.error && <ErrorBox error={list.error} retry={list.reload} />}
      {!list.data && !list.error && <Skeleton rows={4} />}
      {list.data && (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm" data-testid="contracts-table">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">문서번호</th><th className="p-2">계약서</th><th className="p-2">서명</th><th className="p-2">상태</th><th className="p-2">보낸 날</th><th className="p-2" /></tr></thead>
            <tbody className="divide-y">
              {!list.data.contracts.length && <tr><td colSpan={6} className="p-6 text-center text-ink-3">보낸 전자계약서가 없습니다 — 직원 초대 때 함께 보내거나 사용자 줄의 [전자계약서] 로 보내세요.</td></tr>}
              {list.data.contracts.map((c) => {
                const [sl, cls] = CSTATUS[c.status] ?? [c.status, ''];
                const signed = (c.signers ?? []).filter((s: any) => s.status === 'signed').length;
                return (
                  <tr key={c.id} data-testid="contract-row" data-status={c.status}>
                    <td className="p-2 font-mono text-xs">{c.doc_no}</td>
                    <td className="p-2"><div className="font-medium">{c.title}</div><div className="text-xs text-ink-3">{c.created_by_name}</div></td>
                    <td className="p-2 text-xs" data-testid="contract-progress">{signed}/{(c.signers ?? []).length}</td>
                    <td className="p-2"><span className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold', cls)}>{sl}</span></td>
                    <td className="p-2 text-xs">{fmtDateTime(c.created_at)}</td>
                    <td className="p-2 text-right whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setOpen(c.id)} data-testid="contract-open">상세</Button>{c.file_id && <a href={`/api/library/${c.file_id}/download`} className="ml-1 text-xs text-brand-700 underline">PDF</a>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && <ContractDetail id={open} canEdit={canEdit} onClose={() => { setOpen(null); list.reload(); }} />}
      {send && <SendContractModal onClose={() => { setSend(false); list.reload(); }} />}
    </div>
  );
}

function ContractDetail({ id, canEdit, onClose }: { id: string; canEdit: boolean; onClose: () => void }) {
  const d = useApi<{ contract: any; signers: any[]; events: any[] }>(`/api/contracts/${id}`);
  const [delivery, setDelivery] = useState<Delivery[] | null>(null);
  const resend = async (signerId?: string) => { try { const r = await api(`/api/contracts/${id}/resend`, { body: { signerId } }); setDelivery(r.delivery); d.reload(); } catch (e: any) { toast.error(e.message); } };
  const cancel = async () => { if (!confirm('이 전자계약서를 취소할까요? 서명 링크가 모두 막힙니다.')) return; try { await api(`/api/contracts/${id}`, { method: 'DELETE' }); toast.ok('취소했습니다'); onClose(); } catch (e: any) { toast.error(e.message); } };
  const c = d.data?.contract; const [sl, cls] = c ? CSTATUS[c.status] ?? [c.status, ''] : ['', ''];
  return (
    <Modal open onClose={onClose} title={c ? `${c.doc_no} · ${c.title}` : '전자계약서'}>
      {!d.data ? <Skeleton rows={5} /> : (
        <div className="space-y-3 text-sm" data-testid="contract-detail">
          <div className="flex flex-wrap items-center gap-2"><span className={cx('rounded px-1.5 py-0.5 text-[11px] font-semibold', cls)}>{sl}</span><span className="text-xs text-ink-3">보냄 {fmtDateTime(c.created_at)}{c.expires_at ? ` · 기한 ${fmtDateTime(c.expires_at)}` : ''}{c.completed_at ? ` · 완료 ${fmtDateTime(c.completed_at)}` : ''}</span>
            {c.file_id && <a href={`/api/library/${c.file_id}/download`} className="ml-auto text-xs text-brand-700 underline" data-testid="contract-pdf">완료본 PDF</a>}</div>
          <div><b className="text-xs font-semibold text-ink-2">서명자</b>
            <ul className="mt-1 divide-y divide-line rounded-input border border-line">
              {d.data.signers.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5" data-testid="contract-signer" data-status={s.status}>
                  <span className="w-5 text-center font-mono text-xs">{s.ord}</span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{ROLE[s.role]}</span><b>{s.name}</b><span className="text-xs text-ink-3">{s.email}{s.phone ? ` · ${s.phone}` : ''}</span>
                  <span className={cx('ml-auto text-xs', s.status === 'signed' ? 'text-emerald-700' : s.status === 'declined' ? 'text-red-700' : s.status === 'locked' ? 'text-red-700' : 'text-ink-2')}>{s.status === 'signed' ? `서명 ${fmtDateTime(s.signed_at)} (${s.sign_method === 'stamp' ? '도장' : '그림'})` : s.status === 'declined' ? `거절: ${s.decline_reason ?? ''}` : s.status === 'locked' ? '코드 5회 오류로 잠김' : s.opened_at ? `열람 ${fmtDateTime(s.opened_at)}` : '아직 안 열어 봄'}</span>
                  {canEdit && s.status !== 'signed' && ['sent', 'partially_signed', 'draft'].includes(c.status) && <Button size="sm" variant="ghost" onClick={() => resend(s.id)} data-testid="contract-resend"><RefreshCw />다시 보내기</Button>}
                </li>
              ))}
            </ul>
          </div>
          {delivery && <div className="space-y-1.5 rounded-input bg-amber-50 p-2.5 text-xs" data-testid="contract-redelivery"><b>새 링크·접속 코드(예전 것은 무효)</b>{delivery.map((x) => <div key={x.signerId} className="flex flex-wrap items-center gap-2"><span>{x.name}</span><input readOnly className={cx(inputCls, 'min-w-0 flex-1 py-0.5 font-mono text-[11px]')} value={x.link} onFocus={(e) => e.target.select()} /><b className="font-mono tracking-[0.2em]" data-testid="contract-recode">{x.code}</b><button type="button" className="underline" onClick={() => { navigator.clipboard?.writeText(x.smsText); toast.ok('복사했습니다'); }}>문자 문구 복사</button></div>)}</div>}
          <details><summary className="cursor-pointer text-xs font-semibold text-ink-2">감사 추적 {d.data.events.length}건</summary>
            <table className="mt-1 w-full text-xs" data-testid="contract-events"><tbody className="divide-y divide-line">{d.data.events.map((e) => <tr key={e.id}><td className="py-1 pr-2 whitespace-nowrap text-ink-3">{fmtDateTime(e.at)}</td><td className="py-1 pr-2 whitespace-nowrap">{e.who ?? '-'}</td><td className="py-1 pr-2 whitespace-nowrap font-medium">{EVENT[e.type] ?? e.type}</td><td className="py-1 pr-2 font-mono text-[11px] text-ink-3">{e.ip ?? ''}</td><td className="truncate py-1 text-[11px] text-ink-3" title={e.user_agent ?? ''}>{(e.user_agent ?? '').slice(0, 40)}</td></tr>)}</tbody></table>
          </details>
          <details><summary className="cursor-pointer text-xs font-semibold text-ink-2">본문</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-input bg-slate-50 p-2 text-[11px] leading-5">{c.body}</pre></details>
          <div className="flex justify-end gap-2">{canEdit && !['completed', 'cancelled'].includes(c.status) && <Button variant="danger" onClick={cancel} data-testid="contract-cancel">취소</Button>}<Button variant="secondary" onClick={onClose}>닫기</Button></div>
        </div>
      )}
    </Modal>
  );
}
