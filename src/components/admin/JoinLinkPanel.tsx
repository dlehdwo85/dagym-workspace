'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, Field, Modal, askConfirm, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { useTerms } from '@/components/session';

type Req = { id: string; email: string; name: string; via: string; verified: boolean; status: string; created_at: string; decided_at: string | null; by: string | null; reject_reason: string | null };
type View = {
  link: { id: string; url: string | null; expiresAt: string | null; maxUses: number | null; uses: number; createdAt: string; live: boolean } | null;
  requests: Req[];
  domain: { value: string | null; mine: string; canSet: boolean; publicBlocked: boolean };
};
type Band = { label: string; krw: number } | null;
const VIA: Record<string, string> = { link: '초대 링크 · 이메일', domain: '회사 메일 도메인', google: '초대 링크 · Google', kakao: '초대 링크 · 카카오', naver: '초대 링크 · 네이버', apple: '초대 링크 · Apple' };
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/**
 * #1176(대표 11/26): 회사 초대 링크(가입 신청 → 관리자 승인) · 합류 신청 승인·거절 · 회사 메일 도메인 합류.
 * 이메일 초대([+ 직원 초대])는 그대로. 승인으로 인원이 요금 구간을 넘으면 승인 창에 다음 구간 금액.
 */
export function JoinLinkPanel({ canEdit }: { canEdit: boolean }) {
  const T = useTerms();
  const { data, reload } = useApi<View>('/api/admin/join');
  const teams = useApi<{ teams: { id: string; name: string; archived?: boolean }[] }>('/api/teams');
  const [days, setDays] = useState<string>('30'); const [maxUses, setMaxUses] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Req | null>(null);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => { if (location.hash === '#join') document.getElementById('join')?.scrollIntoView({ block: 'start' }); }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const pending = data.requests.filter((r) => r.status === 'pending');
  const decided = data.requests.filter((r) => r.status !== 'pending');
  async function make() {
    if (data?.link && !(await askConfirm('새 링크를 만들면 지금 링크는 바로 쓸 수 없게 됩니다. 계속할까요?', { title: '초대 링크 다시 만들기', ok: '새로 만들기' }))) return;
    setBusy(true);
    try { await api('/api/admin/join', { body: { action: 'link', days: days ? Number(days) : null, maxUses: maxUses ? Number(maxUses) : null } }); toast.ok('초대 링크를 만들었습니다 — 복사해서 단체방 등에 공유하세요'); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function off() {
    if (!(await askConfirm('초대 링크를 끌까요? 이 링크로는 더 신청할 수 없습니다(이미 온 신청은 그대로).', { title: '초대 링크 끄기', ok: '끄기', danger: true }))) return;
    try { await api('/api/admin/join', { body: { action: 'disable' } }); toast.ok('초대 링크를 껐습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function domain(v: string | null) {
    try { await api('/api/admin/join', { body: { action: 'domain', domain: v } }); toast.ok(v ? `@${v} 메일로 가입하면 합류 신청이 옵니다` : '회사 메일 도메인 합류를 껐습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <section id="join" className="scroll-mt-20 rounded-card border border-line bg-white p-4 text-sm shadow-card" data-testid="join-panel">
      <h2 className="font-semibold">회사 초대 링크 · 합류 신청</h2>
      <p className="mt-1 text-xs text-ink-3">링크 하나를 단체방 등에 공유하면 직원이 이메일·소셜로 합류를 신청하고, 관리자가 승인하면 들어옵니다(승인 없이는 못 들어옴). 한 사람씩 보내는 이메일 초대는 위 [+ 직원 초대] 그대로입니다.</p>

      <div className="mt-3 rounded-input border border-line p-3" data-testid="join-link">
        {data.link ? <>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly className={cx(inputCls, 'min-w-0 flex-1 font-mono text-xs')} value={data.link.url ?? '(다시 만들어 주세요)'} onFocus={(e) => e.target.select()} data-testid="join-link-url" />
            {data.link.url && <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(data.link!.url!); toast.ok('초대 링크를 복사했습니다'); }} data-testid="join-link-copy">복사</Button>}
            {canEdit && <Button size="sm" variant="secondary" onClick={off} data-testid="join-link-off">끄기</Button>}
          </div>
          <p className={cx('mt-1.5 text-xs', data.link.live ? 'text-ink-3' : 'text-red-700')} data-testid="join-link-meta">
            {data.link.live ? '사용 중' : '쓸 수 없음(기간 지남 또는 신청 수 다 참)'} · 만료 {data.link.expiresAt ? fmtDateTime(data.link.expiresAt) : '없음'} · 신청 {data.link.uses}{data.link.maxUses ? `/${data.link.maxUses}` : ''}건</p>
        </> : <p className="text-xs text-ink-3">지금 쓰는 초대 링크가 없습니다.</p>}
        {canEdit && <div className="mt-2 flex flex-wrap items-end gap-2">
          <Field label="쓸 수 있는 기간"><select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={days} onChange={(e) => setDays(e.target.value)} data-testid="join-days"><option value="7">7일</option><option value="30">30일</option><option value="90">90일</option><option value="">기간 없음</option></select></Field>
          <Field label="받을 신청 수"><select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} data-testid="join-max"><option value="">상한 없음</option><option value="10">10건</option><option value="30">30건</option><option value="100">100건</option></select></Field>
          <Button size="sm" disabled={busy} onClick={make} data-testid="join-link-make">{data.link ? '다시 만들기' : '링크 만들기'}</Button>
        </div>}
      </div>

      <div className="mt-3" data-testid="join-requests">
        <p className="font-medium">승인 대기 {pending.length}건</p>
        {!pending.length && <p className="mt-1 text-xs text-ink-3">기다리는 신청이 없습니다.</p>}
        <ul className="mt-1 divide-y divide-line">
          {pending.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-testid={`join-req-${r.email}`}>
              <span className="min-w-0 flex-1"><b>{r.name}</b> <span className="text-ink-3">{r.email}</span><span className="block text-xs text-ink-3">{VIA[r.via] ?? r.via} · {fmtDateTime(r.created_at)}{!r.verified && ' · 메일 확인 전(확인해야 승인할 수 있음)'}</span></span>
              {canEdit && <Button size="sm" disabled={!r.verified} onClick={() => setPick(r)} data-testid="join-req-open">승인·거절</Button>}
            </li>
          ))}
        </ul>
        {decided.length > 0 && <button type="button" className="mt-1 text-xs text-ink-3 underline" onClick={() => setShowDone((v) => !v)}>최근 30일 처리한 신청 {decided.length}건 {showDone ? '접기' : '보기'}</button>}
        {showDone && <ul className="mt-1 space-y-0.5 text-xs text-ink-2">{decided.map((r) => <li key={r.id}>{r.name} ({r.email}) · {r.status === 'approved' ? '승인' : '거절'} · {r.by ?? '-'} · {r.decided_at ? fmtDateTime(r.decided_at) : ''}{r.reject_reason ? ` — ${r.reject_reason}` : ''}</li>)}</ul>}
      </div>

      <div className="mt-3 rounded-input border border-line p-3 text-xs" data-testid="join-domain">
        <p className="text-sm font-medium">회사 메일 도메인 합류(선택)</p>
        <p className="mt-0.5 text-ink-3">켜면 @{data.domain.value ?? data.domain.mine} 메일로 워크인에 가입하는 사람에게 새 회사 대신 이 회사 합류 신청을 권합니다(관리자 승인은 그대로). 네이버·지메일 같은 공용 메일은 등록할 수 없습니다.</p>
        {data.domain.value ? <p className="mt-1.5">켜짐: <b>@{data.domain.value}</b> {canEdit && <Button size="sm" variant="secondary" className="ml-2" onClick={() => domain(null)} data-testid="join-domain-off">끄기</Button>}</p>
          : data.domain.canSet ? (canEdit && <Button size="sm" variant="secondary" className="mt-1.5" onClick={() => domain(data.domain.mine)} data-testid="join-domain-on">@{data.domain.mine} 로 켜기</Button>)
            : <p className="mt-1.5 text-ink-3">{data.domain.publicBlocked ? `내 로그인 메일(@${data.domain.mine})이 공용 메일이라 켤 수 없습니다 — 회사 도메인 메일로 로그인한 ${T.role.owner}·관리자가 켤 수 있습니다.` : '켤 수 없습니다.'}</p>}
      </div>

      {pick && <ApproveModal r={pick} teams={(teams.data?.teams ?? []).filter((t) => !t.archived)} onClose={() => setPick(null)} onDone={() => { setPick(null); reload(); }} />}
    </section>
  );
}

function ApproveModal({ r, teams, onClose, onDone }: { r: Req; teams: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const T = useTerms();
  const { data: pv } = useApi<{ people: number; now: Band; after: Band; bandChanges: boolean; seatFull: boolean; seatLimit: number | null }>(`/api/admin/join/${r.id}`);
  const [role, setRole] = useState('staff'); const [team, setTeam] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  async function go(action: 'approve' | 'reject') {
    setBusy(true);
    try {
      await api(`/api/admin/join/${r.id}`, { body: action === 'approve' ? { action, role, teamIds: team ? [team] : [], primaryTeamId: team || null } : { action, reason: reason.trim() || undefined } });
      toast.ok(action === 'approve' ? `${r.name}님을 승인했습니다 — 이제 로그인할 수 있습니다` : '신청을 거절했습니다'); onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={`합류 신청 — ${r.name}`}>
      <div className="space-y-3 text-sm" data-testid="join-approve">
        <p className="text-ink-2">{r.email} · {VIA[r.via] ?? r.via}</p>
        <Field label="역할"><select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} data-testid="join-role">
          {(['staff', 'site_manager', 'dept_lead', 'admin'] as const).map((x) => <option key={x} value={x}>{T.role[x]}</option>)}</select></Field>
        <Field label="부서·팀(선택)"><select className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} data-testid="join-team"><option value="">고르지 않음(본사 소속)</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        {pv && (pv.seatFull ? <p className="rounded-input bg-red-50 p-2 text-xs text-red-800" data-testid="join-seat">요금제 사용자 수({pv.seatLimit}명)가 다 찼습니다 — 요금제를 바꾸거나 쓰지 않는 계정을 정리한 뒤 승인하세요.</p>
          : pv.bandChanges && pv.now && pv.after ? <p className="rounded-input bg-amber-50 p-2 text-xs text-amber-900" data-testid="join-band">승인하면 인원이 {pv.people}명 → {pv.people + 1}명이 되어 요금 구간이 바뀝니다: {pv.now.label} 월 {won(pv.now.krw)} → <b>{pv.after.label} 월 {won(pv.after.krw)}</b>(부가세 포함 · 다음 결제부터)</p>
            : <p className="text-xs text-ink-3" data-testid="join-band">승인해도 요금 구간은 그대로입니다{pv.now ? `(${pv.now.label})` : ''}.</p>)}
        <div className="flex flex-wrap gap-2"><Button disabled={busy || !!pv?.seatFull} onClick={() => go('approve')} data-testid="join-approve-go">승인</Button></div>
        <div className="border-t border-line pt-3">
          <Field label="거절 사유(선택 — 신청한 분에게 메일로 감)"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} data-testid="join-reject-reason" /></Field>
          <Button variant="secondary" className="mt-2" disabled={busy} onClick={() => go('reject')} data-testid="join-reject-go">거절</Button>
        </div>
      </div>
    </Modal>
  );
}
