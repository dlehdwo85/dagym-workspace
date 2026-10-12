'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import {
  BadgeCheck, Building2, CalendarClock, CalendarDays, Camera, Check, ChevronRight, CircleCheck, Clock, Copy, CornerDownRight, Flag, FolderKanban, Hash,
  Hourglass, LayoutTemplate, Link2, ListFilter, Maximize2, Merge, MoreHorizontal, Pause, Percent, Play, Plus, Repeat, RotateCcw, Rows3, Shapes, ShieldCheck,
  Stamp, Tag, Timer, Trash2, Type, UserRound, Users, X, CalendarRange, AlertTriangle, type LucideIcon,
} from 'lucide-react';
import { Avatar, Button, DueChip, ErrorBox, Field, IconButton, Modal, Skeleton, StatusBadge, cx, fmtDateTime, fmtMinutes, fmtTimeRange, inputCls, toast, todayStr } from '@/components/ui';
import { BrandSelect, MultiUserSelect, RecurSelect, UnitSelect, UserSelect } from '@/components/pickers';
import { Attachments } from '@/components/Attachments';
import { QuickAddTask } from '@/components/QuickAddTask';
import { PRIORITY_LABEL, STATUS_LABEL, STATUSES } from '@/lib/types';
import { encodeMentions } from '@/lib/mentions';

const ACTION_LABEL: Record<string, string> = {
  created: '업무 생성', updated: '수정', review_requested: '검토 요청', approved: '최종 완료 확인', review_rejected: '보완 요청', completed: '완료',
  reopened: '다시 열기', deleted: '삭제', comment_edited: '댓글 수정', comment_deleted: '댓글 삭제', checklist_added: '체크리스트 추가',
  checklist_done: '체크리스트 완료', checklist_undone: '체크리스트 해제', checklist_removed: '체크리스트 삭제', checklist_edited: '체크리스트 수정',
  file_attached: '파일 첨부', link_attached: '문서 링크 연결', attachment_removed: '첨부 삭제', recurring_created: '반복 회차 생성',
};
const FIELD_LABEL: Record<string, string> = {
  title: '제목', description: '설명', assigneeId: '담당자', priority: '우선순위', startDate: '시작일', dueDate: '마감일', dueTime: '마감 시각', status: '상태',
  tags: '태그', projectId: '프로젝트', sectionId: '섹션', brandId: '브랜드', orgUnitId: '소속', collaborators: '협업자', approvalRequired: '검토 필요', recurrenceRule: '반복', dependsOn: '선행 업무',
};

/** 업무 상세. 전체 화면(/tasks/:id)과 목록 옆 오른쪽 패널(inPanel) 공용 */
export function TaskDetail({ id, onClose, inPanel }: { id: string; onClose?: () => void; inPanel?: boolean }) {
  const router = useRouter();
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<any>(`/api/tasks/${id}`);
  const projects = useApi<{ projects: any[] }>('/api/projects');
  const [comment, setComment] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]); // 입력창에는 @이름만, 전송 때 내부 표기로 변환
  const mentionable = useApi<{ users: { id: string; name: string; title: string | null }[] }>(`/api/tasks/${id}/mentionable`);
  const [sub, setSub] = useState(false);
  const [desc, setDesc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const lines = useApi<{ lines: any[] }>('/api/approval-lines');
  const events = useApi<{ events: any[] }>(`/api/tasks/${id}/events`);

  // B-2: 담당자가 업무를 열면 '확인'으로 처리 → 내 업무의 '새로 배정됨'에서 빠진다
  useEffect(() => {
    const t = data?.task;
    if (t && t.assignee_id === user.id && !t.assignee_ack_at) {
      api(`/api/tasks/${id}/ack`, { body: {} }).then(() => broadcastRefresh()).catch(() => {});
    }
  }, [data?.task?.id, data?.task?.assignee_ack_at]); // eslint-disable-line react-hooks/exhaustive-deps
  // B-17 단축키: S 하위 업무 추가, C 댓글 쓰기
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable || document.querySelector('[role=dialog]')) return;
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); setSub(true); }
      else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); const c = document.querySelector<HTMLTextAreaElement>('[data-testid="comment-input"]'); c?.focus(); c?.scrollIntoView({ block: 'center' }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const sections = useApi<{ sections: { id: string; name: string }[] }>(data?.task?.project_id ? `/api/projects/${data.task.project_id}/sections` : null);

  useEffect(() => {
    if (!data) return;
    const h = location.hash;
    if (h) setTimeout(() => document.querySelector(h)?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [data]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <div className="p-5"><Skeleton rows={8} /></div>;
  if (!data) return null;
  const t = data.task;
  const perms = data.perms;
  const userName = (uid: string | null) => dir.users.find((u) => u.id === uid)?.name ?? '';

  async function patch(body: Record<string, unknown>, okMsg?: string) {
    try {
      const r = await api(`/api/tasks/${id}`, { method: 'PATCH', body: { ...body, version: t.version } });
      if (okMsg) toast.ok(okMsg);
      if (r.spawned) toast.info('반복 업무의 다음 회차가 생성되었습니다');
      reload(); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); if (e.status === 409) reload(); }
  }
  async function sendComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    const body = encodeMentions(comment, picked);
    try {
      await api(`/api/tasks/${id}/comments`, { body: { body }, queueOffline: '댓글' });
      setComment(''); setPicked([]); reload();
    } catch (e: any) { if (e.code === 'queued') { toast.info(e.message); setComment(''); setPicked([]); } else toast.error(e.message); }
  }
  async function reject() {
    const note = prompt('보완 요청 내용을 입력하세요');
    if (!note) return;
    await patch({ status: 'in_progress', reviewNote: note }, '보완을 요청했습니다');
    await api(`/api/tasks/${id}/comments`, { body: { body: `[보완 요청] ${note}` } }).catch(() => {});
    reload();
  }
  async function del() {
    if (!confirm('이 업무와 하위 업무를 삭제할까요?')) return;
    try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); toast.ok('삭제했습니다'); broadcastRefresh(); if (onClose) onClose(); else router.push('/tasks'); } catch (e: any) { toast.error(e.message); }
  }
  async function saveTemplate() {
    const name = prompt('템플릿 이름', t.title);
    if (!name) return;
    try { await api('/api/templates', { body: { name, fromTaskId: id, orgUnitId: t.org_unit_id } }); toast.ok('템플릿으로 저장했습니다'); } catch (e: any) { toast.error(e.message); }
  }

  const photoNeed = Number(t.photo_required ?? 0);
  const photoHave = Number(t.photo_count ?? 0);
  const photoShort = photoNeed > 0 && photoHave < photoNeed;
  const lastRound = data.approvals?.length ? data.approvals[0].round : null;
  const roundSteps = (data.approvals ?? []).filter((a: any) => a.round === lastRound).sort((a: any, b: any) => a.step - b.step);
  const checkDone = data.checklist.filter((c: any) => c.done).length;

  async function decide(decision: 'approve' | 'reject') {
    let comment: string | undefined;
    if (decision === 'reject') { comment = prompt('반려 사유를 입력하세요') ?? undefined; if (!comment?.trim()) return; }
    try {
      const r = await api(`/api/tasks/${id}/approval`, { body: { decision, comment } });
      toast.ok(decision === 'reject' ? '반려했습니다' : r.status === 'done' ? '최종 승인으로 완료되었습니다' : '승인했습니다 — 다음 결재자에게 넘어갑니다');
      reload(); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function followUp() {
    try { const r = await api(`/api/tasks/${id}/follow-up`, { body: {} }); toast.ok('후속 업무를 만들었습니다', { label: '열기', run: () => router.push(`/tasks/${r.id}`) }); broadcastRefresh(); } catch (e: any) { toast.error(e.message); }
  }
  async function duplicate() {
    try { const r = await api(`/api/tasks/${id}/duplicate`, { body: { withSubtasks: true } }); toast.ok('복제했습니다', { label: '열기', run: () => router.push(`/tasks/${r.id}`) }); broadcastRefresh(); } catch (e: any) { toast.error(e.message); }
  }
  async function setField(fid: string, value: unknown) {
    try { await api(`/api/tasks/${id}/fields/${fid}`, { method: 'PUT', body: { value } }); reload(); broadcastRefresh(); } catch (e: any) { toast.error(e.message); }
  }

  const primary = t.status === 'done' ? null
    : t.status === 'review' ? (data.approvals?.length && t.approval_line_id ? null : perms.approve ? { label: '최종 완료 확인', run: () => patch({ status: 'done' }, '최종 완료 확인했습니다') } : null)
    : t.approval_line_id ? { label: '결재 올리기', run: () => patch({ status: 'review' }, '결재를 요청했습니다') }
    : t.approval_required && !perms.approve ? { label: '완료 → 검토 요청', run: () => patch({ status: 'review' }, '검토를 요청했습니다') }
    : { label: '완료', run: () => patch({ status: 'done' }, '완료 처리했습니다') };

  return (
    <div className={cx(!inPanel && 'mx-auto max-w-4xl')} data-testid={inPanel ? 'task-panel-body' : 'task-page'}>
      {/* 상단 도구 막대 */}
      <div className={cx('sticky top-0 z-20 flex items-center gap-1.5 border-b border-line bg-white/95 px-4 py-2 backdrop-blur', !inPanel && 'rounded-t-card border')}>
        {primary && (
          <Button size="sm" variant={t.status === 'review' ? 'primary' : 'secondary'} onClick={primary.run} disabled={photoShort && primary.label !== '최종 완료 확인'}
            title={photoShort ? `증빙 사진 ${photoNeed}장이 필요합니다 (현재 ${photoHave}장)` : undefined}
            className={cx(t.status !== 'review' && 'hover:border-emerald-500 hover:text-emerald-700')}>
            <CircleCheck />{primary.label}
          </Button>
        )}
        {t.status === 'done' && <span className="inline-flex h-8 items-center gap-1.5 rounded-input bg-emerald-50 px-2.5 text-sm font-semibold text-emerald-700"><CircleCheck className="size-4" />완료됨</span>}
        <span className="flex-1" />
        <IconButton label="링크 복사" onClick={() => { navigator.clipboard?.writeText(location.origin + `/tasks/${id}`); toast.ok('링크를 복사했습니다'); }}><Link2 /></IconButton>
        {inPanel && <IconButton label="전체 화면" onClick={() => { location.href = `/tasks/${id}`; }}><Maximize2 /></IconButton>}
        <div className="relative">
          <IconButton label="더보기" onClick={() => setMenu(!menu)} aria-expanded={menu}><MoreHorizontal /></IconButton>
          {menu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
              <div role="menu" className="absolute right-0 z-40 mt-1 w-56 animate-fade-up rounded-card border border-line bg-white p-1 shadow-pop" onClick={() => setMenu(false)}>
                <MenuItem icon={CornerDownRight} onClick={followUp}>후속 업무 만들기</MenuItem>
                <MenuItem icon={Copy} onClick={duplicate}>복제</MenuItem>
                <MenuItem icon={Merge} onClick={() => setMergeOpen(true)}>중복 업무로 통합</MenuItem>
                <MenuItem icon={Clock} onClick={() => setBlockOpen(true)}>실행 시간 배정</MenuItem>
                {perms.approve && <MenuItem icon={LayoutTemplate} onClick={saveTemplate}>템플릿으로 저장</MenuItem>}
                {perms.delete && <><div className="my-1 border-t border-line" /><MenuItem icon={Trash2} danger onClick={del}>삭제</MenuItem></>}
              </div>
            </>
          )}
        </div>
        {inPanel && <IconButton label="패널 닫기" onClick={onClose}><X /></IconButton>}
      </div>

      <div className={cx('space-y-6 px-5 py-5', !inPanel && 'rounded-b-card border border-t-0 border-line bg-white')}>
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-ink-2">
            <Link href="/tasks" className="hover:underline">업무</Link>
            {t.project_name && <><ChevronRight className="size-3" /><Link href={`/projects/${t.project_id}`} className="inline-flex items-center gap-1 hover:underline"><span className="size-2 rounded-[3px]" style={{ background: t.project_color ?? '#999' }} />{t.project_name}</Link></>}
            {t.parent_id && <><ChevronRight className="size-3" /><Link href={`/tasks/${t.parent_id}`} className="hover:underline">상위: {t.parent_title}</Link></>}
          </div>
          {title === null ? (
            <h1 className={cx('-mx-1.5 rounded-input px-1.5 py-0.5 text-[22px] font-bold leading-snug tracking-tight', perms.edit && 'cursor-text hover:bg-slate-50', t.status === 'done' && 'text-ink-2')}
              onClick={() => perms.edit && setTitle(t.title)} data-testid="task-title">{t.title}</h1>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) patch({ title }); setTitle(null); }}>
              <input autoFocus className={cx(inputCls, 'text-lg font-bold')} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setTitle(null)} aria-label="제목" />
              <Button size="sm">저장</Button>
            </form>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="task-actions">
            <StatusBadge status={t.status} />
            {t.status !== 'done' && t.status !== 'review' && t.approval_required && !perms.approve && !t.approval_line_id && primary?.label !== '완료 → 검토 요청' && (
              <Button size="sm" onClick={() => patch({ status: 'review' }, '검토를 요청했습니다')}>완료 → 검토 요청</Button>
            )}
            {t.status === 'review' && perms.approve && !t.approval_line_id && <Button size="sm" variant="secondary" onClick={reject}>보완 요청</Button>}
            {t.status === 'todo' && <Button size="sm" variant="ghost" onClick={() => patch({ status: 'in_progress' })}><Play />시작</Button>}
            {t.status !== 'on_hold' && t.status !== 'done' && <Button size="sm" variant="ghost" onClick={() => patch({ status: 'on_hold' })}><Pause />보류</Button>}
            {(t.status === 'on_hold' || t.status === 'done') && <Button size="sm" variant="ghost" onClick={() => patch({ status: 'in_progress' })}><RotateCcw />다시 진행</Button>}
            <select className="h-8 rounded-input border border-line bg-white px-2 text-sm text-ink-2" value={t.status} onChange={(e) => patch({ status: e.target.value })} aria-label="상태 직접 변경">
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          {t.status === 'review' && !roundSteps.length && <p className="mt-3 flex items-center gap-2 rounded-input bg-amber-50 px-3 py-2 text-sm text-amber-900"><Hourglass className="size-4 shrink-0" />검토 요청 중 — {fmtDateTime(t.review_requested_at)} · 관리자의 최종 확인을 기다립니다.</p>}
          {t.status === 'done' && t.approved_by_name && <p className="mt-3 flex items-center gap-2 rounded-input bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><BadgeCheck className="size-4 shrink-0" />{t.approved_by_name}님이 {fmtDateTime(t.approved_at)}에 최종 완료를 확인했습니다.</p>}
          {photoShort && t.status !== 'done' && <p className="mt-3 flex items-center gap-2 rounded-input bg-sky-50 px-3 py-2 text-sm text-sky-900"><Camera className="size-4 shrink-0" />완료하려면 증빙 사진 {photoNeed}장이 필요합니다 (현재 {photoHave}장). 아래 <b>사진 촬영</b>으로 올려 주세요.</p>}
        </div>

        {/* B-9 결재 단계 */}
        {roundSteps.length > 0 && (
          <section className="rounded-card border border-line p-4" data-testid="approval-steps">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Stamp className="size-4 text-amber-600" />결재 {lastRound && lastRound > 1 && <span className="text-xs font-normal text-ink-2">{lastRound}차</span>}</h2>
            <ol className="flex flex-wrap items-start gap-2">
              {roundSteps.map((a: any, i: number) => (
                <li key={a.id} className="flex items-center gap-2">
                  <div className={cx('min-w-[120px] rounded-input border px-3 py-2 text-xs',
                    a.status === 'approved' ? 'border-emerald-200 bg-emerald-50' : a.status === 'rejected' ? 'border-red-200 bg-red-50' : a.status === 'pending' ? 'border-amber-300 bg-amber-50' : 'border-line bg-slate-50')}>
                    <div className="font-semibold text-ink">{i + 1}. {a.label}</div>
                    <div className="mt-0.5 text-ink-2">{a.status === 'approved' ? `승인 · ${a.decided_by_name}` : a.status === 'rejected' ? `반려 · ${a.decided_by_name}` : a.status === 'pending' ? '결재 대기' : '대기'}</div>
                    {a.comment && <div className="mt-1 text-red-700">“{a.comment}”</div>}
                  </div>
                  {i < roundSteps.length - 1 && <ChevronRight className="size-4 text-ink-3" />}
                </li>
              ))}
            </ol>
            {perms.decide && (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => decide('approve')}><Check />승인</Button>
                <Button size="sm" variant="secondary" className="text-red-600" onClick={() => decide('reject')}>반려</Button>
              </div>
            )}
          </section>
        )}

        {/* 속성 */}
        <section className={cx('grid grid-cols-1 gap-x-6 gap-y-0.5', !inPanel && 'lg:grid-cols-2')} aria-label="업무 속성">
          <Prop icon={UserRound} label="담당자">
            <span className="flex items-center gap-1.5"><Avatar id={t.assignee_id} name={t.assignee_name} size={22} /><UserSelect className={ghostCls} value={t.assignee_id} onChange={(v) => patch({ assigneeId: v })} /></span>
          </Prop>
          <Prop icon={CalendarDays} label="마감일">
            <span className="flex flex-wrap items-center gap-1">
              <input type="date" className={cx(ghostCls, '!w-[140px]', t.status !== 'done' && t.due_date && t.due_date < todayStr() && 'font-semibold text-red-600')} value={t.due_date ?? ''} onChange={(e) => patch({ dueDate: e.target.value || null })} data-testid="detail-due" />
              <input type="time" className={cx(ghostCls, '!w-[104px]')} value={t.due_time ?? ''} onChange={(e) => patch({ dueTime: e.target.value || null })} aria-label="마감 시각" />
            </span>
          </Prop>
          {t.task_type !== 'milestone' && <Prop icon={CalendarClock} label="시작일"><input type="date" className={cx(ghostCls, '!w-[140px]')} value={t.start_date ?? ''} onChange={(e) => patch({ startDate: e.target.value || null })} /></Prop>}
          <Prop icon={Flag} label="우선순위">
            <select className={ghostCls} value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Prop>
          <Prop icon={Timer} label="예상 소요">
            <span className="flex w-full flex-wrap items-center gap-2">
              <select className={cx(ghostCls, '!w-[120px]')} value={t.estimate_minutes ?? ''} onChange={(e) => patch({ estimateMinutes: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">미정</option>{[15, 30, 60, 90, 120, 180, 240, 360, 480, 960, 1440].map((m) => <option key={m} value={m}>{fmtMinutes(m)}</option>)}
                {t.estimate_minutes && ![15, 30, 60, 90, 120, 180, 240, 360, 480, 960, 1440].includes(t.estimate_minutes) && <option value={t.estimate_minutes}>{fmtMinutes(t.estimate_minutes)}</option>}
              </select>
              {t.estimate_minutes > 0 && <span className="text-xs text-ink-2 tabular-nums" data-testid="estimate-progress">{fmtMinutes(t.scheduled_minutes ?? 0) || '0분'} 배정</span>}
              {data.risk?.risk && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700" data-testid="risk-badge" title={`남은 예상 ${fmtMinutes(data.risk.remaining)} · 마감까지 가용 ${fmtMinutes(data.risk.available ?? 0) || '0분'}`}><AlertTriangle className="size-3.5" />마감 위험</span>}
            </span>
          </Prop>
          <Prop icon={Shapes} label="업무 유형">
            <select className={ghostCls} value={t.task_type ?? 'normal'} onChange={(e) => patch({ taskType: e.target.value })}>
              {Object.entries(TASK_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Prop>
          <Prop icon={Building2} label="소속 (현장·부서)"><UnitSelect className={ghostCls} value={t.org_unit_id} onChange={(v) => patch({ orgUnitId: v })} /></Prop>
          <Prop icon={Tag} label="브랜드"><BrandSelect className={ghostCls} value={t.brand_id} onChange={(v) => patch({ brandId: v })} /></Prop>
          <Prop icon={FolderKanban} label="프로젝트">
            <select className={ghostCls} value={t.project_id ?? ''} onChange={(e) => patch({ projectId: e.target.value || null })}>
              <option value="">없음</option>{projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Prop>
          {t.project_id && (sections.data?.sections.length ?? 0) > 0 && (
            <Prop icon={Rows3} label="섹션">
              <select className={ghostCls} value={t.section_id ?? ''} onChange={(e) => patch({ sectionId: e.target.value || null })}>
                <option value="">섹션 없음</option>{sections.data!.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Prop>
          )}
          <Prop icon={Repeat} label="반복" asDiv><div className="w-full [&_select]:h-8 [&_select]:border-transparent [&_select]:bg-transparent hover:[&_select]:border-line"><RecurSelect value={t.recurrence_rule} onChange={(v) => patch({ recurrenceRule: v })} anchorDate={t.due_date} /></div></Prop>
          <Prop icon={Hash} label="태그">
            <input className={ghostCls} placeholder="쉼표로 구분" defaultValue={t.tags.join(', ')} onBlur={(e) => { const v = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); if (v.join() !== t.tags.join()) patch({ tags: v }); }} />
          </Prop>
          <Prop icon={Stamp} label="결재선">
            <select className={ghostCls} value={t.approval_line_id ?? ''} disabled={!perms.approve || t.status === 'review'} onChange={(e) => patch({ approvalLineId: e.target.value || null })}>
              <option value="">없음 (관리자 확인 방식)</option>{lines.data?.lines.filter((l: any) => l.active || l.id === t.approval_line_id).map((l: any) => <option key={l.id} value={l.id}>{l.name} ({l.steps.length}단계)</option>)}
            </select>
          </Prop>
          <Prop icon={Camera} label="증빙 사진">
            <span className="flex items-center gap-2">
              <select className={cx(ghostCls, '!w-[120px]')} value={photoNeed} disabled={!perms.approve} onChange={(e) => patch({ photoRequired: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n ? `${n}장 필수` : '필요 없음'}</option>)}
              </select>
              {photoNeed > 0 && <span className={cx('text-xs font-semibold tabular-nums', photoShort ? 'text-amber-700' : 'text-emerald-600')}>{photoHave}/{photoNeed}</span>}
            </span>
          </Prop>
          <Prop icon={ShieldCheck} label="완료 확인" asDiv>
            <label className="flex h-8 items-center gap-2 px-2 text-sm">
              <input type="checkbox" className="size-4 accent-brand-600" checked={t.approval_required} disabled={!perms.approve} onChange={(e) => patch({ approvalRequired: e.target.checked })} />
              관리자 최종 확인 필요 {!perms.approve && <span className="text-xs text-ink-3">(관리자만 변경)</span>}
            </label>
          </Prop>
          {(data.fields ?? []).map((f: any) => <CustomField key={f.id} f={f} value={t.fields?.[f.id]} onSave={(v) => setField(f.id, v)} />)}
          <Prop icon={Users} label="협업자" asDiv className="lg:col-span-2"><MultiUserSelect value={data.collaborators.map((c: any) => c.id)} onChange={(v) => patch({ collaboratorIds: v })} /></Prop>
        </section>

        <section>
          <h2 className="mb-1.5 text-sm font-semibold">설명</h2>
          {desc === null ? (
            <div className="-mx-2 min-h-[56px] cursor-text whitespace-pre-wrap rounded-input border border-transparent px-2 py-1.5 text-sm leading-relaxed hover:border-line" onClick={() => setDesc(t.description)}>
              {t.description || <span className="text-ink-3">업무 내용, 기준, 참고 사항을 적어 주세요</span>}
            </div>
          ) : (
            <div>
              <textarea autoFocus rows={6} className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="설명" />
              <div className="mt-1.5 flex gap-1"><Button size="sm" onClick={() => { patch({ description: desc }); setDesc(null); }}>저장</Button><Button size="sm" variant="ghost" onClick={() => setDesc(null)}>취소</Button></div>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">체크리스트 {data.checklist.length > 0 && <span className="text-xs font-medium text-ink-2 tabular-nums">{checkDone}/{data.checklist.length}</span>}</h2>
          {data.checklist.length > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(checkDone / data.checklist.length) * 100}%` }} /></div>}
          <ul className="space-y-0.5" data-testid="checklist">
            {data.checklist.map((c: any) => (
              <li key={c.id} className="group flex items-center gap-2.5 rounded-input px-1 py-1 text-sm hover:bg-slate-50">
                <input type="checkbox" className="size-4 accent-emerald-600" checked={c.done} onChange={async (e) => { await api(`/api/checklist/${c.id}`, { method: 'PATCH', body: { done: e.target.checked } }).catch((er) => toast.error(er.message)); reload(); }} aria-label={c.text} />
                <span className={cx('flex-1', c.done && 'text-ink-3 line-through')}>{c.text}</span>
                <button className="rounded p-0.5 text-ink-3 opacity-0 hover:text-red-600 group-hover:opacity-100 focus:opacity-100" onClick={async () => { await api(`/api/checklist/${c.id}`, { method: 'DELETE' }); reload(); }} aria-label="항목 삭제"><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
          <form className="mt-1.5 flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; await api(`/api/tasks/${id}/checklist`, { body: { text: newItem } }).catch((er) => toast.error(er.message)); setNewItem(''); reload(); }}>
            <input className={cx(inputCls, 'h-8')} placeholder="+ 항목 추가" value={newItem} onChange={(e) => setNewItem(e.target.value)} aria-label="체크리스트 항목 추가" />
            <Button size="sm" variant="secondary">추가</Button>
          </form>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between"><h2 className="text-sm font-semibold">하위 업무 {data.subtasks.length > 0 && <span className="text-xs font-medium text-ink-2">{data.subtasks.filter((s: any) => s.status === 'done').length}/{data.subtasks.length}</span>}</h2><Button size="sm" variant="ghost" onClick={() => setSub(true)}><Plus />추가</Button></div>
          <ul className="divide-y divide-line rounded-input border border-line">
            {data.subtasks.map((s: any) => (
              <li key={s.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                <StatusBadge status={s.status} />
                <Link href={`/tasks/${s.id}`} className="flex-1 truncate hover:underline">{s.title}</Link>
                <DueChip due={s.due_date} status={s.status} />
                <Avatar id={s.assignee_id} name={s.assignee_name} size={22} />
              </li>
            ))}
            {!data.subtasks.length && <li className="px-3 py-2.5 text-xs text-ink-3">하위 업무가 없습니다</li>}
          </ul>
          <div className="mt-4 mb-1.5 flex items-center justify-between"><h2 className="text-sm font-semibold">선행 업무</h2><Button size="sm" variant="ghost" onClick={() => setDepOpen(true)}>편집</Button></div>
          <ul className="space-y-1 text-sm">
            {data.dependencies.map((d: any) => (
              <li key={d.id} className="flex items-center gap-2"><StatusBadge status={d.status} /><Link className="hover:underline" href={`/tasks/${d.id}`}>{d.title}</Link></li>
            ))}
            {!data.dependencies.length && <li className="text-xs text-ink-3">없음 — 선행 업무가 끝나야 완료할 수 있게 하려면 추가하세요</li>}
          </ul>
        </section>

        <section data-testid="linked-events">
          <div className="mb-1.5 flex items-center justify-between"><h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarRange className="size-4 text-ink-3" />연결 일정 {(events.data?.events.length ?? 0) > 0 && <span className="text-xs font-medium text-ink-2">{events.data!.events.length}</span>}</h2>
            <Button size="sm" variant="ghost" onClick={() => setBlockOpen(true)}><Timer />실행 시간 배정</Button></div>
          <ul className="space-y-1">
            {events.data?.events.map((e: any) => (
              <li key={e.id}>
                <Link href={`/calendar?event=${e.id}`} className="flex items-center gap-2.5 rounded-input border border-line px-3 py-2 text-sm hover:bg-slate-50">
                  <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: e.color }} />
                  {e.kind === 'task_block' ? <Timer className="size-4 shrink-0 text-ink-2" aria-label="업무 시간" /> : <CalendarDays className="size-4 shrink-0 text-ink-2" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{e.title.replace(/^(\[(업무|업무 시간)\]\s*)+/, '')}</span>
                  <span className="shrink-0 text-xs text-ink-2 tabular-nums">{fmtTimeRange(e.occurrence_start ?? e.start_at, e.occurrence_start ? new Date(new Date(e.occurrence_start).getTime() + (new Date(e.end_at).getTime() - new Date(e.start_at).getTime())) : e.end_at, { allDay: e.all_day })}{e.rrule && !e.occurrence_start ? ' · 반복' : ''}</span>
                </Link>
              </li>
            ))}
            {!events.data?.events.length && <li className="text-xs text-ink-3">연결된 일정이 없습니다 — 일정(회의)에서 이 업무를 연결하거나 실행 시간을 배정하세요</li>}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">자료·첨부</h2>
          <Attachments items={data.attachments} taskId={id} canEdit={perms.approve} onChange={reload} meId={user.id} />
        </section>

        <section id="comments" className="border-t border-line pt-5">
          <div className="mb-3 flex items-center gap-4 text-sm font-semibold" role="tablist">
            <button role="tab" aria-selected={tab === 'comments'} onClick={() => setTab('comments')} className={cx('border-b-2 pb-1', tab === 'comments' ? 'border-brand-600 text-ink' : 'border-transparent text-ink-3')}>댓글 {data.comments.length > 0 && data.comments.length}</button>
            <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')} className={cx('border-b-2 pb-1', tab === 'history' ? 'border-brand-600 text-ink' : 'border-transparent text-ink-3')}>변경 이력</button>
          </div>
          <ul className={cx('space-y-4', tab !== 'comments' && 'hidden')} data-testid="comments">
            {data.comments.map((c: any) => (
              <li key={c.id} id={`c-${c.id}`} className="flex gap-2.5 text-sm">
                <Avatar id={c.author_id} name={c.author_name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-2"><b className="text-sm text-ink">{c.author_name}</b> · {fmtDateTime(c.created_at)}{c.edited_at && ' (수정됨)'}</div>
                  <div className="mt-0.5 whitespace-pre-wrap leading-relaxed">{renderMentions(c.body)}</div>
                </div>
              </li>
            ))}
            {!data.comments.length && <li className="text-xs text-ink-3">아직 댓글이 없습니다. 진행 상황이나 질문을 남겨 주세요.</li>}
          </ul>
          <ul className={cx('space-y-1.5 text-xs text-ink-2', tab !== 'history' && 'hidden')} data-testid="history">
            {data.history.map((h: any) => (
              <li key={h.id} className="flex gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-slate-300" />
                <span>
                  <span className="text-ink-3">{fmtDateTime(h.created_at)}</span> · <b className="text-ink">{h.actor_name ?? '시스템'}</b> · {ACTION_LABEL[h.action] ?? h.action}
                  {h.action !== 'created' && Object.entries(h.changes ?? {}).filter(([k, v]: any) => FIELD_LABEL[k] && v && typeof v === 'object' && 'to' in v).map(([k, v]: any) => (
                    <span key={k} className="ml-1">[{FIELD_LABEL[k]}: {fmtVal(k, v?.from, userName)} → {fmtVal(k, v?.to, userName)}]</span>
                  ))}
                  {h.changes?.note && <span className="ml-1">“{h.changes.note}”</span>}
                  {['file_attached', 'link_attached', 'attachment_removed', 'checklist_added', 'checklist_done', 'checklist_undone', 'checklist_removed'].includes(h.action) && <span className="ml-1">{h.changes?.name ?? h.changes?.title ?? h.changes?.text}</span>}
                </span>
              </li>
            ))}
            <li className="pt-1 text-ink-3">작성: {t.created_by_name} · {fmtDateTime(t.created_at)}</li>
          </ul>
          <form onSubmit={sendComment} className="mt-4 rounded-card border border-line bg-white focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20">
            <textarea className="block w-full resize-none rounded-t-card border-0 bg-transparent px-3 py-2.5 text-sm focus:outline-none focus:ring-0" rows={2} placeholder="댓글 입력 (사람을 언급하려면 아래 @ 멘션)" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="comment-input"
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} aria-label="댓글" />
            <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
              <select className="h-7 rounded-md border border-line bg-white px-1.5 text-xs" value="" onChange={(e) => {
                const u = mentionable.data?.users.find((x) => x.id === e.target.value);
                if (!u) return;
                setComment((c) => `${c}${c && !c.endsWith(' ') ? ' ' : ''}@${u.name} `);
                setPicked((p) => (p.some((x) => x.id === u.id) ? p : [...p, { id: u.id, name: u.name }]));
              }} aria-label="멘션할 사람">
                <option value="">@ 멘션</option>{mentionable.data?.users.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
              </select>
              <span className="hidden text-[11px] text-ink-3 sm:inline">이 업무를 볼 수 있는 사람만 · Ctrl+Enter 로 등록</span>
              <span className="flex-1" />
              <Button size="sm" type="submit" disabled={!comment.trim()}>등록</Button>
            </div>
          </form>
        </section>
      </div>

      <QuickAddTask open={sub} onClose={() => setSub(false)} defaults={{ parentId: id, dueDate: t.due_date ?? undefined, assigneeId: t.assignee_id ?? undefined }} onCreated={() => reload()} />
      <TimeBlockModal open={blockOpen} onClose={() => setBlockOpen(false)} task={t} onDone={() => { reload(); events.reload(); }} />
      <DepsModal open={depOpen} onClose={() => setDepOpen(false)} taskId={id} current={data.dependencies.map((d: any) => d.id)} onSave={(ids) => { patch({ dependsOn: ids }); setDepOpen(false); }} />
      <MergeModal open={mergeOpen} onClose={() => setMergeOpen(false)} taskId={id} title={t.title} onMerged={(into) => { broadcastRefresh(); if (onClose && inPanel) onClose(); router.push(`/tasks/${into}`); }} />
    </div>
  );
}

const TASK_TYPE_LABEL: Record<string, string> = { normal: '일반', milestone: '마일스톤', approval: '결재', inspection: '점검' };
const ghostCls = 'h-8 w-full min-w-0 rounded-input border border-transparent bg-transparent px-2 text-sm text-ink transition-colors hover:border-line hover:bg-white focus:border-accent-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-500/20 disabled:cursor-not-allowed disabled:text-ink-2 disabled:hover:border-transparent';

/** "라벨: 값" 한 줄. 라벨을 누르면 값으로 이동(접근성: label 로 연결) */
function Prop({ icon: Icon, label, children, asDiv, className }: { icon: LucideIcon; label: string; children: React.ReactNode; asDiv?: boolean; className?: string }) {
  const inner = (
    <>
      <span className="flex h-8 w-[92px] shrink-0 items-center gap-1.5 text-sm text-ink-2 sm:w-[120px] sm:gap-2"><Icon className="size-4 text-ink-3" />{label}</span>
      <span className="flex min-w-0 flex-1 items-center">{children}</span>
    </>
  );
  return asDiv
    ? <div className={cx('flex items-start gap-2 py-0.5', className)} role="group" aria-label={label}>{inner}</div>
    : <label className={cx('flex items-center gap-2 py-0.5', className)}>{inner}</label>;
}
function MenuItem({ icon: Icon, children, onClick, danger }: { icon: LucideIcon; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cx('flex w-full items-center gap-2.5 rounded-input px-2.5 py-2 text-left text-sm', danger ? 'text-red-600 hover:bg-red-50' : 'hover:bg-slate-50')}>
      <Icon className={cx('size-4', danger ? '' : 'text-ink-2')} />{children}
    </button>
  );
}
/** B-11 프로젝트 사용자 지정 필드 값 편집 */
function CustomField({ f, value, onSave }: { f: any; value: any; onSave: (v: any) => void }) {
  const { dir } = useSession();
  const icon = f.type === 'percent' ? Percent : f.type === 'number' ? Hash : f.type === 'date' ? CalendarDays : f.type === 'person' ? UserRound : f.type === 'select' ? ListFilter : Type;
  const opt = f.type === 'select' ? (f.options ?? []).find((o: any) => o.id === value) : null;
  return (
    <Prop icon={icon} label={f.name}>
      {f.type === 'select' ? (
        <span className="flex w-full items-center gap-1.5">
          {opt && <span className="size-2.5 shrink-0 rounded-full" style={{ background: opt.color }} />}
          <select className={ghostCls} value={value ?? ''} onChange={(e) => onSave(e.target.value || null)}>
            <option value="">—</option>{(f.options ?? []).map((o: any) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </span>
      ) : f.type === 'person' ? (
        <select className={ghostCls} value={value ?? ''} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">—</option>{dir.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      ) : f.type === 'date' ? (
        <input type="date" className={cx(ghostCls, '!w-[140px]')} value={value ?? ''} onChange={(e) => onSave(e.target.value || null)} />
      ) : (
        <span className="flex w-full items-center gap-1">
          <input className={ghostCls} type={f.type === 'text' ? 'text' : 'number'} step="any" defaultValue={value ?? ''} key={String(value ?? '')}
            min={f.type === 'percent' ? 0 : undefined} max={f.type === 'percent' ? 100 : undefined}
            onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === '' ? null : f.type === 'text' ? raw : Number(raw); if (v !== (value ?? null)) onSave(v); }} />
          {f.type === 'percent' && <span className="text-sm text-ink-2">%</span>}
        </span>
      )}
    </Prop>
  );
}

/** B-13 중복 업무 통합: 이 업무의 댓글·첨부·하위 업무를 대상 업무로 옮기고 이 업무는 닫는다 */
function MergeModal({ open, onClose, taskId, title, onMerged }: { open: boolean; onClose: () => void; taskId: string; title: string; onMerged: (into: string) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  useEffect(() => { if (open) { setQ(title.slice(0, 20)); setSel(''); } }, [open, title]);
  const list = useApi<{ tasks: any[] }>(open ? `/api/tasks?includeDone=1&limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}` : null, [q]);
  async function go() {
    try { await api(`/api/tasks/${taskId}/merge`, { body: { intoId: sel } }); toast.ok('통합했습니다'); onClose(); onMerged(sel); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="중복 업무로 통합">
      <p className="mb-3 rounded-input bg-slate-50 p-3 text-sm text-ink-2">이 업무의 댓글·첨부·하위 업무·협업자를 선택한 업무로 옮기고, 이 업무는 목록에서 사라집니다(이력은 남습니다).</p>
      <input className={inputCls} placeholder="통합할 업무 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="통합 대상 검색" />
      <ul className="mt-2 max-h-72 divide-y divide-line overflow-y-auto">
        {list.data?.tasks.filter((x) => x.id !== taskId).map((x) => (
          <li key={x.id}>
            <label className="flex cursor-pointer items-center gap-2.5 px-1 py-2 text-sm hover:bg-slate-50">
              <input type="radio" name="merge" checked={sel === x.id} onChange={() => setSel(x.id)} />
              <span className="flex-1 truncate">{x.title}</span><span className="text-xs text-ink-2">{x.org_unit_name}</span><StatusBadge status={x.status} />
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button disabled={!sel} onClick={go}><Merge />통합</Button></div>
    </Modal>
  );
}

function fmtVal(k: string, v: any, userName: (id: string | null) => string) {
  if (v === null || v === undefined || v === '') return '없음';
  if (k === 'assigneeId') return userName(v) || '알 수 없음';
  if (k === 'status') return STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v;
  if (k === 'priority') return PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? v;
  if (Array.isArray(v)) return k === 'collaborators' ? v.map(userName).join(', ') || '없음' : v.join(', ');
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  return String(v).slice(0, 40);
}

function renderMentions(body: string) {
  const parts = body.split(/(@\[[^\]]+\]\([0-9a-f-]{36}\))/g);
  return parts.map((p, i) => {
    const m = /^@\[([^\]]+)\]\(/.exec(p);
    return m ? <span key={i} className="rounded bg-brand-50 px-1 font-medium text-brand-700">@{m[1]}</span> : <span key={i}>{p}</span>;
  });
}

/**
 * 업무 실행 시간 배정 (S-3). 기본 캘린더: 담당자가 나면 내 개인 일정, 아니면 업무 소속 조직 캘린더(편집 가능할 때)에
 * 담당자를 참석자로 넣는다. 길이는 남은 예상 시간 기준, 그날 담당자의 회의·남은 가용 시간을 함께 보여 준다.
 */
function TimeBlockModal({ open, onClose, task, onDone }: { open: boolean; onClose: () => void; task: any; onDone: () => void }) {
  const { user } = useSession();
  const cals = useApi<{ calendars: any[] }>(open ? '/api/calendars' : null);
  const remaining = task.estimate_minutes ? Math.max(30, task.estimate_minutes - (task.scheduled_minutes ?? 0)) : 60;
  const endOf = (start: string, mins: number) => { const [h, m] = start.split(':').map(Number); const t = Math.min(23 * 60 + 59, h * 60 + m + mins); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const [f, setF] = useState({ date: '', start: '09:00', end: '10:00', calendarId: '' });
  const [conf, setConf] = useState<any[]>([]);
  const assignee = task.assignee_id as string | null;
  const forOther = !!assignee && assignee !== user.id;
  const editable = (cals.data?.calendars ?? []).filter((c) => c.perms.edit);
  const personal = editable.find((c) => c.type === 'personal');
  const unitCal = editable.find((c) => c.type === 'org_unit' && c.org_unit_id === task.org_unit_id);
  const defaultCal = forOther ? unitCal ?? personal : personal;
  const avail = useApi<{ days: any[] }>(open && f.date && assignee ? `/api/availability?userId=${assignee}&date=${f.date}` : null, [f.date]);
  useEffect(() => { if (open) { const d = task.due_date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()); setF({ date: d, start: '09:00', end: endOf('09:00', Math.min(remaining, 240)), calendarId: '' }); } }, [open, task.due_date]); // eslint-disable-line react-hooks/exhaustive-deps
  const calId = f.calendarId || defaultCal?.id || '';
  const chosen = editable.find((c) => c.id === calId);
  const addAttendee = forOther && !(chosen?.type === 'personal' && chosen?.owner_user_id === assignee);
  const iso = (d: string, t: string) => `${d}T${t}:00+09:00`;
  useEffect(() => {
    if (!open || !f.date) return;
    api(`/api/events/conflicts?start=${encodeURIComponent(iso(f.date, f.start))}&end=${encodeURIComponent(iso(f.date, f.end))}${assignee ? `&userIds=${assignee}` : ''}`).then((r) => setConf(r.conflicts)).catch(() => {});
  }, [open, f.date, f.start, f.end, assignee]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.end <= f.start) return toast.error('종료 시각이 시작보다 빨라요');
    try {
      await api('/api/events', { body: { calendarId: calId, title: task.title, start: iso(f.date, f.start), end: iso(f.date, f.end), taskId: task.id, kind: 'task_block', ...(addAttendee ? { attendeeIds: [assignee] } : {}) } });
      toast.ok(forOther ? `${task.assignee_name}님의 실행 시간을 배정했습니다` : '캘린더에 실행 시간을 배정했습니다'); onClose(); onDone(); broadcastRefresh();
    } catch (er: any) { toast.error(er.message); }
  }
  const day = avail.data?.days?.[0];
  return (
    <Modal open={open} onClose={onClose} title="업무 실행 시간 배정">
      <form onSubmit={save} className="space-y-3">
        <p className="text-xs text-ink-2">마감일과 별도로 실제로 일할 시간을 캘린더에 잡습니다.{task.estimate_minutes ? ` 예상 ${fmtMinutes(task.estimate_minutes)} 중 ${fmtMinutes(task.scheduled_minutes ?? 0)} 배정됨.` : ''}</p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="날짜"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
          <Field label="시작"><input type="time" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, end: endOf(e.target.value, Math.max(30, (() => { const [a, b] = f.start.split(':').map(Number); const [c, d] = f.end.split(':').map(Number); return c * 60 + d - (a * 60 + b); })())) })} required /></Field>
          <Field label="종료"><input type="time" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></Field>
        </div>
        <Field label="캘린더" hint={addAttendee ? `${task.assignee_name}님을 참석자로 넣어 그 사람 캘린더·업무량에도 보입니다` : undefined}>
          <select className={inputCls} value={calId} onChange={(e) => setF({ ...f, calendarId: e.target.value })}>
            {editable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {day && (
          <p className={cx('rounded-input p-2 text-xs', day.freeMinutes < 60 ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-ink-2')} data-testid="block-availability">
            {task.assignee_name ?? '담당자'} · {day.holiday ? `공휴일(${day.holiday}) · ` : ''}{day.away ? '휴가·출장 · ' : ''}이날 회의 {fmtMinutes(day.meetingMinutes) || '없음'}, 업무 시간 {fmtMinutes(day.blockMinutes) || '없음'}, 남은 가용 {fmtMinutes(day.freeMinutes) || '0분'}
          </p>
        )}
        {conf.length > 0 && <p className="rounded-input bg-amber-50 p-2 text-xs text-amber-800">겹치는 일정: {conf.map((c) => `${c.title}(${fmtTimeRange(c.start, c.end)})`).join(', ')}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit">배정</Button></div>
      </form>
    </Modal>
  );
}

function DepsModal({ open, onClose, taskId, current, onSave }: { open: boolean; onClose: () => void; taskId: string; current: string[]; onSave: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>(current);
  useEffect(() => { if (open) setSel(current); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useApi<{ tasks: any[] }>(open ? `/api/tasks?includeDone=1&limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}` : null, [q]);
  return (
    <Modal open={open} onClose={onClose} title="선행 업무 선택">
      <input className={inputCls} placeholder="업무 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-2 max-h-72 divide-y overflow-y-auto">
        {list.data?.tasks.filter((x) => x.id !== taskId).map((x) => (
          <li key={x.id} className="flex items-center gap-2 py-1.5 text-sm">
            <input type="checkbox" checked={sel.includes(x.id)} onChange={(e) => setSel(e.target.checked ? [...sel, x.id] : sel.filter((s) => s !== x.id))} />
            <span className="flex-1 truncate">{x.title}</span><StatusBadge status={x.status} />
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={() => onSave(sel)}>저장</Button></div>
    </Modal>
  );
}
