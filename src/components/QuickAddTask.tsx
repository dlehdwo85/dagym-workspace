'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, broadcastRefresh, useApi } from './client';
import { Button, Field, Modal, cx, fmtMinutes, inputCls, toast, todayStr } from './ui';
import { UserSelect } from './pickers';
import { BellChip, RepeatChip, noteAway, quickDues, voiceInput } from './TaskQuick';
import { VoiceButton } from './voice';
import { parseTaskText } from '@/lib/nlparse';
import { PRIORITY_LABEL } from '@/lib/types';
import { Loader2, Mic, Paperclip, Sparkles } from 'lucide-react';
import { AI_ACCEPT, uploadToLibrary } from './libraryUpload';
import { DropZone } from './upload';
import { TimePick } from './DateTimePickers';
import { useSession } from './session';

export interface QuickDefaults { dueTime?: string; projectId?: string; orgUnitId?: string; dueDate?: string; parentId?: string; assigneeId?: string; sectionId?: string; title?: string; description?: string }

/**
 * 업무 만들기 (HQ_SIMPLIFY): 제목 · 담당자 · 마감일 · 프로젝트 4칸.
 * 관리자 최종 확인은 기본 꺼짐, 소속·브랜드는 프로젝트/내 소속(본사)으로 자동. 자세한 항목은 만든 뒤 상세 패널에서.
 */
export function QuickAddTask({ open, onClose, defaults, onCreated, switchTo }: { open: boolean; onClose: () => void; defaults?: QuickDefaults; onCreated?: (id: string) => void; switchTo?: { label: string; onClick: () => void } }) {
  const { user, dir } = useSession();
  const router = useRouter();
  const projects = useApi<{ projects: any[] }>(open ? '/api/projects' : null);
  const teams = useApi<{ teams: { id: string; name: string; mine: boolean; members: { id: string }[] }[] }>(open ? '/api/teams' : null); // V14 8번
  const lastSrv = useApi<{ last: any }>(open ? '/api/me/quick-last' : null); // 검수 20: 사용자 단위 기억
  const templates = useApi<{ templates: any[] }>(open && !defaults?.parentId ? '/api/templates' : null);
  // V8 3번: 위쪽 "템플릿에서 만들기" — 고르면 제목·마감(오프셋)·기본 담당·지시가 채워지고 체크리스트·하위 업무까지 만들어진다
  const pickTpl = (id: string) => {
    setTpl(id);
    const t = templates.data?.templates.find((x) => x.id === id);
    if (t) setF((x: any) => ({ ...x, title: x.title || t.payload.title || '', dueDate: t.payload.dueInDays !== undefined ? addDaysStr(todayStr(), t.payload.dueInDays) : x.dueDate,
      assigneeId: t.payload.assigneeId ?? x.assigneeId, requestedById: t.payload.requestedById ?? x.requestedById }));
  };
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState('');
  // 모바일 바텀시트에서 연달아 등록: "계속 추가"면 저장 후 창을 닫지 않고 제목만 비운다
  const [keep, setKeep] = useState(false);
  useEffect(() => { try { setKeep(localStorage.getItem('wos_quick_keep') === '1'); } catch {} }, []);
  // R-16: 소속 팀 기본값 = 작성자의 팀(담당자는 그대로 — "소속 팀만"). 한 번도 고르지 않았을 때만
  useEffect(() => {
    const mine = teams.data?.teams.find((t) => t.mine);
    if (open && mine && f.teamId === undefined && !defaults?.parentId) setF((x: any) => (x.teamId === undefined ? { ...x, teamId: mine.id, teamMode: 'tag' } : x));
  }, [open, teams.data, f.teamId, defaults?.parentId]);
  const titleRef = useRef<HTMLInputElement>(null);
  // V37 3: 시트를 닫으면(바깥·✕·뒤로) 제목이 있을 때 자동 저장 — [취소]만 버린다. 자동 저장은 상세로 이동하지 않는다
  const formRef = useRef<HTMLFormElement>(null);
  const closing = useRef(false);
  const dismiss = () => { if (busy) return; if (f.title?.trim()) { closing.current = true; formRef.current?.requestSubmit(); } else onClose(); };
  const { features } = useSession();
  // V12 8번 "📎 자료로 채우기": 자료를 올리면 AI 가 제목·설명·체크리스트·마감을 채우고, 저장하면 그 자료가 업무에 첨부된다
  const fillRef = useRef<HTMLInputElement>(null);
  const [filling, setFilling] = useState('');
  async function fillFrom(files: FileList | null) {
    if (!files?.length) return;
    try {
      const ups: { id: string; name: string }[] = [];
      for (const fl of Array.from(files).slice(0, 5)) { setFilling(`${fl.name} 올리는 중…`); ups.push(await uploadToLibrary(fl, undefined, (pct) => setFilling(`${fl.name} 올리는 중… ${pct}%`))); }
      setFilling('AI 가 자료를 읽는 중…');
      const r = await api('/api/ai/fill', { body: { fileIds: ups.map((u) => u.id), hint: f.title || undefined } });
      setF((x: any) => ({ ...x, title: r.title || x.title, description: r.description, checklist: r.checklist, ...(r.dueDate ? { dueDate: r.dueDate } : {}), ...(r.dueTime ? { dueTime: r.dueTime } : {}),
        fileIds: [...(x.fileIds ?? []), ...ups.map((u) => u.id)], fileNames: [...(x.fileNames ?? []), ...ups.map((u) => u.name)] }));
      toast.ok('자료 내용으로 채웠습니다 — 확인하고 저장하세요');
    } catch (e: any) { toast.error(e.message); } finally { setFilling(''); if (fillRef.current) fillRef.current.value = ''; }
  }

  // 창이 "새로 열릴 때"만 초기화 — 부모가 다시 그려져 defaults 객체가 바뀌어도 입력 중인 내용을 지우지 않게
  const wasOpen = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (opening) {
      // V8 9번 · 검수 20: 마지막에 쓴 담당·지시·우선순위·프로젝트·알림을 사용자 단위로 기억(서버). 서버 값이 오기 전엔 이 기기 값
      let last: any = lastSrv.data?.last ?? {};
      if (!lastSrv.data?.last) try { last = JSON.parse(localStorage.getItem('wos_quick_last') ?? '{}'); } catch {}
      setF({ title: defaults?.title ?? '', ...(defaults?.description ? { description: defaults.description } : {}), multi: false, more: [], dueTime: defaults?.dueTime ?? '', assigneeId: defaults?.assigneeId ?? last.assigneeId ?? user.id, requestedById: last.requestedById ?? user.id,
        dueDate: defaults?.dueDate ?? '', projectId: defaults?.projectId ?? last.projectId ?? '', priority: last.priority ?? 'normal', rrule: null, remind: last.remind ?? null });
      setTpl(''); setNoAuto(false);
    }
  }, [open, defaults, user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 서버의 마지막 설정이 늦게 오면, 아직 손대지 않은 칸만 채운다
  const lastApplied = useRef(false);
  useEffect(() => { if (!open) { lastApplied.current = false; return; } const l = lastSrv.data?.last; if (!l || lastApplied.current) return; lastApplied.current = true;
    setF((x: any) => ({ ...x, ...(defaults?.assigneeId || !l.assigneeId ? {} : { assigneeId: l.assigneeId }), ...(l.requestedById ? { requestedById: l.requestedById } : {}),
      ...(defaults?.projectId || l.projectId === undefined ? {} : { projectId: l.projectId ?? '' }), ...(l.priority ? { priority: l.priority } : {}), ...(l.remind !== undefined ? { remind: l.remind } : {}) }));
  }, [open, lastSrv.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: string) => (v: any) => setF((x: any) => ({ ...x, [k]: v }));
  // 배정 경고: 담당자의 마감일 회의·남은 가용 시간
  const avail = useApi<{ days: any[] }>(open && f.assigneeId && f.dueDate ? `/api/availability?userId=${f.assigneeId}&date=${f.dueDate}` : null, [f.assigneeId, f.dueDate]);
  const day = avail.data?.days?.[0];
  const who = dir.users.find((x) => x.id === f.assigneeId)?.name;
  const parsed = (f.title ?? '').trim().length > 3 ? parseTaskText(f.title, dir.users, todayStr(), projects.data?.projects ?? []) : null;
  // 검수 20: 인식 결과는 "적용" 없이 바로 칩에 반영, 저장할 때 제목에서 그 말을 뺀다 (✕ 로 끌 수 있음)
  const [noAuto, setNoAuto] = useState(false);
  const autoKey = !noAuto && parsed && parsed.matched.length ? JSON.stringify([parsed.dueDate, parsed.dueTime, parsed.assigneeId, parsed.priority, parsed.projectId, parsed.rrule]) : '';
  useEffect(() => {
    if (!autoKey || !parsed) return;
    setF((x: any) => ({ ...x, ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}), ...(parsed.dueTime ? { dueTime: parsed.dueTime } : {}), ...(parsed.assigneeId ? { assigneeId: parsed.assigneeId } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}), ...(parsed.projectId ? { projectId: parsed.projectId } : {}), ...(parsed.rrule ? { rrule: parsed.rrule } : {}) }));
  }, [autoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const finalTitle = () => (!noAuto && parsed && parsed.matched.length && parsed.title.trim() ? parsed.title.trim() : f.title.trim());
  const applyParsed = (p: NonNullable<typeof parsed>) => setF((x: any) => ({ ...x, title: p.title, ...(p.dueDate ? { dueDate: p.dueDate } : {}), ...(p.dueTime ? { dueTime: p.dueTime } : {}),
    ...(p.assigneeId ? { assigneeId: p.assigneeId } : {}), ...(p.priority ? { priority: p.priority } : {}), ...(p.projectId ? { projectId: p.projectId } : {}), ...(p.rrule ? { rrule: p.rrule } : {}) }));
  const [listening, setListening] = useState(false);
  const voice = () => voiceInput(setListening, (text) => {
    const p = parseTaskText(text, dir.users, todayStr(), projects.data?.projects ?? []); applyParsed(p); toast.info(`들은 내용: "${text}"`);
    if (features.ai && text.replace(/\s/g, '').length >= 12) { setAiText(text); aiFill(text); } // 길게 말하면 AI 비서가 업무명·담당·마감 정리
  });
  // 대표(10/16): 업무 등록 창에 AI 비서 — 말하거나 편하게 적으면 업무명·담당·마감·설명·체크리스트를 채운다(확인 후 저장)
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  async function aiFill(text = aiText) {
    if (!text.trim()) { toast.error('AI 비서에게 할 말을 적거나 마이크로 말해 주세요'); return; }
    setAiBusy(true);
    try {
      const r = await api<{ ok: boolean; title?: string; assigneeId?: string | null; dueDate?: string | null; dueTime?: string | null; description?: string; checklist?: string[] }>('/api/voice/structure', { body: { text } });
      if (!r.ok) { const p = parseTaskText(text, dir.users, todayStr(), projects.data?.projects ?? []); applyParsed(p); toast.info('AI 를 쓸 수 없어 기본 인식으로 채웠습니다'); return; }
      setNoAuto(true);
      setF((x: any) => ({ ...x, title: r.title || x.title, ...(r.assigneeId ? { assigneeId: r.assigneeId } : {}), ...(r.dueDate ? { dueDate: r.dueDate } : {}), ...(r.dueTime ? { dueTime: r.dueTime } : {}),
        ...(r.description ? { description: r.description } : {}), ...(r.checklist?.length ? { checklist: r.checklist } : {}) }));
      toast.ok('AI 비서가 채웠습니다 — 확인하고 저장하세요');
    } catch (e: any) { toast.error(e.message); } finally { setAiBusy(false); }
  }
  const count = f.multi ? new Set([f.assigneeId, ...(f.more ?? [])].filter(Boolean)).size : 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const auto = closing.current; closing.current = false;
    if (!f.title?.trim()) return toast.error('제목을 입력하세요');
    setBusy(true);
    try {
      let r: { id: string };
      if (tpl) {
        const unit = defaults?.orgUnitId ?? dir.users.find((u) => u.id === user.id)?.org_unit_ids?.[0] ?? dir.orgUnits[0]?.id;
        r = await api(`/api/templates/${tpl}/apply`, { body: { title: finalTitle(), orgUnitId: unit, projectId: f.projectId || null, assigneeId: f.assigneeId, requestedById: f.requestedById || undefined, dueDate: f.dueDate || undefined } });
      } else {
        r = await api('/api/tasks', {
          queueOffline: `업무 등록: ${finalTitle()}`,
          body: {
            title: finalTitle(), assigneeId: f.assigneeId || null, requestedById: f.requestedById || user.id, dueDate: f.dueDate || (f.rrule ? todayStr() : null), dueTime: f.dueDate && f.dueTime ? f.dueTime : null, projectId: f.projectId || null,
            priority: f.priority ?? 'normal', recurrenceRule: f.rrule ?? null, reminderMinutes: f.remind ?? null,
            ...(f.description ? { description: f.description } : {}), ...(f.checklist?.length ? { checklist: f.checklist } : {}),
            ...(count > 1 && !f.teamId && f.multiMode !== 'together' ? { assigneeIds: [f.assigneeId, ...(f.more ?? [])].filter(Boolean) } : {}),
            // R-15 6번: "한 업무로 함께" — 첫 사람이 주 담당, 나머지는 협업자
            ...(f.multi && f.multiMode === 'together' && (f.more ?? []).length ? { collaboratorIds: (f.more ?? []).filter((x: string) => x !== f.assigneeId) } : {}),
            ...(f.teamId ? { teamId: f.teamId, teamMode: f.teamMode ?? 'lead', ...(f.teamMode === 'each' || f.teamMode === 'tag' ? {} : { assigneeId: null }) } : {}),
            parentId: defaults?.parentId, orgUnitId: defaults?.orgUnitId,
            sectionId: f.projectId && f.projectId === defaults?.projectId ? defaults?.sectionId ?? null : null,
            approvalRequired: false,
          },
        });
      }
      // 자료로 채웠으면 그 자료를 만든 업무(여러 명이면 각각)에 첨부
      for (const tid of ((r as any).ids ?? [r.id]) as string[]) for (const fid of f.fileIds ?? []) await api(`/api/library/${fid}/attach`, { body: { taskId: tid } }).catch(() => {});
      const lastV = { assigneeId: f.assigneeId || null, requestedById: f.requestedById || null, priority: f.priority ?? 'normal', projectId: f.projectId || null, remind: f.remind ?? null };
      try { localStorage.setItem('wos_quick_last', JSON.stringify(lastV)); } catch {}
      api('/api/me/quick-last', { method: 'PUT', body: lastV }).catch(() => {});
      toast.ok(f.teamId ? (f.teamMode === 'each' ? `팀원 ${((r as any).ids ?? [r.id]).length}명에게 각각 만들었습니다` : '팀에 배정했습니다 — 팀장에게 알림을 보냈습니다') : count > 1 ? `${count}명에게 각각 만들었습니다 — 각자에게 알림을 보냈습니다` : f.assigneeId && f.assigneeId !== user.id ? '업무를 등록했습니다 — 담당자에게 알림을 보냈습니다' : '업무를 등록했습니다 — 본인 업무는 마감 때 알려 드립니다');
      broadcastRefresh(); noteAway(r);
      if (keep && !auto && !defaults?.parentId) { setF((x: any) => ({ ...x, title: '' })); setNoAuto(false); setTpl(''); titleRef.current?.focus(); return; }
      onClose();
      // 자세한 항목은 만든 뒤 상세에서 — 목록 안(onCreated)이 아니면 상세로 이동
      if (onCreated) onCreated(r.id); else if (!auto) router.push(`/tasks/${r.id}`);
    } catch (err: any) {
      if (err.code === 'queued') { toast.info(err.message); onClose(); } else toast.error(err.message);
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={dismiss} title={defaults?.parentId ? '하위 업무 추가' : '업무 등록'}>
      {/* V14 35번: 캘린더 빠른 등록 — 업무(기본) ↔ 일정 전환 */}
      {switchTo && (
        <div className="mb-3 inline-flex rounded-full bg-slate-100 p-0.5 text-sm" data-testid="quick-kind">
          <span className="rounded-full bg-white px-3 py-1 font-semibold shadow-sm">업무</span>
          <button type="button" className="rounded-full px-3 py-1 text-ink-2 hover:text-ink" onClick={switchTo.onClick} data-testid="quick-switch-event">{switchTo.label}</button>
        </div>
      )}
      {!defaults?.parentId && (
        <button type="button" onClick={() => { onClose(); setTimeout(() => window.dispatchEvent(new Event('wos-voice-add')), 0); }} className="mb-3 flex w-full items-center justify-center gap-2 rounded-input border border-brand-600/30 bg-brand-50 py-3 text-base font-semibold text-brand-700" data-testid="quick-voice-add">
          <Mic className="size-5" />음성 등록
        </button>
      )}
      {!defaults?.parentId && features.ai && (
        <>
          <DropZone onFiles={(fl) => fillFrom(fl)} disabled={!!filling} label="여기에 놓으면 자료로 채웁니다">
          <button type="button" onClick={() => fillRef.current?.click()} disabled={!!filling} className="mb-3 flex w-full items-center justify-center gap-2 rounded-input border border-amber-300 bg-amber-50 py-2.5 text-sm font-semibold text-amber-800 disabled:opacity-60" data-testid="quick-fill">
            {filling ? <><Loader2 className="size-4 animate-spin" />{filling}</> : <><Paperclip className="size-4" />📎 자료로 채우기 (사진·PDF·엑셀)</>}
          </button>
          </DropZone>
          <input ref={fillRef} type="file" multiple accept={AI_ACCEPT} className="hidden" onChange={(e) => fillFrom(e.target.files)} data-testid="quick-fill-input" />
        </>
      )}
      <form ref={formRef} onSubmit={submit} className="space-y-3" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.currentTarget as HTMLFormElement).requestSubmit(); } }}>
        {!defaults?.parentId && (templates.data?.templates.length ?? 0) > 0 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="템플릿에서 만들기" data-testid="tpl-chips">
            <span className="shrink-0 self-center text-xs text-ink-2">템플릿</span>
            {templates.data!.templates.map((t) => (
              <button key={t.id} type="button" aria-pressed={tpl === t.id} onClick={() => (tpl === t.id ? setTpl('') : pickTpl(t.id))}
                className={cx('shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium', tpl === t.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>{t.personal ? '★ ' : ''}{t.name}</button>
            ))}
          </div>
        )}
        {features.ai && !defaults?.parentId && (
          <div className="space-y-1.5 rounded-input border border-accent-200 bg-accent-50/50 p-2.5" data-testid="quick-ai">
            <p className="flex items-center gap-1 text-xs font-semibold text-accent-700"><Sparkles className="size-3.5" />AI 비서 — 말하거나 편하게 적으면 아래 칸을 채워요</p>
            <textarea className={cx(inputCls, 'min-h-[56px] text-sm')} value={aiText} onChange={(e) => setAiText(e.target.value)} aria-label="AI 비서에게 업무 설명"
              placeholder="예: 다음 주 금요일까지 김민수 본부장한테 푸르지오 비교 파일 검수받고 보고하라고 해 줘" />
            <div className="flex items-center gap-2">
              <VoiceButton value={aiText} onChange={setAiText} label="AI 비서에게 말하기" />
              <Button type="button" size="sm" variant="accent" className="ml-auto" disabled={aiBusy || !aiText.trim()} onClick={() => aiFill()} data-testid="quick-ai-fill">
                {aiBusy ? <><Loader2 className="animate-spin" />정리하는 중…</> : <><Sparkles />AI로 채우기</>}</Button>
            </div>
          </div>
        )}
        <Field label="제목">
          <span className="flex items-center gap-1.5">
            <input ref={titleRef} autoFocus className={cx(inputCls, 'h-11 text-base')} value={f.title ?? ''} onChange={(e) => set('title')(e.target.value)} placeholder="무엇을 해야 하나요?" maxLength={200} />
            <button type="button" onClick={voice} aria-label="음성으로 입력" aria-pressed={listening} className={cx('flex size-11 shrink-0 items-center justify-center rounded-input border border-line', listening ? 'animate-pulse bg-red-500 text-white' : 'text-ink-2 hover:bg-slate-50')} data-testid="quick-voice"><Mic className="size-5" /></button>
          </span>
        </Field>
        {/* V8 9번: "내일 3시 @김민수 !높음 #입찰 매주" 처럼 쓰면 알아봄 → 적용 */}
        {parsed && parsed.matched.length > 0 && (
          <div className={cx('-mt-1 inline-flex flex-wrap items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', noAuto ? 'bg-slate-100 text-ink-3' : 'bg-accent-50 text-accent-700')} data-testid="quick-nl-apply">
            <Sparkles className="size-3.5" />{noAuto ? '자동 인식 꺼짐' : '자동 인식'}: {[parsed.dueDate && `${Number(parsed.dueDate.slice(5, 7))}/${Number(parsed.dueDate.slice(8))}`, parsed.dueTime, parsed.assigneeName, parsed.priority && PRIORITY_LABEL[parsed.priority], parsed.projectName && `#${parsed.projectName}`, parsed.rrule && '반복'].filter(Boolean).join(' · ')}
            {!noAuto && <span className="font-normal text-ink-2">→ 제목 “{parsed.title}”</span>}
            <button type="button" className="ml-1 underline" onClick={() => setNoAuto(!noAuto)}>{noAuto ? '다시 켜기' : '끄기'}</button>
          </div>
        )}
        {(f.description || f.checklist?.length || f.fileNames?.length) && (
          <div className="space-y-2 rounded-input border border-amber-200 bg-amber-50/50 p-2.5" data-testid="quick-filled">
            {f.fileNames?.length > 0 && <p className="text-xs text-ink-2">📎 {f.fileNames.join(', ')} — 저장하면 업무에 첨부</p>}
            <Field label="설명·메모"><textarea className={cx(inputCls, 'min-h-[80px] text-sm')} value={f.description ?? ''} onChange={(e) => set('description')(e.target.value)} /></Field>
            {f.checklist?.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-ink-2">체크리스트 {f.checklist.length}개</p>
                <ul className="space-y-1">{f.checklist.map((c: string, k: number) => (
                  <li key={k} className="flex items-center gap-1.5"><input className={cx(inputCls, 'h-8 py-1 text-sm')} value={c} onChange={(e) => set('checklist')(f.checklist.map((y: string, j: number) => (j === k ? e.target.value : y)))} aria-label={`체크리스트 ${k + 1}`} />
                    <button type="button" className="px-1 text-ink-3" onClick={() => set('checklist')(f.checklist.filter((_: string, j: number) => j !== k))} aria-label={`체크리스트 ${k + 1} 빼기`}>×</button></li>))}</ul>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 rounded-input bg-slate-50 px-2 py-1.5" data-testid="quick-chips">
          <select className="min-h-8 rounded-md border border-line bg-white px-2 text-xs" value={f.priority ?? 'normal'} onChange={(e) => set('priority')(e.target.value)} aria-label="우선순위">
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {/* 검수 20: 마감·담당·지시도 같은 칩 줄에 */}
          <label className="inline-flex items-center gap-1 text-[11px] text-ink-3">마감<input type="date" className="min-h-8 rounded-md border border-line bg-white px-1.5 text-xs text-ink" value={f.dueDate ?? ''} onChange={(e) => set('dueDate')(e.target.value)} aria-label="마감일" /></label>
          {f.dueDate && <TimePick className="min-h-8 rounded-md border border-line bg-white px-1.5 text-xs" value={f.dueTime} onChange={(v) => set('dueTime')(v ?? '')} ariaLabel="마감 시각" />}
          <label className="inline-flex items-center gap-1 text-[11px] text-ink-3">담당<UserSelect className="min-h-8 max-w-[8.5rem] rounded-md border border-line bg-white px-1.5 text-xs text-ink" ariaLabel="담당자" value={f.assigneeId} onChange={set('assigneeId')} /></label>
          <label className="inline-flex items-center gap-1 text-[11px] text-ink-3">지시<UserSelect className="min-h-8 max-w-[8.5rem] rounded-md border border-line bg-white px-1.5 text-xs text-ink" ariaLabel="지시자" placeholder="지시자 선택" value={f.requestedById} onChange={set('requestedById')} /></label>
          <RepeatChip value={f.rrule ?? null} anchorDate={f.dueDate || null} onChange={set('rrule')} />
          <BellChip value={f.remind ?? null} onChange={set('remind')} />
        </div>
        {/* V6 13번: 다른 사람도 같은 업무를 각자 1건씩 (담당자별 묶음) */}
        {!defaults?.parentId && !tpl && (
          <div data-testid="multi-assignee">
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => set('multi')(!f.multi)} aria-expanded={!!f.multi}>{f.multi ? '− 여러 명 선택 닫기' : '+ 여러 명에게 각자 1건씩'}</button>
            {f.multi && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 rounded-input bg-slate-50 p-2">
                <div className="flex w-full flex-wrap gap-3 pb-1 text-xs" role="radiogroup" aria-label="여러 명 방식">
                  <label className="flex items-center gap-1"><input type="radio" name="multiMode" checked={f.multiMode !== 'together'} onChange={() => set('multiMode')('each')} />각자 1건씩</label>
                  <label className="flex items-center gap-1"><input type="radio" name="multiMode" checked={f.multiMode === 'together'} onChange={() => set('multiMode')('together')} data-testid="multi-together" />한 업무로 함께(위 담당자 = 주 담당, 고른 사람 = 협업자)</label>
                </div>
                {dir.users.map((x) => {
                  const on = (f.more ?? []).includes(x.id) || x.id === f.assigneeId;
                  return <button key={x.id} type="button" aria-pressed={on} disabled={x.id === f.assigneeId}
                    onClick={() => set('more')(on ? (f.more ?? []).filter((y: string) => y !== x.id) : [...(f.more ?? []), x.id])}
                    className={cx('rounded-full border px-2.5 py-1 text-xs font-medium', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')}>{x.name}</button>;
                })}
                <button type="button" className="rounded-full px-2 py-1 text-xs text-ink-2 underline" onClick={() => set('more')(dir.users.filter((x) => x.id !== f.assigneeId).map((x) => x.id))}>전체 선택</button>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5" aria-label="마감 빠른 선택">
          {quickDues().map(([l, d]) => (
            <button key={l} type="button" onClick={() => set('dueDate')(d)}
              className={cx('rounded-full border px-2.5 py-1 text-xs font-medium', f.dueDate === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2 hover:border-slate-300')}>{l}</button>
          ))}
          {f.dueDate && <button type="button" onClick={() => set('dueDate')('')} className="rounded-full px-2 py-1 text-xs text-ink-3 hover:text-ink-2">지우기</button>}
        </div>
        {/* V14 27번: 상세와 같은 기준 — 프로젝트·팀은 "더 입력"에 접어 둠(기본 닫힘) */}
        {!defaults?.parentId && (
          <details className="rounded-input border border-line px-2.5 py-1.5 text-sm" data-testid="quick-more" open={!!f.projectId && !defaults?.projectId ? true : undefined}>
            <summary className="cursor-pointer text-xs font-medium text-ink-2">더 입력 (프로젝트·팀){f.projectId ? ` · ${projects.data?.projects.find((p) => p.id === f.projectId)?.name ?? ''}` : ''}</summary>
            <div className="mt-2 space-y-2">
        {(
          <Field label="프로젝트">
            <select className={inputCls} value={f.projectId ?? ''} onChange={(e) => set('projectId')(e.target.value)}>
              <option value="">없음</option>
              {projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        {/* V14 8번: 팀에 배정 — 팀원 모두에게 각각 / 팀장이 담당자 지정 */}
        {!tpl && (teams.data?.teams.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="team-assign">
            <select className="h-8 rounded-input border border-line bg-white px-2 text-xs" value={f.teamId ?? ''} onChange={(e) => set('teamId')(e.target.value || null)} aria-label="팀">
              <option value="">팀 없음</option>{teams.data!.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {f.teamId && <>
              <label className="flex items-center gap-1"><input type="radio" name="teamMode" checked={f.teamMode === 'tag'} onChange={() => set('teamMode')('tag')} />소속 팀만(담당 그대로)</label>
              <label className="flex items-center gap-1"><input type="radio" name="teamMode" checked={(f.teamMode ?? 'lead') === 'lead'} onChange={() => set('teamMode')('lead')} />팀에 배정(팀장이 담당 지정)</label>
              <label className="flex items-center gap-1"><input type="radio" name="teamMode" checked={f.teamMode === 'each'} onChange={() => set('teamMode')('each')} />팀원 모두에게 각각</label>
            </>}
          </div>
        )}
            </div>
          </details>
        )}
        {day && f.assigneeId !== user.id && (
          <p className={day.freeMinutes < 60 || day.away || day.holiday ? 'rounded-input bg-amber-50 p-2 text-xs text-amber-900' : 'rounded-input bg-slate-50 p-2 text-xs text-ink-2'} data-testid="assign-availability">
            {who ?? '담당자'} · {f.dueDate} {day.holiday ? `공휴일(${day.holiday})` : day.away ? '휴가·출장' : !day.workday ? '쉬는 날' : `회의 ${fmtMinutes(day.meetingMinutes) || '없음'}, 남은 가용 ${fmtMinutes(day.freeMinutes) || '0분'}`}
          </p>
        )}
        {/* 하단 고정 저장·취소 (휴대폰 키보드 위에서도 보이게), Ctrl+Enter 저장 */}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center justify-between gap-2 border-t border-line bg-white px-5 py-3 pb-[calc(var(--sab)+12px)] sm:pb-3">
          {defaults?.parentId ? <span className="text-xs text-ink-3">설명·하위 업무·첨부는 만든 뒤 상세에서</span> : (
            <label className="inline-flex items-center gap-1.5 text-xs text-ink-2"><input type="checkbox" className="size-4 accent-brand-600" checked={keep}
              onChange={(e) => { setKeep(e.target.checked); try { localStorage.setItem('wos_quick_keep', e.target.checked ? '1' : '0'); } catch {} }} />계속 추가 (등록 후 창 유지)</label>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>취소</Button>
            <Button type="submit" disabled={busy} className="min-w-[88px]" title="Ctrl+Enter">{busy ? '저장 중…' : count > 1 ? `${count}명에게 각각 만들기` : '저장'}</Button>
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
