'use client';
import { useCallback, useRef, useState } from 'react';
import { api } from '@/components/client';
import { Button, Field, Modal, cx, inputCls } from '@/components/ui';
import { useStages } from '@/components/sales/stages';

/**
 * 197차(#460) 영업 2차 관리 — 리드 업무 [완료] 때 묻는 창: '다음 연락일(+ 할 일)' 또는 '종결(성사·보류·실패 + 사유·다시 볼 날)'.
 * 원칙 "모든 진행 중 거래처는 다음 행동이 있거나, 종결 사유가 있다" — 둘 중 하나를 골라야 완료된다([취소] = 완료하지 않음).
 * 리드가 이미 닫혔거나(보류·실패·계약완료·되돌림) 볼 수 없으면 묻지 않고 완료(서버 규칙 그대로)
 */
export type LeadFollowUpChoice = { nextDate: string; nextAction?: string } | { close: '계약완료' | '보류' | '실패'; reason?: string; revisitDate?: string | null };
type Brief = { id: string; name: string; status: string | null; next: string | null; nextAction: string | null; owner: string | null; closed: boolean; canStage: boolean };
type Ask = LeadFollowUpChoice | null | 'skip';

const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (days: number, months = 0) => { const d = new Date(`${todayKst()}T12:00:00+09:00`); d.setUTCMonth(d.getUTCMonth() + months); d.setUTCDate(d.getUTCDate() + days); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const NEXT_CHIPS: [string, () => string][] = [['내일', () => plus(1)], ['3일 뒤', () => plus(3)], ['1주 뒤', () => plus(7)], ['2주 뒤', () => plus(14)], ['1달 뒤', () => plus(0, 1)]];
const REASONS = ['대상 아님(반려)', '연락 두절', '경쟁사 선정', '시기 안 맞음', '예산 없음'];
const REVISIT_CHIPS: [string, () => string][] = [['3개월 뒤', () => plus(0, 3)], ['6개월 뒤', () => plus(0, 6)], ['1년 뒤', () => plus(0, 12)]];
const chip = (on: boolean) => cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-line bg-white text-ink-2 hover:border-brand-300');

/** 완료 성공 뒤 안내 문구(서버 응답 leadFollowUp) */
export function followUpMsg(r: any): string | null {
  const f = r?.leadFollowUp;
  if (!f) return null;
  if (f.action === 'closed') return `거래처를 '${f.to}'(으)로 닫았습니다${f.revisit ? ` — 다시 볼 날 ${md(f.revisit)}` : ''}`;
  return `다음 연락 ${md(f.next)}${f.nextAction ? ` · ${f.nextAction}` : ''} — ${f.created ? '담당자 업무를 만들었습니다' : '영업 업무 마감을 맞췄습니다'}`;
}

/** 쓰는 쪽: const fu = useLeadFollowUp(); const c = await fu.ask(task) — null = 취소(완료하지 않음) · 'skip' = 묻지 않고 완료 · 그 밖 = 보낼 leadFollowUp. 화면에 {fu.node} */
export function useLeadFollowUp() {
  const [state, setState] = useState<{ title: string; brief: Brief } | null>(null);
  const resolver = useRef<((v: Ask) => void) | null>(null);
  const ask = useCallback(async (t: { title: string; lead_id?: string | null }): Promise<Ask> => {
    if (!t.lead_id) return 'skip';
    let brief: Brief;
    try { brief = await api<Brief>(`/api/sales/leads/${t.lead_id}/brief`); } catch { return 'skip'; }
    if (brief.closed) return 'skip';
    return new Promise<Ask>((res) => { resolver.current = res; setState({ title: t.title, brief }); });
  }, []);
  const finish = useCallback((v: LeadFollowUpChoice | null) => { resolver.current?.(v); resolver.current = null; setState(null); }, []);
  return { ask, node: state ? <LeadFollowUpDialog title={state.title} brief={state.brief} onDone={finish} /> : null };
}

function LeadFollowUpDialog({ title, brief, onDone }: { title: string; brief: Brief; onDone: (v: LeadFollowUpChoice | null) => void }) {
  const ST = useStages(); // 207차: 단계 이름은 회사 설정
  const td = todayKst();
  const [mode, setMode] = useState<'next' | 'close'>('next');
  const [date, setDate] = useState(''); const [action, setAction] = useState('');
  const [close, setClose] = useState<'' | '계약완료' | '보류' | '실패'>(''); const [reason, setReason] = useState(''); const [revisit, setRevisit] = useState('');
  const keep = brief.next && brief.next > td ? brief.next : null; // 이미 잡힌 다음 연락일(앞으로)
  const ok = mode === 'next' ? !!date && date >= td : !!close && (close === '계약완료' || !!reason.trim()) && (!revisit || revisit > td);
  const save = () => onDone(mode === 'next' ? { nextDate: date, ...(action.trim() ? { nextAction: action.trim() } : {}) }
    : close === '계약완료' ? { close } : { close: close as '보류' | '실패', reason: reason.trim(), revisitDate: revisit || null });
  return (
    <Modal open onClose={() => onDone(null)} title="다음 행동을 정하고 완료">
      <div className="space-y-3 text-sm" data-testid="lead-fu">
        <p className="text-xs text-ink-2"><b className="text-ink">{brief.name}</b> — ‘{title}’을(를) 마칩니다. 놓치는 거래처가 없게 <b>다음 연락일</b>을 정하거나 거래처를 <b>종결</b>해 주세요.</p>
        <div className="flex gap-1.5" role="group" aria-label="다음 행동">
          <button type="button" onClick={() => setMode('next')} className={chip(mode === 'next')} aria-pressed={mode === 'next'} data-testid="lead-fu-mode-next">다음 연락</button>
          <button type="button" onClick={() => setMode('close')} className={chip(mode === 'close')} aria-pressed={mode === 'close'} data-testid="lead-fu-mode-close">종결</button>
        </div>
        {mode === 'next' ? <div className="space-y-2" data-testid="lead-fu-next">
          <div className="flex flex-wrap gap-1.5">
            {keep && <button type="button" onClick={() => { setDate(keep); if (!action && brief.nextAction) setAction(brief.nextAction); }} className={chip(date === keep)} data-testid="lead-fu-keep">그대로 {md(keep)}</button>}
            {NEXT_CHIPS.map(([lb, f]) => <button key={lb} type="button" onClick={() => setDate(f())} className={chip(date === f())} data-testid="lead-fu-chip">{lb}</button>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
            <Field label="다음 연락일"><input type="date" min={td} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} aria-label="다음 연락일" data-testid="lead-fu-date" /></Field>
            <Field label="다음 할 일(선택)"><input className={inputCls} value={action} onChange={(e) => setAction(e.target.value)} maxLength={200} placeholder="예: 견적서 보내기" aria-label="다음 할 일" data-testid="lead-fu-action" /></Field>
          </div>
          <p className="text-[11px] text-ink-3">그날 담당{brief.owner ? `(${brief.owner})` : ''}에게 ‘{brief.name} — {action.trim() || '다음 연락'}’ 업무가 생깁니다.</p>
        </div> : !brief.canStage ? <p className="rounded-input bg-amber-50 p-2 text-xs text-amber-900" data-testid="lead-fu-no-stage">거래처 종결(단계 바꾸기)은 리드 담당{brief.owner ? `(${brief.owner})` : ''}·관리자만 할 수 있습니다 — 다음 연락일을 골라 주세요.</p>
          : <div className="space-y-2" data-testid="lead-fu-close">
            <div className="flex flex-wrap gap-1.5">{(['계약완료', '보류', '실패'] as const).map((st) => <button key={st} type="button" onClick={() => setClose(st)} className={chip(close === st)} aria-pressed={close === st} data-testid={`lead-fu-close-${st}`}>{st === '계약완료' ? `성사(${ST.name(st)})` : ST.name(st)}</button>)}</div>
            {close === '계약완료' && <p className="text-[11px] text-ink-3">제안·계약 화면에 계약 기간을 적어 두면 끝나기 120일 전 ‘재계약 준비’ 업무가 자동으로 생깁니다.</p>}
            {(close === '보류' || close === '실패') && <>
              <div className="flex flex-wrap gap-1.5">{REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={chip(reason === r)} data-testid="lead-fu-reason-chip">{r}</button>)}</div>
              <Field label={`${close} 사유(필수)`}><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="사유" data-testid="lead-fu-reason" /></Field>
              <div className="flex flex-wrap items-end gap-1.5">
                <Field label="다시 볼 날(선택)" className="w-40"><input type="date" min={plus(1)} className={inputCls} value={revisit} onChange={(e) => setRevisit(e.target.value)} aria-label="다시 볼 날" data-testid="lead-fu-revisit" /></Field>
                {REVISIT_CHIPS.map(([lb, f]) => <button key={lb} type="button" onClick={() => setRevisit(revisit === f() ? '' : f())} className={cx(chip(revisit === f()), 'mb-1')} data-testid="lead-fu-revisit-chip">{lb}</button>)}
              </div>
              <p className="text-[11px] text-ink-3">다시 볼 날을 고르면 그날 담당자에게 ‘다시 연락(재접촉 검토)’ 업무가 생깁니다. 종결한 거래처는 목록의 ‘종결’ 보기에서 사유와 함께 보입니다.</p>
            </>}
          </div>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onDone(null)} data-testid="lead-fu-cancel">취소</Button>
          <Button onClick={save} disabled={!ok} data-testid="lead-fu-save">완료</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── 202차(#461 ⑥, SALES_LEADS_REVAMP 2-3·2-4): 칸반 끌기 사유 창 · 휴대폰 카드 밀기(← 다음 연락일 · → 연락함 기록) ──────────────
const CLOSE_STAGES = ['계약완료', '보류', '실패', '되돌림'];
const LOG_TYPES = ['전화', '문자', '방문', '미팅', '메일'];
const LOG_CHIPS = ['통화함', '부재중', '문자 보냄', '자료 보냄'];
type QuickLead = { id: string; name: string; next?: string | null; nextAction?: string | null };
function NextPick({ td, keep, date, setDate, action, setAction }: { td: string; keep: string | null; date: string; setDate: (v: string) => void; action: string; setAction: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {keep && <button type="button" onClick={() => setDate(keep)} className={chip(date === keep)} data-testid="lead-q-keep">그대로 {md(keep)}</button>}
        {NEXT_CHIPS.map(([lb, f]) => <button key={lb} type="button" onClick={() => setDate(f())} className={chip(date === f())} data-testid="lead-q-chip">{lb}</button>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <Field label="다음 연락일"><input type="date" min={td} className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} aria-label="다음 연락일" data-testid="lead-q-date" /></Field>
        <Field label="다음 할 일(선택)"><input className={inputCls} value={action} onChange={(e) => setAction(e.target.value)} maxLength={200} placeholder="예: 견적서 보내기" aria-label="다음 할 일" data-testid="lead-q-action" /></Field>
      </div>
    </div>
  );
}

/** 칸반에서 단계를 옮길 때 묻는 창 — 진행 단계로 = 다음 연락일(+ 할 일), 종결(계약완료·보류·실패·되돌림)로 = 사유(보류·실패 필수)·다시 볼 날. [취소] = 옮기지 않음 */
export function StageMoveDialog({ lead, to, onClose, onDone }: { lead: QuickLead; to: string; onClose: () => void; onDone: (msg: string) => void }) {
  const td = todayKst(); const ST = useStages(); const toName = ST.name(to); const closing = CLOSE_STAGES.includes(to); const needReason = to === '보류' || to === '실패';
  const keep = lead.next && lead.next >= td ? lead.next : null;
  const [date, setDate] = useState(keep ?? ''); const [action, setAction] = useState('');
  const [reason, setReason] = useState(''); const [revisit, setRevisit] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = closing ? (!needReason || !!reason.trim()) && (!revisit || revisit > td) : !!date && date >= td;
  async function save() {
    setBusy(true); setErr('');
    try {
      await api(`/api/sales/leads/${lead.id}`, { method: 'PATCH', body: { status: to, ...(closing ? { ...(reason.trim() ? { reason: reason.trim() } : {}), ...(needReason && revisit ? { revisitDate: revisit } : {}) }
        : { nextContactDate: date, ...(action.trim() ? { nextAction: action.trim() } : {}) }) } });
      onDone(closing ? `'${toName}'(으)로 옮겼습니다${needReason && revisit ? ` — 다시 볼 날 ${md(revisit)}` : ''}` : `'${toName}'(으)로 옮겼습니다 — 다음 연락 ${md(date)}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`단계 옮기기 — ${toName}`}>
      <div className="space-y-3 text-sm" data-testid="lead-move">
        <p className="text-xs text-ink-2"><b className="text-ink">{lead.name}</b>을(를) ‘{toName}’(으)로 옮깁니다. {closing ? (needReason ? '종결하는 사유를 남겨 주세요.' : '종결합니다.') : '놓치지 않게 다음 연락일을 정해 주세요.'}</p>
        {!closing ? <NextPick td={td} keep={keep} date={date} setDate={setDate} action={action} setAction={setAction} />
          : needReason ? <div className="space-y-2" data-testid="lead-move-close">
            <div className="flex flex-wrap gap-1.5">{REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={chip(reason === r)} data-testid="lead-move-reason-chip">{r}</button>)}</div>
            <Field label={`${toName} 사유(필수)`}><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="사유" data-testid="lead-move-reason" /></Field>
            <div className="flex flex-wrap items-end gap-1.5">
              <Field label="다시 볼 날(선택)" className="w-40"><input type="date" min={plus(1)} className={inputCls} value={revisit} onChange={(e) => setRevisit(e.target.value)} aria-label="다시 볼 날" data-testid="lead-move-revisit" /></Field>
              {REVISIT_CHIPS.map(([lb, f]) => <button key={lb} type="button" onClick={() => setRevisit(revisit === f() ? '' : f())} className={cx(chip(revisit === f()), 'mb-1')} data-testid="lead-move-revisit-chip">{lb}</button>)}
            </div>
          </div>
          : <Field label="메모(선택)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="메모" data-testid="lead-move-reason" /></Field>}
        {to === '계약완료' && <p className="text-[11px] text-ink-3">제안·계약 화면에 계약 기간을 적어 두면 끝나기 120일 전 ‘재계약 준비’ 업무가 자동으로 생깁니다.</p>}
        {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} data-testid="lead-move-cancel">취소</Button>
          <Button onClick={save} disabled={!ok || busy} data-testid="lead-move-save">옮기기</Button>
        </div>
      </div>
    </Modal>
  );
}

/** 휴대폰 카드 밀기 창 — next = 다음 연락일 바꾸기(← 밀기) · log = 연락함 기록(→ 밀기: 종류·내용 + 다음 연락일) */
export function LeadQuickDialog({ mode, lead, onClose, onDone }: { mode: 'next' | 'log'; lead: QuickLead; onClose: () => void; onDone: (msg: string) => void }) {
  const td = todayKst(); const keep = lead.next && lead.next >= td ? lead.next : null;
  const [date, setDate] = useState(''); const [action, setAction] = useState(mode === 'next' ? lead.nextAction ?? '' : '');
  const [type, setType] = useState('전화'); const [content, setContent] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = mode === 'next' ? !!date && date >= td : !!content.trim() && (!date || date >= td);
  async function save() {
    setBusy(true); setErr('');
    try {
      if (mode === 'next') await api(`/api/sales/leads/${lead.id}`, { method: 'PATCH', body: { nextContactDate: date, nextAction: action.trim() || null } });
      else await api(`/api/sales/leads/${lead.id}/activities`, { body: { type, content: content.trim(), nextDate: date || null, ...(date && action.trim() ? { nextAction: action.trim() } : {}) } });
      onDone(mode === 'next' ? `다음 연락 ${md(date)}${action.trim() ? ` · ${action.trim()}` : ''}` : `${type} 기록을 남겼습니다${date ? ` — 다음 연락 ${md(date)}` : ''}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={mode === 'next' ? '다음 연락일 바꾸기' : '연락함 기록'}>
      <div className="space-y-3 text-sm" data-testid={`lead-quick-${mode}`}>
        <p className="text-xs text-ink-2"><b className="text-ink">{lead.name}</b>{mode === 'next' ? (lead.next ? ` — 지금 다음 연락 ${md(lead.next)}` : ' — 지금 다음 연락일 없음') : ' — 방금 한 연락을 남기면 마지막 접촉이 오늘로 바뀝니다'}</p>
        {mode === 'log' && <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="연락 종류">{LOG_TYPES.map((x) => <button key={x} type="button" onClick={() => setType(x)} className={chip(type === x)} aria-pressed={type === x} data-testid="lead-log-type">{x}</button>)}</div>
          <div className="flex flex-wrap gap-1.5">{LOG_CHIPS.map((x) => <button key={x} type="button" onClick={() => setContent(x)} className={chip(content === x)} data-testid="lead-log-chip">{x}</button>)}</div>
          <Field label="내용"><input className={inputCls} value={content} onChange={(e) => setContent(e.target.value)} maxLength={500} aria-label="내용" data-testid="lead-log-content" /></Field>
          <p className="text-[11px] text-ink-3">다음 연락일(선택) — 고르면 리드의 다음 연락일과 영업 업무 마감도 같이 바뀝니다.</p>
        </>}
        <NextPick td={td} keep={mode === 'next' ? keep : null} date={date} setDate={setDate} action={action} setAction={setAction} />
        {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} data-testid="lead-quick-cancel">취소</Button>
          <Button onClick={save} disabled={!ok || busy} data-testid="lead-quick-save">{mode === 'next' ? '바꾸기' : '기록'}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** 204차(#461 ⑦ 일괄 작업): 고른 거래처 여러 건 — 단계 바꾸기(보류·실패 사유 필수·다시 볼 날, 진행 단계는 다음 연락일 선택) · 다음 연락일 일괄 지정. 서버가 한 건씩 같은 규칙으로 바꾸고 못 바꾼 건을 돌려줌 */
export type BulkResult = { ok: number; failed: { id: string; name: string | null; message: string }[] };
export function BulkLeadDialog({ mode, ids, stages, onClose, onDone }: { mode: 'stage' | 'next'; ids: string[]; stages: string[]; onClose: () => void; onDone: (r: BulkResult) => void }) {
  const td = todayKst(); const ST = useStages();
  const [to, setTo] = useState(''); const closing = CLOSE_STAGES.includes(to); const needReason = to === '보류' || to === '실패';
  const [date, setDate] = useState(''); const [action, setAction] = useState('');
  const [reason, setReason] = useState(''); const [revisit, setRevisit] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = mode === 'next' ? !!date && date >= td : !!to && (closing ? (!needReason || !!reason.trim()) && (!revisit || revisit > td) : !date || date >= td);
  async function save() {
    const next = date ? { nextContactDate: date, ...(action.trim() ? { nextAction: action.trim() } : {}) } : {};
    const patch = mode === 'next' ? next : { status: to, ...(closing ? { ...(reason.trim() ? { reason: reason.trim() } : {}), ...(needReason && revisit ? { revisitDate: revisit } : {}) } : next) };
    setBusy(true); setErr('');
    try { onDone(await api<BulkResult>('/api/sales/leads/bulk', { body: { ids, patch } })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={mode === 'next' ? `다음 연락일 일괄 지정 — ${ids.length}건` : `단계 일괄 바꾸기 — ${ids.length}건`}>
      <div className="space-y-3 text-sm" data-testid={`lead-bulk-${mode}`}>
        {mode === 'stage' && <Field label="바꿀 단계"><select className={inputCls} value={to} onChange={(e) => { setTo(e.target.value); setReason(''); setRevisit(''); }} aria-label="바꿀 단계" data-testid="lead-bulk-to"><option value="">고르세요</option>{ST.pickable(stages).map((st) => <option key={st} value={st}>{ST.name(st)}</option>)}</select></Field>}
        {mode === 'stage' && needReason && <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">{REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={chip(reason === r)} data-testid="lead-bulk-reason-chip">{r}</button>)}</div>
          <Field label={`${ST.name(to)} 사유(필수, 모두 같은 사유)`}><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="사유" data-testid="lead-bulk-reason" /></Field>
          <div className="flex flex-wrap items-end gap-1.5">
            <Field label="다시 볼 날(선택)" className="w-40"><input type="date" min={plus(1)} className={inputCls} value={revisit} onChange={(e) => setRevisit(e.target.value)} aria-label="다시 볼 날" /></Field>
            {REVISIT_CHIPS.map(([lb, f]) => <button key={lb} type="button" onClick={() => setRevisit(revisit === f() ? '' : f())} className={cx(chip(revisit === f()), 'mb-1')} data-testid="lead-bulk-revisit-chip">{lb}</button>)}
          </div>
        </div>}
        {mode === 'stage' && to && !closing && <p className="text-[11px] text-ink-3">다음 연락일(선택) — 비우면 거래처마다 지금 다음 연락일 그대로.</p>}
        {(mode === 'next' || (to && !closing)) && <NextPick td={td} keep={null} date={date} setDate={setDate} action={action} setAction={setAction} />}
        <p className="text-[11px] text-ink-3">고른 거래처가 모두 같은 값으로 바뀌고 영업 업무 마감도 맞춰집니다. 내 담당이 아닌 거래처 등 바꿀 수 없는 건은 건너뛰고 이름과 이유를 알려 드립니다.</p>
        {err && <p className="text-xs text-red-600" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} data-testid="lead-bulk-cancel">취소</Button>
          <Button onClick={save} disabled={!ok || busy} data-testid="lead-bulk-save">{ids.length}건 바꾸기</Button>
        </div>
      </div>
    </Modal>
  );
}
