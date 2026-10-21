'use client';
import { useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, inputCls, toast } from '@/components/ui';

/** 대표 10/20 15:00 (#100) 관리 › 사용자 관리 › 담당자 지정 — 역할별 주·부 담당. 자동 업무·카드·알림이 이 사람에게 가고, 주 담당이 연차·출장이면 부 담당에게 */
type Rule = { id: string; kind: string; ref: string; primaryUserId: string; backupUserId: string | null; note: string | null; primaryName: string; backupName: string | null; primaryAway: string | null; backupAway: string | null };
type Data = { rules: Rule[]; options: { people: { id: string; name: string; title: string | null }[]; brands: { id: string; name: string; color: string }[]; units: { id: string; parent_id: string | null; type: string; name: string }[]; sources: { key: string; label: string }[] }; labels: Record<string, string> };
const UNIT_TYPE: Record<string, string> = { hq: '본사', department: '부서', team: '팀' };

export function AssigneeRulesTab() {
  const { data, error, reload } = useApi<Data>('/api/admin/assignees');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const find = (kind: string, ref: string) => data.rules.find((r) => r.kind === kind && r.ref === ref);
  const sections: { kind: string; hint: string; rows: { ref: string; label: string }[] }[] = [
    { kind: 'approver', hint: '마케팅 승인 요청 카드·알림을 받는 사람. 비우면 대표·관리자 전원이 받습니다.', rows: [{ ref: '', label: '회사 전체' }] },
    { kind: 'marketing_brand', hint: '브랜드별 자동 제작 카드 알림과 전화 문의 → 업무의 담당자. 기본 = 브랜드가 없는 건.', rows: [{ ref: '', label: '기본(브랜드 없음)' }, ...data.options.brands.map((b) => ({ ref: b.id, label: b.name }))] },
    { kind: 'sales_source', hint: '원천 상태가 진행으로 바뀌어 자동 업무가 생길 때 담당자 · [영업 진행으로 넘기기] 기본 선택 · 입찰 다이제스트 받는 사람(입찰). 기본 = 원천별 규칙이 없을 때.', rows: [{ ref: '', label: '기본(모든 원천)' }, ...data.options.sources.map((s) => ({ ref: s.key, label: s.label }))] },
    { kind: 'task_unit', hint: '현장 QR 신고처럼 그 부서·팀으로 들어오는 자동 업무의 담당자(양식 기본 담당자가 없을 때).', rows: data.options.units.map((u) => ({ ref: u.id, label: `${UNIT_TYPE[u.type] ?? u.type} · ${u.name}` })) },
  ];
  return (
    <div className="space-y-3" data-testid="assignee-rules">
      <p className="text-xs text-ink-2">자동으로 생기는 업무·카드·알림이 여기 정한 사람에게 갑니다. 주 담당이 <b>연차·출장</b>이면 부 담당에게, 둘 다 부재면 주 담당에게(복귀 후 확인). 규칙으로 배정된 업무는 목록에 <span className="rounded-full bg-violet-50 px-1.5 text-[10px] font-medium text-violet-800">규칙 배정</span> 표시.</p>
      {sections.map((sec) => (
        <section key={sec.kind} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid={`assignee-${sec.kind}`}>
          <h2 className="text-sm font-semibold">{data.labels[sec.kind]}</h2>
          <p className="mb-1 text-[11px] text-ink-3">{sec.hint}</p>
          {sec.rows.length ? sec.rows.map((row) => { const rule = find(sec.kind, row.ref);
            return <RuleRow key={`${sec.kind}:${row.ref}:${rule?.id ?? ''}:${rule?.primaryUserId ?? ''}:${rule?.backupUserId ?? ''}`} kind={sec.kind} refKey={row.ref} label={row.label} rule={rule} people={data.options.people} onSaved={reload} />; })
            : <p className="text-xs text-ink-3">부서·팀이 없습니다</p>}
        </section>))}
    </div>
  );
}

function RuleRow({ kind, refKey, label, rule, people, onSaved }: { kind: string; refKey: string; label: string; rule?: Rule; people: Data['options']['people']; onSaved: () => void }) {
  const [p, setP] = useState(rule?.primaryUserId ?? ''); const [b, setB] = useState(rule?.backupUserId ?? ''); const [note, setNote] = useState(rule?.note ?? ''); const [busy, setBusy] = useState(false);
  async function save() {
    if (!p) return toast.error('주 담당을 고르세요');
    setBusy(true);
    try { await api('/api/admin/assignees', { method: 'PUT', body: { kind, ref: refKey, primaryUserId: p, backupUserId: b || null, note: note || null } }); toast.ok('담당자를 저장했습니다'); onSaved(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function clear() {
    if (!rule) return;
    setBusy(true);
    try { await api(`/api/admin/assignees/${rule.id}`, { method: 'DELETE' }); toast.ok('규칙을 지웠습니다'); onSaved(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const opt = (x: { id: string; name: string; title: string | null }) => <option key={x.id} value={x.id}>{x.name}{x.title ? ` · ${x.title}` : ''}</option>;
  return (
    <div className={cx('grid gap-1.5 border-t border-line py-1.5 sm:grid-cols-[11rem_1fr_1fr_1fr_auto] sm:items-center', rule && 'bg-emerald-50/30')} data-testid="assignee-row" data-kind={kind} data-ref={refKey}>
      <div className="text-sm font-medium">{label}{rule && <span className="ml-1 rounded-full bg-emerald-50 px-1.5 text-[10px] font-normal text-emerald-800" data-testid="assignee-set">지정됨</span>}</div>
      <select className={cx(inputCls, 'h-8 py-0 text-xs')} value={p} onChange={(e) => setP(e.target.value)} aria-label={`${label} 주 담당`} data-testid="assignee-primary"><option value="">주 담당</option>{people.map(opt)}</select>
      <select className={cx(inputCls, 'h-8 py-0 text-xs')} value={b} onChange={(e) => setB(e.target.value)} aria-label={`${label} 부 담당`} data-testid="assignee-backup"><option value="">부 담당(없음)</option>{people.filter((x) => x.id !== p).map(opt)}</select>
      <input className={cx(inputCls, 'h-8 py-0 text-xs')} value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모(선택)" aria-label={`${label} 메모`} maxLength={300} />
      <div className="flex gap-1"><Button size="sm" onClick={save} disabled={busy} data-testid="assignee-save">저장</Button>{rule && <Button size="sm" variant="secondary" onClick={clear} disabled={busy} data-testid="assignee-clear">지우기</Button>}</div>
      {rule?.primaryAway && <p className="text-[11px] text-amber-700 sm:col-span-5" data-testid="assignee-away">주 담당 {rule.primaryName} 지금 {rule.primaryAway} → {rule.backupUserId ? (rule.backupAway ? `부 담당 ${rule.backupName}도 ${rule.backupAway} — 주 담당에게 배정(복귀 후 확인)` : `부 담당 ${rule.backupName}에게 배정`) : '부 담당이 없어 그대로 배정(복귀 후 확인)'}</p>}
    </div>
  );
}
