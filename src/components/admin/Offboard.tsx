'use client';
import { dtf } from '@/lib/dtf';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, Field, Modal, Skeleton, cx, inputCls, toast } from '@/components/ui';

type Summary = { user: { id: string; name: string; status: string; left_at: string | null; rejoin_until: string | null; handover_to: string | null; canRejoin: boolean }; items: { key: string; label: string; count: number }[]; candidates: { id: string; name: string; title: string | null }[] };
const today = () => dtf('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

/**
 * 대표 10/20 오후 7) [퇴사 처리] / [인수인계] 창 — 한 창에서 날짜(퇴사 처리일 때)·받을 사람·항목별 체크(개수)·[이전].
 * 퇴사 처리: 로그인 차단·세션 만료·알림 중지·팀/대화방 제거·라이선스 인원 제외, 자료실 파일은 회사 소유 그대로, 메일·문자 발송 기록 보존, 복직 30일, 감사 기록.
 */
export function OffboardModal({ userId, mode, onClose, onDone }: { userId: string; mode: 'leave' | 'handover'; onClose: () => void; onDone: () => void }) {
  const { data, error } = useApi<Summary>(`/api/admin/users/${userId}/handover`);
  const [date, setDate] = useState(today()); const [to, setTo] = useState(''); const [picked, setPicked] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setPicked(new Set(data.items.filter((i) => i.count > 0).map((i) => i.key))); }, [data]);
  const total = data?.items.filter((i) => picked.has(i.key)).reduce((a, i) => a + i.count, 0) ?? 0;
  async function go() {
    setBusy(true);
    try {
      if (mode === 'leave') {
        const r = await api(`/api/admin/users/${userId}/leave`, { body: { date, ...(to && picked.size ? { toUserId: to, items: [...picked] } : {}) } });
        toast.ok(`퇴사 처리했습니다(${r.leftAt}) — 복직 가능 ${r.rejoinUntil}까지${r.handover ? ` · ${Object.values(r.handover.counts as Record<string, number>).reduce((a, b) => a + b, 0)}건 ${r.handover.to.name}에게 이전` : ''}`);
      } else {
        if (!to || !picked.size) { toast.error('받을 사람과 항목을 고르세요'); return; }
        const r = await api(`/api/admin/users/${userId}/handover`, { body: { toUserId: to, items: [...picked] } });
        toast.ok(`${Object.values(r.counts as Record<string, number>).reduce((a, b) => a + b, 0)}건을 ${r.to.name}에게 넘겼습니다`);
      }
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={mode === 'leave' ? `퇴사 처리 — ${data?.user.name ?? ''}` : `인수인계 — ${data?.user.name ?? ''}`}>
      {error ? <p className="text-sm text-red-700">{error.message}</p> : !data ? <Skeleton rows={4} /> : (
        <div className="space-y-3 text-sm" data-testid="offboard">
          {mode === 'leave' && <>
            <Field label="퇴사일"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} data-testid="offboard-date" /></Field>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">
              <li>바로 로그인 차단·모든 기기 로그아웃·알림 수신 중지, 부서·팀·대화방에서 빠집니다(대화 기록은 남음)</li>
              <li>자료실에 올린 파일은 회사 소유로 그대로, 메일·문자 발송 기록도 보존됩니다 · 요금제 인원에서 제외</li>
              <li>퇴사일부터 30일 안에는 [복직]으로 되돌릴 수 있습니다 · 모든 처리는 감사 기록에 남습니다</li>
            </ul>
          </>}
          <Field label={mode === 'leave' ? '인수인계 받을 사람(선택)' : '받을 사람'}>
            <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} data-testid="offboard-to"><option value="">{mode === 'leave' ? '나중에 인수인계' : '사람 선택'}</option>{data.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.title ? ` (${c.title})` : ''}</option>)}</select>
          </Field>
          <div className={cx('grid gap-1 sm:grid-cols-2', !to && 'opacity-60')} data-testid="offboard-items">
            {data.items.map((i) => <label key={i.key} className="flex items-center gap-2 rounded-input border border-line px-2 py-1.5"><input type="checkbox" checked={picked.has(i.key)} disabled={!i.count} onChange={(e) => { const s = new Set(picked); if (e.target.checked) s.add(i.key); else s.delete(i.key); setPicked(s); }} data-testid={`offboard-item-${i.key}`} /><span className="flex-1">{i.label}</span><b className="tabular-nums">{i.count}</b></label>)}
          </div>
          {to && <p className="text-xs text-ink-2">고른 항목 {total}건을 한 번에 넘깁니다.</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button>
            <Button onClick={go} disabled={busy || (mode === 'handover' && (!to || !picked.size))} data-testid="offboard-go">{mode === 'leave' ? '퇴사 처리' : '이전'}</Button></div>
        </div>
      )}
    </Modal>
  );
}
