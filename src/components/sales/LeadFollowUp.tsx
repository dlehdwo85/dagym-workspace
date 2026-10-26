'use client';
import { useCallback, useRef, useState } from 'react';
import { api } from '@/components/client';
import { Button, Field, Modal, cx, inputCls } from '@/components/ui';

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
            <div className="flex flex-wrap gap-1.5">{(['계약완료', '보류', '실패'] as const).map((st) => <button key={st} type="button" onClick={() => setClose(st)} className={chip(close === st)} aria-pressed={close === st} data-testid={`lead-fu-close-${st}`}>{st === '계약완료' ? '성사(계약완료)' : st}</button>)}</div>
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
