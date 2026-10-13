'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { api, broadcastRefresh, useApi } from './client';
import { Button, Field, Modal, cx, fmtMinutes, inputCls, toast, todayStr } from './ui';
import { UserSelect } from './pickers';
import { quickDues } from './TaskQuick';
import { useSession } from './session';

export interface QuickDefaults { projectId?: string; orgUnitId?: string; dueDate?: string; parentId?: string; assigneeId?: string; sectionId?: string }

/**
 * 업무 만들기 (HQ_SIMPLIFY): 제목 · 담당자 · 마감일 · 프로젝트 4칸.
 * 관리자 최종 확인은 기본 꺼짐, 소속·브랜드는 프로젝트/내 소속(본사)으로 자동. 자세한 항목은 만든 뒤 상세 패널에서.
 */
export function QuickAddTask({ open, onClose, defaults, onCreated }: { open: boolean; onClose: () => void; defaults?: QuickDefaults; onCreated?: (id: string) => void }) {
  const { user, dir } = useSession();
  const router = useRouter();
  const projects = useApi<{ projects: any[] }>(open ? '/api/projects' : null);
  const [showTpl, setShowTpl] = useState(false);
  const templates = useApi<{ templates: any[] }>(open && showTpl ? '/api/templates' : null);
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('');
  // 모바일 바텀시트에서 연달아 등록: "계속 추가"면 저장 후 창을 닫지 않고 제목만 비운다
  const [keep, setKeep] = useState(false);
  useEffect(() => { try { setKeep(localStorage.getItem('wos_quick_keep') === '1'); } catch {} }, []);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setF({ title: '', assigneeId: defaults?.assigneeId ?? user.id, requestedById: user.id, dueDate: defaults?.dueDate ?? '', projectId: defaults?.projectId ?? '' });
      setTpl(''); setShowTpl(false);
    }
  }, [open, defaults, user.id]);

  const set = (k: string) => (v: any) => setF((x: any) => ({ ...x, [k]: v }));
  // 배정 경고: 담당자의 마감일 회의·남은 가용 시간
  const avail = useApi<{ days: any[] }>(open && f.assigneeId && f.dueDate ? `/api/availability?userId=${f.assigneeId}&date=${f.dueDate}` : null, [f.assigneeId, f.dueDate]);
  const day = avail.data?.days?.[0];
  const who = dir.users.find((x) => x.id === f.assigneeId)?.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim()) return toast.error('제목을 입력하세요');
    setBusy(true);
    try {
      let r: { id: string };
      if (tpl) {
        const unit = defaults?.orgUnitId ?? dir.users.find((u) => u.id === user.id)?.org_unit_ids?.[0] ?? dir.orgUnits[0]?.id;
        r = await api(`/api/templates/${tpl}/apply`, { body: { title: f.title, orgUnitId: unit, projectId: f.projectId || null, assigneeId: f.assigneeId, dueDate: f.dueDate || undefined } });
      } else {
        r = await api('/api/tasks', {
          queueOffline: `업무 등록: ${f.title}`,
          body: {
            title: f.title, assigneeId: f.assigneeId || null, requestedById: f.requestedById || user.id, dueDate: f.dueDate || null, projectId: f.projectId || null,
            parentId: defaults?.parentId, orgUnitId: defaults?.orgUnitId,
            sectionId: f.projectId && f.projectId === defaults?.projectId ? defaults?.sectionId ?? null : null,
            approvalRequired: false,
          },
        });
      }
      toast.ok('업무를 등록했습니다');
      broadcastRefresh();
      if (keep && !defaults?.parentId) { setF((x: any) => ({ ...x, title: '' })); setTpl(''); titleRef.current?.focus(); return; }
      onClose();
      // 자세한 항목은 만든 뒤 상세에서 — 목록 안(onCreated)이 아니면 상세로 이동
      if (onCreated) onCreated(r.id); else router.push(`/tasks/${r.id}`);
    } catch (err: any) {
      if (err.code === 'queued') { toast.info(err.message); onClose(); } else toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={defaults?.parentId ? '하위 업무 추가' : '업무 등록'}>
      <form onSubmit={submit} className="space-y-3" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.currentTarget as HTMLFormElement).requestSubmit(); } }}>
        <Field label="제목"><input ref={titleRef} autoFocus className={cx(inputCls, 'h-11 text-base')} value={f.title ?? ''} onChange={(e) => set('title')(e.target.value)} placeholder="무엇을 해야 하나요?" maxLength={200} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="담당자"><UserSelect ariaLabel="담당자" value={f.assigneeId} onChange={set('assigneeId')} /></Field>
          <Field label="지시자 (업무를 부여한 사람)"><UserSelect ariaLabel="지시자" placeholder="지시자 선택" value={f.requestedById} onChange={set('requestedById')} /></Field>
          <Field label="마감일"><input type="date" className={inputCls} value={f.dueDate ?? ''} onChange={(e) => set('dueDate')(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="마감 빠른 선택">
          {quickDues().map(([l, d]) => (
            <button key={l} type="button" onClick={() => set('dueDate')(d)}
              className={cx('rounded-full border px-2.5 py-1 text-xs font-medium', f.dueDate === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2 hover:border-slate-300')}>{l}</button>
          ))}
          {f.dueDate && <button type="button" onClick={() => set('dueDate')('')} className="rounded-full px-2 py-1 text-xs text-ink-3 hover:text-ink-2">지우기</button>}
        </div>
        {!defaults?.parentId && (
          <Field label="프로젝트">
            <select className={inputCls} value={f.projectId ?? ''} onChange={(e) => set('projectId')(e.target.value)}>
              <option value="">없음</option>
              {projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        {day && f.assigneeId !== user.id && (
          <p className={day.freeMinutes < 60 || day.away || day.holiday ? 'rounded-input bg-amber-50 p-2 text-xs text-amber-900' : 'rounded-input bg-slate-50 p-2 text-xs text-ink-2'} data-testid="assign-availability">
            {who ?? '담당자'} · {f.dueDate} {day.holiday ? `공휴일(${day.holiday})` : day.away ? '휴가·출장' : !day.workday ? '쉬는 날' : `회의 ${fmtMinutes(day.meetingMinutes) || '없음'}, 남은 가용 ${fmtMinutes(day.freeMinutes) || '0분'}`}
          </p>
        )}
        {!defaults?.parentId && (showTpl ? (
          <Field label="템플릿에서 시작 (선택)">
            <select className={inputCls} value={tpl} onChange={(e) => {
              setTpl(e.target.value);
              const t = templates.data?.templates.find((x) => x.id === e.target.value);
              if (t) setF((x: any) => ({ ...x, title: x.title || t.payload.title || '', dueDate: x.dueDate || (t.payload.dueInDays !== undefined ? addDaysStr(todayStr(), t.payload.dueInDays) : '') }));
            }}>
              <option value="">빈 업무</option>
              {templates.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        ) : <button type="button" onClick={() => setShowTpl(true)} className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink"><LayoutTemplate className="size-3.5" />템플릿에서 시작</button>)}
        {/* 하단 고정 저장·취소 (휴대폰 키보드 위에서도 보이게), Ctrl+Enter 저장 */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-2 border-t border-line bg-white px-5 py-3 pb-[calc(var(--sab)+12px)] sm:pb-3">
          {defaults?.parentId ? <span className="text-xs text-ink-3">설명·하위 업무·첨부는 만든 뒤 상세에서</span> : (
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" className="size-4 accent-brand-600" checked={keep}
              onChange={(e) => { setKeep(e.target.checked); try { localStorage.setItem('wos_quick_keep', e.target.checked ? '1' : '0'); } catch {} }} />계속 추가 (등록 후 창 유지)</label>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={busy} className="min-w-[88px]" title="Ctrl+Enter">{busy ? '저장 중…' : '저장'}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function addDaysStr(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
