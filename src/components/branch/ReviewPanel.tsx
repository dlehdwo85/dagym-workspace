'use client';
/**
 * #1117(대표 11/22 '민감한 내용은 경고 혹은 승인 후에 최종 파일'): 고객사 제출 전 민감 내용 검사 — 걸린 곳마다 이유·글(노란 표시) ·
 * [가리기](개인정보·민원인 특정) · '그대로 두기(이유)' · 그대로 둔 것이 있으면 본사 승인(대표·관리자·검토 담당) 뒤에만 '고객사 제출용'.
 */
import { useState } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';
import { REVIEW_MARK } from '@/lib/branchReport/mask';

export type ReviewFlag = { key: string; label: string; kind: string; match: string; text: string; reason: string; mask?: string; fixIn?: string; kept: { reason: string; byName?: string } | null };
export type Review = { state: keyof typeof REVIEW_MARK; final: boolean; flags: ReviewFlag[]; open: number; approvedByName: string | null; approvedAt: string | null; rejectReason: string | null; rejectedByName: string | null; canApprove: boolean };
export const markOf = (rv?: Review | null) => (rv ? { final: rv.final, text: REVIEW_MARK[rv.state] } : undefined);

const STATE_LABEL: Record<Review['state'], string> = { draft: '제출 전', rejected: '반려됨', pending: '본사 승인 대기', unchecked: '검사 전 제출', clean: '고객사 제출용', approved: '고객사 제출용(승인)' };
function Excerpt({ text, match }: { text: string; match: string }) {
  const i = text.indexOf(match);
  if (i < 0) return <>{text}</>;
  return <>{i > 60 ? '…' : ''}{text.slice(Math.max(0, i - 60), i)}<mark className="rounded bg-amber-200 px-0.5">{match}</mark>{text.slice(i + match.length, i + match.length + 60)}{i + match.length + 60 < text.length ? '…' : ''}</>;
}

export function ReviewPanel({ id, draft, rv, canWrite, dirty, onChange }: { id: string; draft: boolean; rv: Review; canWrite: boolean; dirty?: boolean; onChange: () => void }) {
  const [why, setWhy] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [rej, setRej] = useState('');
  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    try { await api(`/api/branch-reports/${id}/review`, { body }); if (ok) toast.ok(ok); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const flags = draft ? rv.flags : rv.flags.filter((f) => f.kept);
  const maskable = draft && canWrite && rv.flags.some((f) => f.mask && !f.fixIn && !f.kept);
  const Icon = rv.final || (draft && !rv.flags.length) ? ShieldCheck : ShieldAlert;
  return (
    <section className={cx('space-y-2 rounded-card border p-3 text-sm', rv.final || (draft && !rv.flags.length) ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40')} data-testid="branch-review" data-state={rv.state}>
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden /><b>고객사 제출 전 민감 내용 검사</b>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-ink-2 ring-1 ring-line" data-testid="branch-review-state">{STATE_LABEL[rv.state]}</span>
        {draft && rv.flags.length > 0 && <span className="text-xs text-ink-2">걸린 곳 {rv.flags.length}개{rv.open ? ` · 남은 것 ${rv.open}개` : ' · 모두 처리함'}</span>}
      </div>
      {rv.state === 'rejected' && <p className="text-red-700" data-testid="branch-review-rejected">반려됨{rv.rejectedByName ? `(${rv.rejectedByName})` : ''}: {rv.rejectReason} — 고친 뒤 다시 제출하세요.</p>}
      {draft && !rv.flags.length && <p className="text-xs text-ink-2">걸린 것 없음 — 제출하면 바로 &lsquo;고객사 제출용&rsquo; 파일이 됩니다.</p>}
      {draft && rv.flags.length > 0 && <p className="text-xs text-ink-2">개인정보는 [가리기], 그 밖은 글을 고치거나 &lsquo;그대로 두기&rsquo; 이유를 적으세요. 그대로 둔 것이 있으면 제출 뒤 본사 승인을 받아야 &lsquo;고객사 제출용&rsquo; 파일이 나옵니다(그 전 인쇄·엑셀은 &lsquo;고객사 제출 금지&rsquo; 표시).{dirty ? ' — 고친 글을 먼저 저장하세요.' : ''}</p>}
      {!draft && rv.state === 'pending' && <p className="text-xs text-ink-2">본사 승인 대기 — 승인 전 인쇄·엑셀은 &lsquo;승인 대기 — 고객사 제출 금지&rsquo; 표시입니다. 아래는 그대로 두기로 한 곳과 이유입니다.</p>}
      {!draft && rv.state === 'unchecked' && <p className="text-xs text-ink-2">민감 내용 검사 전에 제출한 보고서이고 걸린 곳이 있어 &lsquo;고객사 제출 금지&rsquo; 표시입니다 — [제출 취소] 뒤 검사하고 다시 제출하세요.</p>}
      {rv.final && <p className="text-xs text-emerald-800" data-testid="branch-review-final">&lsquo;고객사 제출용&rsquo; 파일 준비됨{rv.approvedByName ? ` — ${rv.approvedByName} 승인` : ''}</p>}
      {flags.length > 0 && <ul className="space-y-1.5">{flags.map((f) => (
        <li key={f.key} className="rounded-input border border-amber-200 bg-white p-2" data-testid="branch-review-flag" data-kind={f.kind}>
          <div className="flex flex-wrap items-center gap-1.5 text-xs"><b>{f.label}</b><span className="text-amber-800">{f.reason}</span>
            {f.kept && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-ink-2" data-testid="branch-review-kept">그대로 둠{f.kept.byName ? `(${f.kept.byName})` : ''}: {f.kept.reason}</span>}</div>
          <p className="mt-0.5 break-words text-[13px]"><Excerpt text={f.text} match={f.match} /></p>
          {draft && canWrite && <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {f.mask && !f.fixIn && !f.kept && <Button size="sm" variant="secondary" disabled={busy || dirty} onClick={() => act({ action: 'mask', key: f.key }, '가렸습니다')} data-testid="branch-review-mask">가리기 → {f.mask}</Button>}
            {f.fixIn && <span className="text-xs text-ink-3">그 주 주간보고에서 고칠 수 있습니다</span>}
            {f.kept ? <button type="button" className="text-xs text-ink-2 underline" disabled={busy || dirty} onClick={() => act({ action: 'unkeep', key: f.key })}>그대로 두기 취소</button>
              : <><input className={cx(inputCls, 'h-8 w-full max-w-[16rem] px-2 text-xs')} value={why[f.key] ?? ''} onChange={(e) => setWhy({ ...why, [f.key]: e.target.value })} placeholder="그대로 두는 이유(승인자가 봅니다)" maxLength={300} aria-label="그대로 두는 이유" />
                <Button size="sm" variant="ghost" disabled={busy || dirty || (why[f.key] ?? '').trim().length < 2} onClick={() => act({ action: 'keep', key: f.key, reason: why[f.key] })} data-testid="branch-review-keep">그대로 두기</Button></>}
          </div>}
        </li>))}</ul>}
      {maskable && <Button size="sm" variant="secondary" disabled={busy || dirty} onClick={() => act({ action: 'maskAll' }, '개인정보를 가렸습니다')} data-testid="branch-review-mask-all">개인정보 모두 가리기</Button>}
      {rv.canApprove && <div className="flex flex-wrap items-center gap-1.5 border-t border-amber-200 pt-2">
        <Button size="sm" disabled={busy} onClick={() => act({ action: 'approve' }, "승인했습니다 — '고객사 제출용' 파일이 됩니다")} data-testid="branch-review-approve">승인</Button>
        <input className={cx(inputCls, 'h-8 w-full max-w-[18rem] px-2 text-xs')} value={rej} onChange={(e) => setRej(e.target.value)} placeholder="반려 사유" maxLength={500} aria-label="반려 사유" />
        <Button size="sm" variant="secondary" disabled={busy || rej.trim().length < 2} onClick={() => act({ action: 'reject', reason: rej }, '반려했습니다')} data-testid="branch-review-reject">반려</Button>
      </div>}
    </section>
  );
}
