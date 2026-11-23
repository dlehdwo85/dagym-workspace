'use client';
// #1129(대표 11/23): 자료실·업무 공개 방식 — 자료실 화면의 [공개 방식] 단추. 보기는 누구나, 바꾸기는 대표(바꾸기 전 영향 건수 · 확인)
// 항목마다 바꾸기: 업무 상세 '공개 범위'(ItemShareSelect) · 자료실 '우리 팀' 파일 상세
import { useState } from 'react';
import { Globe2, Users } from 'lucide-react';
import { ApiError, api, useApi } from './client';
import { Button, Modal, askConfirm, cx, toast } from './ui';

type Mode = 'team' | 'company';
type Info = { mode: Mode; canEdit: boolean; affected?: { tasks: number; files: number; pinnedTasks: number; pinnedFiles: number } };
export const MODE_LABEL: Record<Mode, string> = { team: '부서·팀별', company: '회사 전체 공유' };

export function ShareModeButton() {
  const info = useApi<Info>('/api/org/share-mode');
  const [open, setOpen] = useState(false);
  if (!info.data) return null;
  return <>
    <Button variant="ghost" onClick={() => setOpen(true)} data-testid="share-mode-open">{info.data.mode === 'company' ? <Globe2 /> : <Users />}공개 방식: {MODE_LABEL[info.data.mode]}</Button>
    {open && <ShareModeDialog info={info.data} onClose={() => setOpen(false)} onSaved={() => { info.reload(); setOpen(false); }} />}
  </>;
}

function ShareModeDialog({ info, onClose, onSaved }: { info: Info; onClose: () => void; onSaved: () => void }) {
  const [pick, setPick] = useState<Mode>(info.mode);
  const [busy, setBusy] = useState(false);
  const a = info.affected;
  const save = async () => {
    if (pick === info.mode) return onClose();
    const msg = pick === 'company'
      ? `회사 전체 공유로 바꾸면 업무 ${a?.tasks ?? 0}건과 '우리 팀' 자료 ${a?.files ?? 0}건을 같은 회사 사람 모두가 볼 수 있습니다(고치기 권한은 그대로). 계속할까요?`
      : `부서·팀별로 바꾸면 업무 ${a?.tasks ?? 0}건과 '우리 팀' 자료 ${a?.files ?? 0}건이 다시 그 부서·팀 사람에게만 보입니다. 계속할까요?`;
    if (!(await askConfirm(msg, { title: '공개 방식 바꾸기', ok: '바꾸기' }))) return;
    setBusy(true);
    try { await api('/api/org/share-mode', { method: 'PUT', body: { mode: pick } }); toast.ok(`공개 방식: ${MODE_LABEL[pick]}`); onSaved(); }
    catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  const opt = (m: Mode, title: string, desc: string) => (
    <label className={cx('flex cursor-pointer gap-2 rounded-input border p-3', pick === m ? 'border-brand-600 bg-brand-50/40' : 'border-line', !info.canEdit && 'cursor-default')} data-testid={`share-mode-${m}`}>
      <input type="radio" name="share-mode" className="mt-1" checked={pick === m} disabled={!info.canEdit} onChange={() => setPick(m)} />
      <span><b className="text-sm text-ink">{title}</b>{info.mode === m && <span className="ml-1.5 text-xs text-ink-3">지금</span>}<span className="mt-0.5 block text-xs text-ink-2">{desc}</span></span>
    </label>
  );
  return (
    <Modal open onClose={onClose} title="자료실·업무 공개 방식">
      <div className="space-y-3" data-testid="share-mode-dialog">
        {opt('team', '부서·팀별', '업무는 그 부서·팀과 관련된 사람만, 자료실 \'우리 팀\' 자료는 그 팀만 봅니다.')}
        {opt('company', '회사 전체 공유', "같은 회사 사람이 다른 부서·팀의 업무와 '우리 팀' 자료도 봅니다. 보기와 댓글만 넓어지고, 고치기 권한은 그대로입니다.")}
        <p className="text-xs text-ink-3">둘 다 그대로 막히는 것: 격리 팀(회사 안의 작은 회사), 기밀 등급 자료, 내 파일, 다른 회사. 업무·파일마다 「공개 범위」를 따로 정한 것은 이 설정을 따르지 않습니다{a ? `(업무 ${a.pinnedTasks}건, 자료 ${a.pinnedFiles}건)` : ''}.</p>
        {info.canEdit && a && pick !== info.mode && <p className="rounded-input bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="share-mode-preview">바꾸면 업무 {a.tasks}건과 「우리 팀」 자료 {a.files}건의 보이는 범위가 바뀝니다.</p>}
        {!info.canEdit && <p className="text-xs text-ink-3">공개 방식은 대표가 정합니다.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>닫기</Button>
          {info.canEdit && <Button onClick={save} disabled={busy || pick === info.mode} data-testid="share-mode-save">저장</Button>}
        </div>
      </div>
    </Modal>
  );
}

/** 업무·'우리 팀' 파일 한 건의 공개 범위 — 회사 설정 따름 / 회사 전체 / 이 부서·팀만 */
export function ItemShareSelect({ url, value, companyMode, onSaved, testid, disabled }: { url: string; value: Mode | null | undefined; companyMode?: Mode; onSaved?: (v: Mode | null) => void; testid?: string; disabled?: boolean }) {
  const [v, setV] = useState<Mode | null>(value ?? null);
  const change = async (next: Mode | null) => {
    const prev = v; setV(next);
    try { await api(url, { method: 'PUT', body: { share: next } }); onSaved?.(next); toast.ok('공개 범위를 바꿨습니다'); }
    catch (e) { setV(prev); toast.error((e as ApiError).message); }
  };
  return (
    <select className="h-8 rounded-input border border-line bg-white px-2 text-xs" value={v ?? ''} disabled={disabled} onChange={(e) => change((e.target.value || null) as Mode | null)} aria-label="공개 범위" data-testid={testid}>
      <option value="">회사 설정 따름{companyMode ? `(${MODE_LABEL[companyMode]})` : ''}</option>
      <option value="company">회사 전체</option>
      <option value="team">이 부서·팀만</option>
    </select>
  );
}
