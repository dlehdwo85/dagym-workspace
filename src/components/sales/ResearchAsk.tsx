'use client';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { api } from '@/components/client';
import { Button, Modal, cx, inputCls, toast } from '@/components/ui';

/**
 * 212차 #612 ③(대표 결정 10/25): 후속조사 업무 [완료] 때 곳마다 값을 적는 창 — 현 위탁사·계약만료일·관리사무소 번호·메모.
 * #758(대표 10/28 '어떤 계약인지?'): 먼저 운영 방식(직영·위탁·미개관) — 위탁이면 현 위탁사·계약 만료일, 미개관이면 첫 운영사 선정 예정 시기 · 관련 공고 수
 * 비운 곳은 '확인 못함'(12주 뒤 다시 묶음에). [취소] = 완료하지 않음. 묶인 시설이 없거나 못 읽으면 묻지 않고 완료
 */
type Mode = '' | '직영' | '위탁' | '미개관';
type Item = { id: number; srcId: string; name: string; region: string | null; households: number | null; missing: string[]; status: string; phone: string | null; operator: string | null; mgmt?: string | null; notices?: number; moveIn?: string | null; approval?: string | null;
  result: { operator?: string | null; contractEnd?: string | null; phone?: string | null; note?: string | null; mode?: Mode | null; firstPick?: string | null;
    call?: Call | null; contactTitle?: string | null; reaction?: React0 | null; meetingAt?: string | null; nextDate?: string | null } };
/** 247차 #778(대표 10/28 21:35 '계약 만료일을 묻는건 잘 안 알려 줌 — 컨택해서 미팅을 유도'): 연락 결과 먼저 — 통화·통화한 분 직함·반응·미팅 약속·다음 연락일 */
type Call = '' | '통화함' | '안 받음' | '번호 틀림';
type React0 = '' | '관심 있음' | '보통' | '관심 없음';
type Data = { terms: { operator: string; office: string; opCheck?: string; facility?: string }; items: Item[] };
type Ask = 'ok' | 'skip' | null;

/** 쓰는 쪽: const rs = useResearchAsk(); if (await rs.ask(task) === null) return(완료 안 함) — 화면에 {rs.node} */
export function useResearchAsk() {
  const [state, setState] = useState<{ title: string; data: Data } | null>(null);
  const resolver = useRef<((v: Ask) => void) | null>(null);
  const ask = useCallback(async (t: { id: string; title: string; sales_ref?: { kind: string } | null }): Promise<Ask> => {
    if (t.sales_ref?.kind !== 'research') return 'skip';
    let data: Data;
    try { data = await api<Data>(`/api/sales/research?task=${t.id}`); } catch { return 'skip'; }
    if (!data.items?.length) return 'skip';
    return new Promise<Ask>((res) => { resolver.current = res; setState({ title: t.title, data }); });
  }, []);
  const finish = useCallback((v: Ask) => { resolver.current?.(v); resolver.current = null; setState(null); }, []);
  return { ask, node: state ? <ResearchDialog title={state.title} data={state.data} onDone={finish} /> : null };
}

function ResearchDialog({ title, data, onDone }: { title: string; data: Data; onDone: (v: Ask) => void }) {
  const T = data.terms;
  const [rows, setRows] = useState(() => data.items.map((x) => ({ id: x.id, mode: (x.result.mode ?? '') as Mode, operator: x.result.operator ?? '', contractEnd: x.result.contractEnd ?? '', phone: x.result.phone ?? '',
    firstPick: x.result.firstPick ?? '', note: x.result.note ?? '', call: (x.result.call ?? '') as Call, contactTitle: x.result.contactTitle ?? '', reaction: (x.result.reaction ?? '') as React0,
    meetingAt: x.result.meetingAt ?? '', nextDate: x.result.nextDate ?? '' })));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (i: number, k: 'mode' | 'operator' | 'contractEnd' | 'phone' | 'firstPick' | 'note' | 'call' | 'contactTitle' | 'reaction' | 'meetingAt' | 'nextDate', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const filled = rows.filter((x) => x.mode || x.operator.trim() || x.contractEnd || x.phone.trim() || x.call === '통화함' || x.contactTitle.trim() || x.reaction || x.meetingAt || x.nextDate).length;
  async function save() {
    setBusy(true); setErr('');
    try {
      for (const x of rows) await api(`/api/sales/research/${x.id}`, { method: 'PATCH', body: { mode: x.mode || null, operator: x.mode === '직영' || x.mode === '미개관' ? null : x.operator.trim() || null,
        contractEnd: x.mode === '직영' || x.mode === '미개관' ? null : x.contractEnd || null, phone: x.phone.trim() || null, firstPick: x.mode === '미개관' ? x.firstPick.trim() || null : null, note: x.note.trim() || null,
        call: x.call || null, contactTitle: x.contactTitle.trim() || null, reaction: x.reaction || null, meetingAt: x.meetingAt || null, nextDate: x.nextDate || null } });
      const meet = rows.filter((x) => x.meetingAt).length, next = rows.filter((x) => x.nextDate).length;
      toast.ok(`후속조사 ${rows.length}곳을 적었습니다 — 확인 ${filled}곳${rows.length - filled ? ` · 확인 못함 ${rows.length - filled}곳` : ''}${meet ? ` · 미팅 일정 ${meet}건` : ''}${next ? ` · 다음 연락 업무 ${next}건` : ''}`);
      onDone('ok');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={() => onDone(null)} title="조사한 값을 적고 완료" wide>
      <div className="space-y-3 text-sm" data-testid="research-ask">
        <p className="text-xs text-ink-2">‘{title}’을(를) 마칩니다. 곳마다 <b>연락 결과</b>(통화 · 통화한 분 직함 · 반응 · 미팅 약속 · 다음 연락일)와 {T.opCheck ?? '운영 방식'}을(를) 적어 주세요 — 미팅 약속은 일정으로, 다음 연락일은 업무로 만듭니다. 계약 만료일은 알려 준 경우만(선택). 개인 휴대폰 번호는 적지 않습니다. 비워 둔 곳은 <b>확인 못함</b>으로 남고 12주 뒤 다시 조사 묶음에 들어옵니다.</p>
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
          {data.items.map((x, i) => (
            <li key={x.id} className="rounded-input border border-line p-2" data-testid="research-ask-row">
              <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs"><b className="text-sm text-ink">{x.name}</b>
                <span className="text-ink-3">{[x.region, x.households ? `${x.households}세대` : null, x.phone && `${T.office} ${x.phone}`].filter(Boolean).join(' · ')}</span>
                {x.mgmt && <span className="basis-full text-[11px] text-ink-3" data-testid="research-ask-mgmt">관리회사(주택관리업자) {x.mgmt} — {T.operator}와 다를 수 있음</span>}
                {(x.notices ?? 0) > 0 && <Link href={`/s/sales/hub?tab=bids&q=${encodeURIComponent(x.name)}`} target="_blank" className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-800 hover:underline" data-testid="research-ask-notices">관련 공고 {x.notices}건</Link>}
                <Link href={`/s/sales/hub?tab=facilities&q=${encodeURIComponent(x.name)}`} target="_blank" className="ml-auto text-[11px] text-ink-3 underline">카드 보기</Link></div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="통화" data-testid="research-ask-call"><span className="text-[11px] text-ink-3">통화</span>
                {(['통화함', '안 받음', '번호 틀림'] as const).map((c) => <button key={c} type="button" role="radio" aria-checked={rows[i].call === c} onClick={() => set(i, 'call', rows[i].call === c ? '' : c)}
                  className={cx('h-7 rounded-full border px-3 text-xs', rows[i].call === c ? 'border-transparent bg-sky-600 font-semibold text-white' : 'border-line bg-white text-ink-2 hover:bg-slate-50')} data-testid={`research-ask-call-${c}`}>{c}</button>)}</div>
              {rows[i].call === '통화함' && <>
                <div className="mt-1.5 flex flex-wrap items-center gap-1" role="radiogroup" aria-label="반응" data-testid="research-ask-reaction"><span className="text-[11px] text-ink-3">반응</span>
                  {(['관심 있음', '보통', '관심 없음'] as const).map((c) => <button key={c} type="button" role="radio" aria-checked={rows[i].reaction === c} onClick={() => set(i, 'reaction', rows[i].reaction === c ? '' : c)}
                    className={cx('h-7 rounded-full border px-3 text-xs', rows[i].reaction === c ? 'border-transparent bg-sky-600 font-semibold text-white' : 'border-line bg-white text-ink-2 hover:bg-slate-50')} data-testid={`research-ask-reaction-${c}`}>{c}</button>)}</div>
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_11rem_9.5rem]">
                  <input className={cx(inputCls, 'h-8 text-xs')} value={rows[i].contactTitle} onChange={(e) => set(i, 'contactTitle', e.target.value)} maxLength={40} placeholder="통화한 분 직함(예: 관리소장) — 이름·개인 번호는 적지 않음" aria-label="통화한 분 직함" data-testid="research-ask-title" />
                  <input type="datetime-local" step={900} className={cx(inputCls, 'h-8 text-xs')} value={rows[i].meetingAt} onChange={(e) => set(i, 'meetingAt', e.target.value)} aria-label="미팅 약속 일시" title="미팅 약속 일시(있으면 일정을 만듭니다)" data-testid="research-ask-meeting" />
                  <input type="date" className={cx(inputCls, 'h-8 text-xs')} value={rows[i].nextDate} onChange={(e) => set(i, 'nextDate', e.target.value)} aria-label="다음 연락일" title="다음 연락일(있으면 업무를 만듭니다)" data-testid="research-ask-next" />
                </div></>}
              <div className="mt-1.5 flex flex-wrap gap-1" role="radiogroup" aria-label={T.opCheck ?? '운영 방식'} data-testid="research-ask-mode">
                {(['직영', '위탁', '미개관'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={rows[i].mode === m} onClick={() => set(i, 'mode', rows[i].mode === m ? '' : m)}
                  className={cx('h-7 rounded-full border px-3 text-xs', rows[i].mode === m ? 'border-transparent bg-brand-600 font-semibold text-white' : 'border-line bg-white text-ink-2 hover:bg-slate-50')} data-testid={`research-ask-mode-${m}`}>{m}</button>)}
              </div>
              <div className={cx('mt-1.5 grid gap-1.5', rows[i].mode === '미개관' ? 'sm:grid-cols-[1fr_9.5rem]' : rows[i].mode === '직영' ? 'sm:grid-cols-[9.5rem]' : 'sm:grid-cols-[1fr_9.5rem_9.5rem]')}>
                {rows[i].mode === '미개관'
                  ? <input className={cx(inputCls, 'h-8 text-xs')} value={rows[i].firstPick} onChange={(e) => set(i, 'firstPick', e.target.value)} maxLength={40} placeholder="첫 운영사 선정 예정 시기(예: 2027년 3월 입주 뒤)" aria-label="첫 운영사 선정 예정 시기" data-testid="research-ask-first" />
                  : rows[i].mode !== '직영' && <>
                    <input className={cx(inputCls, 'h-8 text-xs')} value={rows[i].operator} onChange={(e) => set(i, 'operator', e.target.value)} maxLength={100} placeholder={x.operator ? `${T.operator}(지금 ${x.operator})` : `${T.operator}(위탁이면)`} aria-label={T.operator} data-testid="research-ask-operator" />
                    <input type="date" className={cx(inputCls, 'h-8 text-xs')} value={rows[i].contractEnd} onChange={(e) => set(i, 'contractEnd', e.target.value)} aria-label="계약 만료일(선택)" title="계약 만료일 — 알려 준 경우만(선택)" data-testid="research-ask-end" />
                  </>}
                <input type="tel" className={cx(inputCls, 'h-8 text-xs')} value={rows[i].phone} onChange={(e) => set(i, 'phone', e.target.value)} maxLength={40} placeholder={`${T.office} 번호`} aria-label={`${T.office} 번호`} data-testid="research-ask-phone" />
              </div>
              <Questions x={x} T={T} />
              <p className="mt-1 text-[11px] text-ink-2" data-testid="research-ask-summary">정리: {summaryOf(rows[i], T)}</p>
              <input className={cx(inputCls, 'mt-1.5 h-8 text-xs')} value={rows[i].note} onChange={(e) => set(i, 'note', e.target.value)} maxLength={500} placeholder="메모(선택) — 예: 내년 3월 입찰 예정, 관리소장 통화" aria-label="메모" data-testid="research-ask-note" />
            </li>))}
        </ul>
        {err && <p className="text-xs text-red-700" data-testid="research-ask-err">{err}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[11px] text-ink-3" data-testid="research-ask-count">확인 {filled}곳 · 확인 못함 {rows.length - filled}곳</span>
          <Button variant="secondary" onClick={() => onDone(null)} data-testid="research-ask-cancel">취소</Button>
          <Button onClick={save} disabled={busy} data-testid="research-ask-save">적고 완료</Button>
        </div>
      </div>
    </Modal>
  );
}

/** 246차 #775(대표 '후속조사 담당자는 ai 가 하는거 아닌가요?'): 관리사무소에 전화하는 일은 사람이 함(전화 기능 없음) — 대신 공개 자료로 아는 것(관리사무소 번호·관리회사·관련 공고·입주/사용승인)과
 *  곳마다 물어볼 말 세 줄을 미리 보여 줌. AI 호출 없이 규칙으로 만듦(회사 AI 예산 안 씀) */
function Questions({ x, T }: { x: Item; T: Data['terms'] }) {
  const fac = T.facility ?? '커뮤니티 시설';
  const known = [x.phone && `${T.office} ${x.phone}`, x.mgmt && `관리회사 ${x.mgmt}`, (x.notices ?? 0) > 0 && `관련 공고 ${x.notices}건`, x.moveIn && `입주 ${x.moveIn}`, !x.moveIn && x.approval && `사용승인 ${x.approval}`].filter(Boolean);
  const q = [`${fac} 운영은 관리사무소에서 직접 하시나요, 위탁 업체에 맡기시나요?`,
    x.mgmt ? `관리회사(${x.mgmt})와 별도로 ${fac} 위탁 업체가 있나요? ${fac} 운영을 맡고 계신 분(직함)과 잠깐 뵐 수 있는 시간이 있을까요?` : `${fac} 운영을 맡고 계신 분(직함)과 잠깐 뵐 수 있는 시간이 있을까요?`, // 247차 #778 계약 만료일 대신 미팅
    (x.notices ?? 0) > 0 ? `다음 위탁 업체 선정(입찰) 공고는 언제쯤 내실 예정인가요? (지난 관련 공고 ${x.notices}건)` : x.moveIn && x.moveIn > new Date().toISOString().slice(0, 10) ? `아직 개관 전이면 ${fac} 운영사는 언제쯤 정하시나요?` : `다음 위탁 업체 선정(입찰)은 언제쯤 하실 예정인가요?`];
  return (
    <details className="mt-1.5 rounded-input bg-slate-50 px-2 py-1 text-[11px] text-ink-2" data-testid="research-ask-help">
      <summary className="cursor-pointer">통화 도움 — 미리 아는 것{known.length ? ` ${known.length}가지` : ' 없음'} · 물어볼 말 3줄</summary>
      {known.length > 0 && <p className="mt-1" data-testid="research-ask-known">공개 자료: {known.join(' · ')}</p>}
      <ol className="mt-1 list-decimal space-y-0.5 pl-4" data-testid="research-ask-questions">{q.map((s) => <li key={s}>{s}</li>)}</ol>
    </details>);
}
/** 적은 답을 한 줄로 정리 — 저장하면 어디에 쓰이는지 */
function summaryOf(r: { mode: Mode; operator: string; contractEnd: string; phone: string; firstPick: string; call: Call; contactTitle: string; reaction: React0; meetingAt: string; nextDate: string }, T: Data['terms']) {
  const fmt = (v: string) => `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}${v.length > 10 ? ` ${v.slice(11, 16)}` : ''}`;
  const contact = [r.call, r.contactTitle.trim(), r.reaction && `반응 ${r.reaction}`, r.meetingAt && `미팅 ${fmt(r.meetingAt)}(일정 만듦)`, r.nextDate && `다음 연락 ${fmt(r.nextDate)}(업무 만듦)`].filter(Boolean).join(' · ');
  const rest = summaryMode(r, T);
  return contact ? `${contact}${rest.startsWith('확인 못함') ? '' : ` / ${rest}`}` : rest;
}
function summaryMode(r: { mode: Mode; operator: string; contractEnd: string; phone: string; firstPick: string }, T: Data['terms']) {
  if (r.mode === '직영') return '직영 — 위탁 업체 없음';
  if (r.mode === '미개관') return `미개관 · 첫 운영사 선정 ${r.firstPick.trim() || '시기 확인 못함'} — 그 무렵 다시 조사`;
  if (r.mode === '위탁' || r.operator.trim() || r.contractEnd) {
    const m = r.contractEnd ? Math.round((Date.parse(`${r.contractEnd}T00:00:00+09:00`) - Date.now()) / (30.4 * 864e5)) : null;
    return `위탁 · ${r.operator.trim() || `${T.operator} 확인 못함`} · ${r.contractEnd ? `${r.contractEnd} 만료${m != null ? (m >= 0 ? `(약 ${m}개월 뒤)` : '(지남)') : ''}` : '만료일 확인 못함'} — 저장하면 시설 카드·계약만료·재입찰 목록에 반영`;
  }
  return r.phone.trim() ? `번호만 확인(${r.phone.trim()}) — 운영 방식은 다음 조사에서` : '확인 못함 — 다음 묶음(12주 뒤)에 다시';
}
