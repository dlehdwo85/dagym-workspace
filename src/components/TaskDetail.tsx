'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import {
  BadgeCheck, Building2, CalendarClock, CalendarDays, Camera, Check, ChevronRight, CircleCheck, Clock, Copy, CornerDownRight, Flag, FolderKanban, Hash,
  Bell, Hourglass, LayoutTemplate, Link2, ListFilter, Maximize2, Merge, MoreHorizontal, Percent, Plus, Repeat, RotateCcw, Rows3, Shapes, ShieldCheck,
  Stamp, Tag, Timer, CalendarCheck, Trash2, Type, UserRound, Users, X, CalendarRange, AlertTriangle, type LucideIcon,
  Megaphone,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { Avatar, Button, DueChip, ErrorBox, Field, IconButton, Modal, Skeleton, STATUS_TONE, StatusBadge, cx, fmtDateTime, fmtMinutes, fmtTimeRange, inputCls, toast, todayStr } from '@/components/ui';
import { BrandSelect, MultiUserSelect, RecurSelect, UnitSelect, UserSelect } from '@/components/pickers';
import { Attachments, uploadTaskFiles } from '@/components/Attachments';
import { DropZone, UploadProgress } from '@/components/upload';
import { BellChip, DuePicker, warnAway } from '@/components/TaskQuick';
import { TIMES, timeLabel } from '@/components/DateTimePickers';
import { QuickAddTask } from '@/components/QuickAddTask';
import { PRIORITY_LABEL, STATUS_LABEL, STATUSES, type TaskStatus } from '@/lib/types';
import { encodeMentions } from '@/lib/mentions';

const ACTION_LABEL: Record<string, string> = {
  created: '업무 생성', updated: '수정', review_requested: '검토 요청', approved: '최종 완료 확인', review_rejected: '보완 요청', completed: '완료',
  reopened: '다시 열기', deleted: '삭제', comment_edited: '댓글 수정', comment_deleted: '댓글 삭제', checklist_added: '체크리스트 추가',
  checklist_done: '체크리스트 완료', checklist_undone: '체크리스트 해제', checklist_removed: '체크리스트 삭제', checklist_edited: '체크리스트 수정',
  file_attached: '파일 첨부', link_attached: '문서 링크 연결', attachment_removed: '첨부 삭제', recurring_created: '반복 회차 생성',
};
const FIELD_LABEL: Record<string, string> = {
  title: '제목', description: '설명', assigneeId: '담당자', requestedById: '지시자', priority: '우선순위', startDate: '시작일', dueDate: '마감일', dueTime: '마감 시각', status: '상태',
  tags: '태그', projectId: '프로젝트', sectionId: '섹션', brandId: '브랜드', orgUnitId: '소속', collaborators: '협업자', approvalRequired: '검토 필요', recurrenceRule: '반복', dependsOn: '선행 업무',
};

/** 업무 상세. 전체 화면(/tasks/:id)과 목록 옆 오른쪽 패널(inPanel) 공용 */
export function TaskDetail({ id, onClose, inPanel }: { id: string; onClose?: () => void; inPanel?: boolean }) {
  const router = useRouter();
  const { user, dir, features } = useSession();
  const { data, error, loading, reload } = useApi<any>(`/api/tasks/${id}`);
  const [cprog, setCprog] = useState<{ name: string; pct: number; error?: string }[]>([]);
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
  const [moreFields, setMoreFields] = useState(false);
  const wide = !inPanel; // V13 11번: 전체 화면(PC)은 2열
  const [details, setDetails] = useState(true);
  useEffect(() => { if (window.innerWidth < 640) setDetails(false); }, []); // 휴대폰은 "세부 정보" 요약 한 줄로 시작
  const [subTitle, setSubTitle] = useState('');
  const [subAssignee, setSubAssignee] = useState<string | null>(null);
  const [subDue, setSubDue] = useState('');
  const [planOpen, setPlanOpen] = useState<'' | 'check' | 'sub'>('');
  useEffect(() => { try { setMoreFields(localStorage.getItem('wos_task_more') === '1'); } catch {} }, []);
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

  // 저장 버튼 없이 자동 기록 (WORKIN_AUTOSAVE): 제목은 칸을 벗어나거나 Enter, 설명은 입력을 멈춘 1초 뒤·칸을 벗어날 때
  const [descState, setDescState] = useState<'' | 'saving' | 'saved' | 'error'>('');
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descSent = useRef<string | null>(null);
  async function saveText(field: 'title' | 'description', value: string) {
    if (field === 'description') setDescState('saving');
    try {
      await api(`/api/tasks/${id}`, { method: 'PATCH', body: { [field]: value } }); // 글자 입력은 버전 비교 없이(연속 저장 충돌 방지)
      if (field === 'description') { descSent.current = value; setDescState('saved'); }
      reload(); broadcastRefresh();
    } catch (e: any) { if (field === 'description') setDescState('error'); toast.error(`${field === 'title' ? '제목' : '설명'}을 저장하지 못했습니다: ${e.message}`); }
  }
  const flushDesc = (v: string | null) => { if (descTimer.current) { clearTimeout(descTimer.current); descTimer.current = null; } if (v !== null && v !== (descSent.current ?? data?.task?.description)) saveText('description', v); };
  // 다른 화면으로 가거나 앱을 닫을 때도 입력 중인 설명을 저장
  const descRef = useRef<string | null>(null); descRef.current = desc;
  useEffect(() => {
    const h = () => { if (document.visibilityState === 'hidden') flushDesc(descRef.current); };
    const leave = () => flushDesc(descRef.current);
    document.addEventListener('visibilitychange', h); window.addEventListener('pagehide', leave);
    return () => { document.removeEventListener('visibilitychange', h); window.removeEventListener('pagehide', leave); flushDesc(descRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const titleCancel = useRef(false);
  // V8 7번: 멘션 알림을 누르면 그 댓글로 (#c-…)
  useEffect(() => {
    if (!data || typeof window === 'undefined' || !location.hash.startsWith('#c-')) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('ring-2', 'ring-amber-300', 'rounded'); setTimeout(() => el.classList.remove('ring-2', 'ring-amber-300'), 2500); }
  }, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const subs = data?.subtasks?.length ?? 0;
    const synced = (events.data?.events ?? []).filter((e: any) => e.sync);
    if (!confirm(`이 업무를 삭제할까요?${subs ? `\n하위 업무 ${subs}개도 함께 삭제됩니다.` : ''}\n삭제한 업무는 30일 동안 휴지통에서 되살릴 수 있습니다.`)) return;
    // V5 "업무에도 추가"로 연결된 일정: 함께 지울지 묻는다 (반복 업무는 일정 시리즈 전체가 지워지므로 묻지 않고 남김)
    const alsoEvent = synced.length > 0 && !data?.task?.recurrence_rule && confirm(`연결된 일정 '${synced[0].title}'도 함께 삭제할까요?\n취소를 누르면 업무만 삭제하고 일정은 남깁니다.`);
    // V6 13번: 담당자별로 같이 만든 묶음은 지시자가 한 번에 지울 수 있음
    const t0 = data?.task;
    const batchAll = !!t0?.batch_id && (t0.batch?.total ?? 0) > 1 && (t0.requested_by === user.id || t0.created_by === user.id) && confirm(`같이 만든 ${t0.batch.total}건(담당자별)을 모두 삭제할까요?\n취소를 누르면 이 업무만 삭제합니다.`);
    try {
      if (batchAll) await api(`/api/tasks/batch/${t0.batch_id}`, { method: 'DELETE' });
      else await api(`/api/tasks/${id}${alsoEvent ? '?alsoEvent=1' : ''}`, { method: 'DELETE' });
      toast.ok(batchAll ? `${t0.batch.total}건을 삭제했습니다` : '삭제했습니다 — 휴지통에서 30일 동안 되살릴 수 있습니다', batchAll ? undefined : {
        label: '되돌리기', run: async () => { try { await api(`/api/tasks/${id}/restore`, { body: {} }); toast.ok('되살렸습니다'); broadcastRefresh(); } catch (e: any) { toast.error(e.message); } },
      });
      broadcastRefresh(); if (onClose) onClose(); else router.push('/tasks');
    } catch (e: any) { toast.error(e.message); }
  }
  async function saveTemplate() {
    const name = prompt('템플릿 이름', t.title);
    if (!name) return;
    // V8 3번: 관리자는 공용(이 소속) 또는 개인, 직원은 개인 템플릿(나만 봄)
    const personal = !perms.approve || !confirm('이 소속 모두가 쓰는 공용 템플릿으로 저장할까요?\n취소를 누르면 나만 쓰는 개인 템플릿으로 저장합니다.');
    try { await api('/api/templates', { body: { name, fromTaskId: id, orgUnitId: t.org_unit_id, personal } }); toast.ok(personal ? '개인 템플릿으로 저장했습니다' : '공용 템플릿으로 저장했습니다'); } catch (e: any) { toast.error(e.message); }
  }

  // "필드 더보기" 안에 값이 들어 있는 항목 수
  const moreSet = [t.start_date, t.priority !== 'normal', t.estimate_minutes, t.task_type && t.task_type !== 'normal', t.tags?.length, t.approval_line_id,
    Number(t.photo_required ?? 0) > 0, t.approval_required, data.collaborators?.length, data.dependencies?.length].filter(Boolean).length;
  const photoNeed = Number(t.photo_required ?? 0);
  const photoHave = Number(t.photo_count ?? 0);
  const photoShort = photoNeed > 0 && photoHave < photoNeed;
  const lastRound = data.approvals?.length ? data.approvals[0].round : null;
  const roundSteps = (data.approvals ?? []).filter((a: any) => a.round === lastRound).sort((a: any, b: any) => a.step - b.step);
  const checkDone = data.checklist.filter((c: any) => c.done).length;
  const subDone = data.subtasks.filter((x: any) => x.status === 'done').length;
  const planEmpty = !planOpen && !data.checklist.length && !data.subtasks.length && !data.dependencies.length && !moreFields;

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
    : t.status === 'review' ? (data.approvals?.length && t.approval_line_id ? null : t.requested_by === user.id ? { label: '최종 완료 확인', run: () => patch({ status: 'done' }, '최종 완료 확인했습니다') } : null)
    : t.approval_line_id ? { label: '결재 올리기', run: () => patch({ status: 'review' }, '결재를 요청했습니다') }
    : t.approval_required && !perms.approve ? { label: '완료 → 검토 요청', run: () => patch({ status: 'review' }, '검토를 요청했습니다') }
    : { label: '완료', run: () => patch({ status: 'done' }, '완료 처리했습니다') };

  return (
    <div className={cx(!inPanel && 'mx-auto max-w-4xl lg:max-w-6xl', 'pb-[calc(6rem+var(--sab))] sm:pb-6')} data-testid={inPanel ? 'task-panel-body' : 'task-page'}>
      {/* 상단 도구 막대 */}
      <div className={cx('sticky top-0 z-20 flex items-center gap-1.5 border-b border-line bg-white/95 px-4 py-2 backdrop-blur', !inPanel && 'rounded-t-card border', inPanel && 'pt-[calc(var(--sat)+0.5rem)] sm:pt-2')}>
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
        {inPanel && <IconButton label="전체 화면" onClick={() => router.push(`/tasks/${id}`)}><Maximize2 /></IconButton>}
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
                <MenuItem icon={LayoutTemplate} onClick={saveTemplate}>템플릿으로 저장</MenuItem>
                {features.ai && <MenuItem icon={Sparkles} onClick={() => router.push(`/assistant?task=${id}`)}>✨ AI에게 요청</MenuItem>}
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
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); (e.currentTarget.elements.namedItem('title') as HTMLInputElement)?.blur(); }}>
              <input name="title" autoFocus enterKeyHint="done" className={cx(inputCls, 'text-lg font-bold')} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="제목"
                onKeyDown={(e) => { if (e.key === 'Escape') { titleCancel.current = true; setTitle(null); } }}
                onBlur={() => { if (!titleCancel.current && title.trim() && title.trim() !== t.title) saveText('title', title.trim()); titleCancel.current = false; setTitle(null); }} />
            </form>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="task-actions">
            <StatusChip status={t.status} onChange={(v) => patch({ status: v })} />
            {t.status !== 'done' && t.status !== 'review' && t.approval_required && !perms.approve && !t.approval_line_id && primary?.label !== '완료 → 검토 요청' && (
              <Button size="sm" onClick={() => patch({ status: 'review' }, '검토를 요청했습니다')}>완료 → 검토 요청</Button>
            )}
            {t.status === 'review' && perms.approve && !t.approval_line_id && <Button size="sm" variant="secondary" onClick={reject}>보완 요청</Button>}
            {t.status === 'done' && <Button size="sm" variant="ghost" onClick={() => patch({ status: 'in_progress' })}><RotateCcw />다시 진행</Button>}
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

        {/* V6 13번: 같이 받은 사람 (담당자별로 1건씩 만든 묶음) */}
        {data.batchMates?.length > 1 && (
          <section className="rounded-card border border-violet-200 bg-violet-50/50 p-3 text-sm" data-testid="batch-mates">
            <p className="mb-1.5 font-semibold text-violet-800">같이 받은 사람 {data.batchMates.length}명 · 완료 {data.batchMates.filter((b: any) => b.status === 'done').length}</p>
            <ul className="flex flex-wrap gap-1.5">
              {data.batchMates.map((b: any) => (
                <li key={b.id}><Link href={`/tasks/${b.id}`} className={cx('inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 text-xs', b.id === id ? 'border-violet-400 font-semibold' : 'border-line')}>
                  {b.assignee_name ?? '담당자 없음'} · {STATUS_LABEL[b.status as TaskStatus]}</Link></li>
              ))}
            </ul>
            {(t.requested_by === user.id || t.created_by === user.id) && (
              <button type="button" className="mt-2 text-xs font-medium text-violet-800 underline" data-testid="batch-apply"
                onClick={async () => { if (!confirm('이 업무의 제목·마감·우선순위·설명을 같이 받은 모든 업무에 똑같이 적용할까요?')) return;
                  try { const r = await api(`/api/tasks/batch/${t.batch_id}`, { method: 'PATCH', body: { title: t.title, dueDate: t.due_date, dueTime: t.due_time, priority: t.priority, description: t.description } }); toast.ok(`${r.updated}건에 적용했습니다`); reload(); broadcastRefresh(); } catch (e: any) { toast.error(e.message); } }}>
                같은 묶음 모두에 적용 (지시자)</button>
            )}
          </section>
        )}

        <div className={cx('flex flex-col gap-6', wide && 'lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-x-6')}>
        <section className={cx(wide && 'lg:col-start-1 lg:row-start-1')} data-testid="desc-section">
          <h2 className="mb-1.5 text-sm font-semibold">설명</h2>
          {desc === null ? (
            <div className="min-h-[56px] cursor-text rounded-card border border-line bg-slate-50/70 px-3 py-2.5 text-sm leading-relaxed hover:border-slate-300" onClick={() => { descSent.current = t.description; setDescState(''); setDesc(t.description); }} data-testid="desc-view">
              {t.description ? <RichText text={t.description} /> : <span className="text-ink-3">업무 내용·기준·참고 링크를 적어 주세요 (**굵게**, 링크 자동 연결)</span>}
            </div>
          ) : (
            <div>
              <textarea autoFocus rows={6} className={inputCls} value={desc} aria-label="설명"
                onChange={(e) => { const v = e.target.value; setDesc(v); setDescState(''); if (descTimer.current) clearTimeout(descTimer.current); descTimer.current = setTimeout(() => { descTimer.current = null; saveText('description', v); }, 1000); }}
                onBlur={() => { flushDesc(desc); setDesc(null); }} />
              <p className="mt-1 h-4 text-xs text-ink-3" aria-live="polite" data-testid="desc-state">{descState === 'saving' ? '저장 중…' : descState === 'saved' ? '저장됨 ✓' : descState === 'error' ? <span className="text-red-600">저장 안 됨 — 다시 입력하거나 칸을 벗어나면 다시 시도합니다</span> : '입력하면 자동으로 저장됩니다'}</p>
            </div>
          )}
        </section>

        {/* V13 11-1: 설명 바로 아래 체크리스트·하위 업무. 둘 다 비어 있으면 한 줄만 */}
        <div className={cx('min-w-0 space-y-6', wide && 'lg:col-start-1 lg:row-start-2')} data-testid="plan-area">
        {planEmpty ? (
          <div className="flex flex-wrap gap-2" data-testid="plan-empty">
            <button type="button" className="rounded-input border border-dashed border-line px-3 py-2 text-sm text-ink-2 hover:border-slate-400 hover:text-ink" onClick={() => setPlanOpen('check')}>＋ 단계 추가 <span className="text-xs text-ink-3">(체크리스트)</span></button>
            <button type="button" className="rounded-input border border-dashed border-line px-3 py-2 text-sm text-ink-2 hover:border-slate-400 hover:text-ink" onClick={() => setPlanOpen('sub')}>＋ 하위 업무 나눠 맡기기</button>
          </div>
        ) : <>
        <section data-testid="checklist-section">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">체크리스트 {data.checklist.length > 0 && <span className="text-xs font-medium text-ink-2 tabular-nums">{checkDone}/{data.checklist.length}</span>}
            <HelpTip testid="help-checklist">이 업무를 하는 사람이 따라갈 단계입니다. 담당자·마감이 따로 없고, 이 업무 안에서만 체크합니다.</HelpTip></h2>
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
            <input autoFocus={planOpen === 'check'} className={cx(inputCls, 'h-8')} placeholder="+ 단계 추가" value={newItem} onChange={(e) => setNewItem(e.target.value)} aria-label="체크리스트 항목 추가" />
            <Button size="sm" variant="secondary">추가</Button>
          </form>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold">하위 업무 {data.subtasks.length > 0 && <span className="text-xs font-medium text-ink-2 tabular-nums" data-testid="subtask-progress">{subDone}/{data.subtasks.length} 완료</span>}
            <HelpTip testid="help-subtasks">다른 사람에게 나눠 맡기거나 마감이 따로 있는 작은 업무입니다. 하위 업무마다 목록·알림·상태가 따로 생깁니다.</HelpTip></h2>
            <Button size="sm" variant="ghost" onClick={() => setSub(true)}><Plus />자세히 추가</Button></div>
          {data.subtasks.length > 0 && <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-accent-600 transition-all" style={{ width: `${(subDone / data.subtasks.length) * 100}%` }} /></div>}
          {/* 모든 하위 업무 완료 → 상위도 완료할지 안내 (상태를 바꿀 수 있는 사람에게만) */}
          {data.subtasks.length > 0 && subDone === data.subtasks.length && t.status !== 'done' && t.status !== 'review' && (t.assignee_id ?? t.created_by) === user.id && (
            <p className="mb-2 flex flex-wrap items-center gap-2 rounded-input bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="subtasks-all-done">
              <CircleCheck className="size-4 shrink-0" />하위 업무가 모두 끝났습니다 — 이 업무도 완료할까요?
              {primary && <Button size="sm" onClick={primary.run}>{primary.label}</Button>}
            </p>
          )}
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
          {/* 한 줄 추가: 제목 + 담당·마감 칩 */}
          <form className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="subtask-add" onSubmit={async (e) => {
            e.preventDefault(); if (!subTitle.trim()) return;
            try {
              await api('/api/tasks', { body: { title: subTitle.trim(), parentId: id, assigneeId: subAssignee ?? t.assignee_id ?? undefined, dueDate: subDue || undefined, approvalRequired: false } });
              setSubTitle(''); setSubDue(''); reload(); broadcastRefresh();
            } catch (er: any) { toast.error(er.message); }
          }}>
            <input className={cx(inputCls, 'h-8 min-w-0 flex-1 basis-40')} autoFocus={planOpen === 'sub'} placeholder="+ 하위 업무 추가 (담당·마감 지정)" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} aria-label="하위 업무 제목" />
            <UserSelect className="h-8 w-auto max-w-[9rem] rounded-full border border-line bg-white px-2 text-xs" value={subAssignee ?? t.assignee_id} onChange={(v) => setSubAssignee(v)} />
            <input type="date" className="h-8 rounded-full border border-line bg-white px-2 text-xs" value={subDue} onChange={(e) => setSubDue(e.target.value)} aria-label="하위 업무 마감" />
            <Button size="sm" variant="secondary" disabled={!subTitle.trim()}>추가</Button>
          </form>
          {(moreFields || data.dependencies.length > 0) && <>
          <div className="mt-4 mb-1.5 flex items-center justify-between"><h2 className="text-sm font-semibold">선행 업무</h2><Button size="sm" variant="ghost" onClick={() => setDepOpen(true)}>편집</Button></div>
          <ul className="space-y-1 text-sm">
            {data.dependencies.map((d: any) => (
              <li key={d.id} className="flex items-center gap-2"><StatusBadge status={d.status} /><Link className="hover:underline" href={`/tasks/${d.id}`}>{d.title}</Link></li>
            ))}
            {!data.dependencies.length && <li className="text-xs text-ink-3">없음 — 선행 업무가 끝나야 완료할 수 있게 하려면 추가하세요</li>}
          </ul>
          </>}
        </section>

        </>}
        </div>
        {/* V13 11번: PC 는 오른쪽 320px 고정 열, 휴대폰·좁은 패널은 "세부 정보" 요약 한 줄(누르면 펼침) */}
        <aside className={cx('min-w-0', wide && 'lg:sticky lg:top-16 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start lg:rounded-card lg:border lg:border-line lg:p-2')} aria-label="세부 정보" data-testid="detail-aside">
          <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details} data-testid="details-toggle"
            className={cx('flex w-full items-center gap-2 rounded-input border border-line bg-white px-3 py-2 text-left text-sm', wide && 'lg:hidden', details && 'mb-1')}>
            <span className="shrink-0 font-semibold">세부 정보</span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-2">👤{t.assignee_name ?? '담당 없음'} · 📣{t.requested_by_name ?? '-'} · 📅{t.due_date ? `${Number(t.due_date.slice(5, 7))}/${Number(t.due_date.slice(8, 10))}${t.due_time ? ' ' + t.due_time.slice(0, 5) : ''}` : '마감 없음'} · 🔔{t.reminder_minutes?.length ? `${t.reminder_minutes.length}개` : '기본'}</span>
            <ChevronRight className={cx('size-4 shrink-0 transition-transform', details && 'rotate-90')} />
          </button>
          <div className={cx(!details && 'hidden', wide && 'lg:block')}>
        {/* 속성 */}
          <section className={cx('grid grid-cols-1 border-y border-line', wide && 'lg:border-y-0')} aria-label="업무 속성">
            <Prop icon={UserRound} label="담당자">
              <span className="flex pl-2 items-center gap-1.5"><Avatar id={t.assignee_id} name={t.assignee_name} size={22} /><UserSelect className={ghostCls} value={t.assignee_id} onChange={(v) => { patch({ assigneeId: v }); if (v && v !== user.id && t.due_date) warnAway(v, t.due_date, dir.users.find((x) => x.id === v)?.name ?? '담당자'); }} /></span>
            </Prop>
            <Prop icon={Megaphone} label="지시자">
              <span className="flex pl-2 items-center gap-1.5" data-testid="detail-requester"><Avatar id={t.requested_by} name={t.requested_by_name} size={22} /><UserSelect className={ghostCls} value={t.requested_by} onChange={(v) => patch({ requestedById: v })} /></span>
            </Prop>
            <Prop icon={CalendarDays} label="마감일">
              {/* 값이 없으면 "마감일 없음" 칩 하나, 누르면 빠른 선택·달력. 시각은 날짜를 정한 뒤에만 */}
              <span className="flex pl-2 flex-wrap items-center gap-1.5" data-testid="detail-due" data-value={t.due_date ?? ''}>
                <DuePicker value={t.due_date} status={t.status} label="마감일" emptyText="마감일 없음" onChange={(v) => patch({ dueDate: v, ...(v ? {} : { dueTime: null }) })} />
                {t.due_date && (
                  <select className="h-8 rounded-input border border-line bg-white px-1.5 text-sm text-ink-2 hover:border-slate-300" value={t.due_time?.slice(0, 5) ?? ''} onChange={(e) => patch({ dueTime: e.target.value || null })} aria-label="마감 시각">
                    <option value="">시각 없음</option>
                    {(TIMES.includes(t.due_time?.slice(0, 5) ?? '') || !t.due_time ? TIMES : [...TIMES, t.due_time.slice(0, 5)].sort()).map((x) => <option key={x} value={x}>{timeLabel(x)}</option>)}
                  </select>
                )}
                {data.risk?.risk && <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700"><AlertTriangle className="size-3.5" />마감 위험</span>}
              </span>
            </Prop>
            <Prop icon={Bell} label="미리 알림" asDiv><span className="pl-1" data-testid="detail-remind"><BellChip value={t.reminder_minutes ?? null} onChange={(v) => patch({ reminderMinutes: v })} /><span className="ml-1 text-xs text-ink-3">{t.reminder_minutes?.length ? '' : t.due_time ? '기본(설정의 업무 알림)' : '기본(마감일 09시)'}</span></span></Prop>
            <Prop icon={Repeat} label="반복" asDiv><div className="w-full [&_select]:border-transparent [&_select]:bg-transparent hover:[&_select]:border-line" data-testid="detail-repeat">{t.due_date || t.recurrence_rule ? <RecurSelect value={t.recurrence_rule} onChange={(v) => patch({ recurrenceRule: v })} anchorDate={t.due_date} /> : <span className="px-2 text-xs text-ink-3">마감일을 정하면 반복할 수 있습니다</span>}</div></Prop>
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
            <Prop icon={CalendarCheck} label="캘린더 표시" asDiv>
              <label className="flex min-h-8 cursor-pointer items-center gap-2.5 px-2 text-sm">
                <input type="checkbox" role="switch" className="peer sr-only" checked={t.show_on_calendar !== false} onChange={(e) => patch({ showOnCalendar: e.target.checked })} aria-label="캘린더에 표시" />
                <span aria-hidden className="relative h-5 w-9 shrink-0 rounded-full bg-slate-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-accent-600 peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500/40" />
                <span className="text-xs text-ink-2">{t.due_date ? (t.show_on_calendar !== false ? `${t.due_time ? '마감 시각' : '마감일'} 칸에 체크로 표시` : '캘린더에 안 보임') : '마감일을 정하면 캘린더에 표시됩니다'}</span>
              </label>
            </Prop>
          </section>
          <div>
            <button type="button" onClick={() => setMoreFields((v) => { try { localStorage.setItem('wos_task_more', v ? '0' : '1'); } catch {} return !v; })}
              className="inline-flex items-center gap-1 rounded-input px-1.5 py-1 text-sm font-medium text-ink-2 hover:bg-slate-100 hover:text-ink" aria-expanded={moreFields} data-testid="more-fields">
              <ChevronRight className={cx('size-4 transition-transform', moreFields && 'rotate-90')} />필드 더보기
              {moreSet > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-ink-2">{moreSet}개 설정됨</span>}
            </button>
            {moreFields && (
              <section className="mt-1 grid grid-cols-1 gap-x-6 gap-y-0.5 border-l-2 border-line pl-3" aria-label="추가 필드">
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
            <Prop icon={Users} label="협업자" asDiv><MultiUserSelect value={data.collaborators.map((c: any) => c.id)} onChange={(v) => patch({ collaboratorIds: v })} /></Prop>
              </section>
            )}
          </div>
          </div>
        </aside>
        <div className={cx('min-w-0 space-y-6', wide && 'lg:col-start-1 lg:row-start-3')}>
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
                  {e.sync && <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 text-[11px] font-medium text-emerald-700" title="마감을 바꾸면 일정도 같이 옮겨집니다">날짜 연동</span>}
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
            {/* V13 8번: 댓글 + 들여쓴 답글(1단계), 답글·수정·삭제·반응 */}
            {data.comments.filter((c: any) => !c.parent_id).map((c: any) => (
              <CommentThread key={c.id} c={c} replies={data.comments.filter((r: any) => r.parent_id === c.id)} taskId={id} meId={user.id}
                mentionable={mentionable.data?.users ?? []} onChange={() => { reload(); broadcastRefresh(); }} />
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
          {/* V12 9번: 댓글 칸에 파일을 끌어 놓으면 이 업무에 첨부 */}
          <DropZone onFiles={async (f) => { await uploadTaskFiles(Array.from(f), { taskId: id }, setCprog); reload(); broadcastRefresh(); }} label="놓으면 이 업무에 첨부됩니다" testid="comment-drop">
          <form onSubmit={sendComment} className="relative mt-4 rounded-card border border-line bg-white focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20">
            {/* V8 7번: "@" 를 치면 이 업무를 볼 수 있는 사람 자동완성 */}
            {(() => {
              const m = /(^|\s)@([^\s@]*)$/.exec(comment);
              if (!m) return null;
              const list = (mentionable.data?.users ?? []).filter((u) => u.id !== user.id && u.name.includes(m[2])).slice(0, 6);
              if (!list.length) return null;
              return (
                <ul role="listbox" aria-label="멘션 자동완성" className="absolute bottom-full left-2 z-20 mb-1 w-56 overflow-hidden rounded-card border border-line bg-white shadow-pop" data-testid="mention-suggest">
                  {list.map((u) => (
                    <li key={u.id}><button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => { setComment((c) => c.replace(/@[^\s@]*$/, `@${u.name} `)); setPicked((p) => (p.some((x) => x.id === u.id) ? p : [...p, { id: u.id, name: u.name }])); }}>
                      <Avatar id={u.id} name={u.name} size={20} />{u.name}{u.title && <span className="text-xs text-ink-3">{u.title}</span>}</button></li>
                  ))}
                </ul>
              );
            })()}
            <textarea className="block w-full resize-none rounded-t-card border-0 bg-transparent px-3 py-2.5 text-sm focus:outline-none focus:ring-0" rows={2} placeholder="댓글 입력 — @ 를 치면 사람을 언급할 수 있어요" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="comment-input"
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
          <UploadProgress items={cprog} />
          </DropZone>
        </section>
        </div>
        </div>
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
      <span className="flex min-h-8 w-24 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-2 sm:w-[120px] sm:gap-2"><Icon className="size-4 shrink-0 text-ink-3" />{label}</span>
      <span className="flex min-h-8 min-w-0 flex-1 items-center">{children}</span>
    </>
  );
  return asDiv
    ? <div className={cx('flex min-h-12 items-center gap-2 border-b border-line py-1.5 last:border-b-0', className)} role="group" aria-label={label}>{inner}</div>
    : <label className={cx('flex min-h-12 items-center gap-2 border-b border-line py-1.5 last:border-b-0', className)}>{inner}</label>;
}
/** 상태 칩 하나: 누르면 할 일·진행 중·검토·보류·완료 중 선택 (배지·버튼·select 중복 정리) */
function StatusChip({ status, onChange }: { status: TaskStatus; onChange: (v: TaskStatus) => void }) {
  const tone = STATUS_TONE[status];
  return (
    <label className={cx('relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full pl-2.5 pr-7 text-sm font-medium', tone.badge)} data-testid="status-chip">
      <span className={cx('size-2 rounded-full', tone.dot)} aria-hidden />{STATUS_LABEL[status]}
      <ChevronDown className="pointer-events-none absolute right-2 size-3.5 opacity-70" aria-hidden />
      <select className="absolute inset-0 cursor-pointer opacity-0" value={status} onChange={(e) => onChange(e.target.value as TaskStatus)} aria-label="상태">
        {STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}
      </select>
    </label>
  );
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
  if (k === 'assigneeId' || k === 'requestedById') return userName(v) || '알 수 없음';
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

/** V13 12번: 제목 옆 (?) — 누르면 설명이 펼쳐짐 */
function HelpTip({ children, testid }: { children: React.ReactNode; testid?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex font-normal">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="도움말" data-testid={testid}
        className="inline-flex size-[18px] items-center justify-center rounded-full border border-line text-[11px] font-semibold text-ink-3 hover:border-slate-400 hover:text-ink">?</button>
      {open && <span role="note" className="absolute left-0 top-6 z-20 w-64 rounded-card border border-line bg-white p-2.5 text-xs leading-relaxed text-ink-2 shadow-pop">{children}</span>}
    </span>
  );
}

/** V13 11번 설명 보기: 줄바꿈·**굵게**·[이름](주소)·주소 자동 링크, 6줄 넘으면 접기 */
function RichText({ text }: { text: string }) {
  const [more, setMore] = useState(false);
  const long = text.split('\n').length > 6 || text.length > 420;
  const inline = (line: string, k: number) => {
    const out: React.ReactNode[] = [];
    const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g;
    let last = 0; let m: RegExpExecArray | null; let n = 0;
    while ((m = re.exec(line))) {
      if (m.index > last) out.push(line.slice(last, m.index));
      if (m[1]) out.push(<b key={`${k}-${n++}`}>{m[1]}</b>);
      else out.push(<a key={`${k}-${n++}`} href={m[3] ?? m[4]} target="_blank" rel="noreferrer" className="text-accent-600 underline break-all" onClick={(e) => e.stopPropagation()}>{m[2] ?? m[4]}</a>);
      last = m.index + m[0].length;
    }
    if (last < line.length) out.push(line.slice(last));
    return out;
  };
  return (
    <div>
      <div className={cx('whitespace-pre-wrap break-words', long && !more && 'line-clamp-6')} data-testid="desc-rich">
        {text.split('\n').map((l, i) => <span key={i}>{inline(l, i)}{'\n'}</span>)}
      </div>
      {long && <button type="button" className="mt-1 text-xs font-medium text-accent-600" onClick={(e) => { e.stopPropagation(); setMore(!more); }} data-testid="desc-more">{more ? '접기' : '더 보기'}</button>}
    </div>
  );
}

const REACTIONS = [['👍', '확인했습니다'], ['✅', '완료'], ['🙏', '감사합니다'], ['❤️', '좋아요'], ['😂', '웃음']] as const;
/** V13 8번 댓글 한 묶음: 원 댓글 + 답글(접힘 "답글 n개 보기") + 답글 입력 */
function CommentThread({ c, replies, taskId, meId, mentionable, onChange }: { c: any; replies: any[]; taskId: string; meId: string; mentionable: { id: string; name: string }[]; onChange: () => void }) {
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && replies.some((r) => location.hash === `#c-${r.id}`));
  const [reply, setReply] = useState<string | null>(null);
  async function sendReply(e: React.FormEvent) {
    e.preventDefault(); if (!reply?.trim()) return;
    // 입력창의 @이름 → 내부 멘션 표기
    let text = reply;
    for (const u of mentionable) text = text.split(`@${u.name} `).join(`@[${u.name}](${u.id}) `);
    try { await api(`/api/tasks/${taskId}/comments`, { body: { body: text, parentId: c.id } }); setReply(null); setOpen(true); onChange(); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <li className="text-sm" data-testid="comment-thread">
      <CommentItem c={c} meId={meId} onChange={onChange} onReply={() => setReply((r) => (r === null ? '' : r))} />
      {(replies.length > 0 || reply !== null) && (
        <div className="ml-9 mt-2 space-y-3 border-l-2 border-line pl-3">
          {replies.length > 0 && !open && <button type="button" className="text-xs font-medium text-accent-600" onClick={() => setOpen(true)} data-testid="show-replies">답글 {replies.length}개 보기</button>}
          {open && replies.map((r) => <CommentItem key={r.id} c={r} meId={meId} onChange={onChange} onReply={() => setReply((x) => (x === null ? `@${r.author_name} ` : x))} small />)}
          {reply !== null && (
            <form onSubmit={sendReply} className="flex gap-1.5" data-testid="reply-form">
              <input autoFocus className={cx(inputCls, 'h-8')} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="답글 입력" aria-label="답글"
                onKeyDown={(e) => { if (e.key === 'Escape') setReply(null); }} />
              <Button size="sm" disabled={!reply.trim()}>등록</Button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
function CommentItem({ c, meId, onChange, onReply, small }: { c: any; meId: string; onChange: () => void; onReply: () => void; small?: boolean }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const mine = c.author_id === meId;
  async function react(emoji: string) {
    setPick(false);
    try { await api(`/api/comments/${c.id}/reactions`, { body: { emoji } }); onChange(); } catch (e: any) { toast.error(e.message); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit?.trim()) return;
    try { await api(`/api/comments/${c.id}`, { method: 'PATCH', body: { body: edit } }); setEdit(null); onChange(); } catch (er: any) { toast.error(er.message); }
  }
  async function remove() {
    if (!confirm('이 댓글을 지울까요?')) return;
    try { await api(`/api/comments/${c.id}`, { method: 'DELETE' }); onChange(); } catch (e: any) { toast.error(e.message); }
  }
  if (c.deleted) return <div id={`c-${c.id}`} className="text-xs italic text-ink-3">삭제된 댓글입니다</div>;
  return (
    <div id={`c-${c.id}`} className="group flex gap-2.5 rounded-input target:bg-amber-50" data-testid="comment">
      <Avatar id={c.author_id} name={c.author_name} size={small ? 22 : 28} />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-ink-2"><b className="text-sm text-ink">{c.author_name}</b> · {fmtDateTime(c.created_at)}{c.edited_at && ' (수정됨)'}</div>
        {edit === null ? <div className="mt-0.5 whitespace-pre-wrap leading-relaxed">{renderMentions(c.body)}</div> : (
          <form onSubmit={save} className="mt-1 flex gap-1.5"><input autoFocus className={cx(inputCls, 'h-8')} value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="댓글 수정" onKeyDown={(e) => { if (e.key === 'Escape') setEdit(null); }} /><Button size="sm">저장</Button></form>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-ink-3">
          {(c.reactions ?? []).map((r: any) => (
            <button key={r.emoji} type="button" onClick={() => react(r.emoji)} title={r.names.join(', ')} aria-pressed={r.mine} data-testid="reaction"
              className={cx('inline-flex h-6 items-center gap-1 rounded-full border px-1.5', r.mine ? 'border-accent-500 bg-accent-50 text-accent-700' : 'border-line bg-white text-ink-2')}>{r.emoji}<span className="tabular-nums">{r.n}</span></button>
          ))}
          <span className="relative">
            <button type="button" onClick={() => setPick(!pick)} className="rounded px-1.5 py-0.5 hover:bg-slate-100" aria-label="반응 추가" data-testid="react-open">🙂+</button>
            {pick && <span className="absolute left-0 top-6 z-20 flex gap-0.5 rounded-full border border-line bg-white p-1 shadow-pop">
              {REACTIONS.map(([e, l]) => <button key={e} type="button" onClick={() => react(e)} title={l} aria-label={l} className="size-7 rounded-full text-base hover:bg-slate-100">{e}</button>)}
            </span>}
          </span>
          <button type="button" onClick={onReply} className="rounded px-1.5 py-0.5 font-medium hover:bg-slate-100 hover:text-ink" data-testid="reply-open">답글</button>
          {mine && edit === null && <>
            <button type="button" onClick={() => setEdit(c.body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1'))} className="rounded px-1.5 py-0.5 hover:bg-slate-100 hover:text-ink">수정</button>
            <button type="button" onClick={remove} className="rounded px-1.5 py-0.5 hover:bg-red-50 hover:text-red-600">삭제</button>
          </>}
        </div>
      </div>
    </div>
  );
}
