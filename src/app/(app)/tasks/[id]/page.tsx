'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Loading, Modal, StatusBadge, cx, dueClass, fmtDate, fmtDateTime, inputCls, toast } from '@/components/ui';
import { BrandSelect, MultiUserSelect, RecurSelect, UnitSelect, UserSelect } from '@/components/pickers';
import { Attachments } from '@/components/Attachments';
import { QuickAddTask } from '@/components/QuickAddTask';
import { PRIORITY_LABEL, STATUS_LABEL, STATUSES } from '@/lib/types';

const ACTION_LABEL: Record<string, string> = {
  created: '업무 생성', updated: '수정', review_requested: '검토 요청', approved: '최종 완료 확인', review_rejected: '보완 요청', completed: '완료',
  reopened: '다시 열기', deleted: '삭제', comment_edited: '댓글 수정', comment_deleted: '댓글 삭제', checklist_added: '체크리스트 추가',
  checklist_done: '체크리스트 완료', checklist_undone: '체크리스트 해제', checklist_removed: '체크리스트 삭제', checklist_edited: '체크리스트 수정',
  file_attached: '파일 첨부', link_attached: '문서 링크 연결', attachment_removed: '첨부 삭제', recurring_created: '반복 회차 생성',
};
const FIELD_LABEL: Record<string, string> = {
  title: '제목', description: '설명', assigneeId: '담당자', priority: '우선순위', startDate: '시작일', dueDate: '마감일', dueTime: '마감 시각', status: '상태',
  tags: '태그', projectId: '프로젝트', brandId: '브랜드', orgUnitId: '소속', collaborators: '협업자', approvalRequired: '검토 필요', recurrenceRule: '반복', dependsOn: '선행 업무',
};

export default function TaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<any>(`/api/tasks/${id}`);
  const projects = useApi<{ projects: any[] }>('/api/projects');
  const [comment, setComment] = useState('');
  const [sub, setSub] = useState(false);
  const [desc, setDesc] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [newItem, setNewItem] = useState('');
  const [blockOpen, setBlockOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);

  useEffect(() => {
    if (!data) return;
    const h = location.hash;
    if (h) setTimeout(() => document.querySelector(h)?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [data]);

  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading && !data) return <Loading />;
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
    try {
      await api(`/api/tasks/${id}/comments`, { body: { body: comment }, queueOffline: '댓글' });
      setComment(''); reload();
    } catch (e: any) { if (e.code === 'queued') { toast.info(e.message); setComment(''); } else toast.error(e.message); }
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
    try { await api(`/api/tasks/${id}`, { method: 'DELETE' }); toast.ok('삭제했습니다'); broadcastRefresh(); router.push('/tasks'); } catch (e: any) { toast.error(e.message); }
  }
  async function saveTemplate() {
    const name = prompt('템플릿 이름', t.title);
    if (!name) return;
    try { await api('/api/templates', { body: { name, fromTaskId: id, orgUnitId: t.org_unit_id } }); toast.ok('템플릿으로 저장했습니다'); } catch (e: any) { toast.error(e.message); }
  }

  const isAssignee = t.assignee_id === user.id;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="text-xs text-slate-500">
        <Link href="/tasks" className="hover:underline">업무</Link>
        {t.project_name && <> · <Link href={`/projects/${t.project_id}`} className="hover:underline">{t.project_name}</Link></>}
        {t.parent_id && <> · <Link href={`/tasks/${t.parent_id}`} className="hover:underline">상위: {t.parent_title}</Link></>}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="flex flex-wrap items-start gap-2">
          {title === null ? (
            <h1 className={cx('flex-1 text-xl font-bold', perms.edit && 'cursor-text hover:bg-slate-50')} onClick={() => perms.edit && setTitle(t.title)} data-testid="task-title">{t.title}</h1>
          ) : (
            <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); patch({ title }); setTitle(null); }}>
              <input autoFocus className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button size="sm">저장</Button><Button size="sm" variant="ghost" type="button" onClick={() => setTitle(null)}>취소</Button>
            </form>
          )}
          <StatusBadge status={t.status} />
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5" data-testid="task-actions">
          {t.status !== 'done' && t.status !== 'review' && t.approval_required && !perms.approve && (
            <Button size="sm" onClick={() => patch({ status: 'review' }, '검토를 요청했습니다')}>완료 → 검토 요청</Button>
          )}
          {t.status !== 'done' && (!t.approval_required || perms.approve) && (
            <Button size="sm" onClick={() => patch({ status: 'done' }, t.status === 'review' ? '최종 완료 확인했습니다' : '완료 처리했습니다')}>{t.status === 'review' ? '최종 완료 확인' : '완료'}</Button>
          )}
          {t.status === 'review' && perms.approve && <Button size="sm" variant="secondary" onClick={reject}>보완 요청</Button>}
          {t.status === 'todo' && <Button size="sm" variant="secondary" onClick={() => patch({ status: 'in_progress' })}>시작</Button>}
          {t.status !== 'on_hold' && t.status !== 'done' && <Button size="sm" variant="secondary" onClick={() => patch({ status: 'on_hold' })}>보류</Button>}
          {(t.status === 'on_hold' || t.status === 'done') && <Button size="sm" variant="secondary" onClick={() => patch({ status: 'in_progress' })}>다시 진행</Button>}
          <select className="rounded-md border px-2 text-sm" value={t.status} onChange={(e) => patch({ status: e.target.value })} aria-label="상태 직접 변경">
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setBlockOpen(true)}>실행 시간 배정</Button>
          {perms.approve && <Button size="sm" variant="ghost" onClick={saveTemplate}>템플릿으로 저장</Button>}
          {perms.delete && <Button size="sm" variant="ghost" className="text-red-600" onClick={del}>삭제</Button>}
        </div>
        {t.status === 'review' && <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-800">검토 요청 중 — {fmtDateTime(t.review_requested_at)} · 관리자의 최종 확인을 기다립니다.</p>}
        {t.status === 'done' && t.approved_by_name && <p className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-800">{t.approved_by_name}님이 {fmtDateTime(t.approved_at)}에 최종 완료를 확인했습니다.</p>}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="담당자"><UserSelect value={t.assignee_id} onChange={(v) => patch({ assigneeId: v })} /></Field>
          <Field label="시작일"><input type="date" className={inputCls} value={t.start_date ?? ''} onChange={(e) => patch({ startDate: e.target.value || null })} /></Field>
          <Field label="마감일">
            <div className="flex gap-1">
              <input type="date" className={cx(inputCls, dueClass(t.due_date, t.status))} value={t.due_date ?? ''} onChange={(e) => patch({ dueDate: e.target.value || null })} data-testid="detail-due" />
              <input type="time" className={cx(inputCls, 'w-28')} value={t.due_time ?? ''} onChange={(e) => patch({ dueTime: e.target.value || null })} aria-label="마감 시각" />
            </div>
          </Field>
          <Field label="우선순위">
            <select className={inputCls} value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="브랜드"><BrandSelect value={t.brand_id} onChange={(v) => patch({ brandId: v })} /></Field>
          <Field label="소속 (현장·부서)"><UnitSelect value={t.org_unit_id} onChange={(v) => patch({ orgUnitId: v })} /></Field>
          <Field label="프로젝트">
            <select className={inputCls} value={t.project_id ?? ''} onChange={(e) => patch({ projectId: e.target.value || null })}>
              <option value="">없음</option>{projects.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="반복"><RecurSelect value={t.recurrence_rule} onChange={(v) => patch({ recurrenceRule: v })} anchorDate={t.due_date} /></Field>
          <Field label="태그 (쉼표)">
            <input className={inputCls} defaultValue={t.tags.join(', ')} onBlur={(e) => { const v = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); if (v.join() !== t.tags.join()) patch({ tags: v }); }} />
          </Field>
        </div>
        <div className="mt-3">
          <div><div className="mb-1 text-xs font-medium text-slate-600">협업자</div><MultiUserSelect value={data.collaborators.map((c: any) => c.id)} onChange={(v) => patch({ collaboratorIds: v })} /></div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={t.approval_required} disabled={!perms.approve} onChange={(e) => patch({ approvalRequired: e.target.checked })} />
          완료 시 관리자 최종 확인 필요 {!perms.approve && <span className="text-xs text-slate-400">(관리자만 변경)</span>}
        </label>

        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-slate-600">설명</div>
          {desc === null ? (
            <div className="min-h-[48px] cursor-text whitespace-pre-wrap rounded-md border border-transparent p-2 text-sm hover:border-slate-200" onClick={() => setDesc(t.description)}>
              {t.description || <span className="text-slate-400">설명을 추가하려면 누르세요</span>}
            </div>
          ) : (
            <div>
              <textarea autoFocus rows={6} className={inputCls} value={desc} onChange={(e) => setDesc(e.target.value)} />
              <div className="mt-1 flex gap-1"><Button size="sm" onClick={() => { patch({ description: desc }); setDesc(null); }}>저장</Button><Button size="sm" variant="ghost" onClick={() => setDesc(null)}>취소</Button></div>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">체크리스트 {data.checklist.length > 0 && <span className="text-slate-400">{data.checklist.filter((c: any) => c.done).length}/{data.checklist.length}</span>}</h2>
          <ul className="space-y-1" data-testid="checklist">
            {data.checklist.map((c: any) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.done} onChange={async (e) => { await api(`/api/checklist/${c.id}`, { method: 'PATCH', body: { done: e.target.checked } }).catch((er) => toast.error(er.message)); reload(); }} aria-label={c.text} />
                <span className={cx('flex-1', c.done && 'text-slate-400 line-through')}>{c.text}</span>
                <button className="text-xs text-slate-400 hover:text-red-600" onClick={async () => { await api(`/api/checklist/${c.id}`, { method: 'DELETE' }); reload(); }} aria-label="항목 삭제">✕</button>
              </li>
            ))}
          </ul>
          <form className="mt-2 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; await api(`/api/tasks/${id}/checklist`, { body: { text: newItem } }).catch((er) => toast.error(er.message)); setNewItem(''); reload(); }}>
            <input className={inputCls} placeholder="항목 추가" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
            <Button size="sm" variant="secondary">추가</Button>
          </form>
        </section>

        <section className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">하위 업무</h2><Button size="sm" variant="secondary" onClick={() => setSub(true)}>+ 추가</Button></div>
          <ul className="divide-y">
            {data.subtasks.map((s: any) => (
              <li key={s.id} className="flex items-center gap-2 py-1.5 text-sm">
                <StatusBadge status={s.status} />
                <Link href={`/tasks/${s.id}`} className="flex-1 truncate hover:underline">{s.title}</Link>
                <span className="text-xs text-slate-500">{s.assignee_name}</span>
                <span className={cx('text-xs', dueClass(s.due_date, s.status))}>{fmtDate(s.due_date)}</span>
              </li>
            ))}
            {!data.subtasks.length && <li className="text-xs text-slate-400">없음</li>}
          </ul>
          <div className="mt-4 flex items-center justify-between"><h2 className="text-sm font-semibold">선행 업무 (의존관계)</h2><Button size="sm" variant="secondary" onClick={() => setDepOpen(true)}>편집</Button></div>
          <ul className="mt-1 space-y-1 text-sm">
            {data.dependencies.map((d: any) => (
              <li key={d.id} className="flex items-center gap-2"><StatusBadge status={d.status} /><Link className="hover:underline" href={`/tasks/${d.id}`}>{d.title}</Link></li>
            ))}
            {!data.dependencies.length && <li className="text-xs text-slate-400">없음 — 선행 업무가 끝나야 완료할 수 있게 하려면 추가하세요</li>}
          </ul>
        </section>
      </div>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">자료·첨부</h2>
        <Attachments items={data.attachments} taskId={id} canEdit={perms.approve} onChange={reload} meId={user.id} />
      </section>

      {data.timeBlocks.length > 0 && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">배정된 실행 시간</h2>
          <ul className="text-sm">{data.timeBlocks.map((b: any) => <li key={b.id}><Link className="hover:underline" href={`/calendar?event=${b.id}`}>{fmtDateTime(b.start_at)} ~ {fmtDateTime(b.end_at)}</Link></li>)}</ul>
        </section>
      )}

      <section className="rounded-lg border bg-white p-4" id="comments">
        <h2 className="mb-2 text-sm font-semibold">댓글</h2>
        <ul className="space-y-3" data-testid="comments">
          {data.comments.map((c: any) => (
            <li key={c.id} id={`c-${c.id}`} className="text-sm">
              <div className="text-xs text-slate-500"><b className="text-slate-700">{c.author_name}</b> · {fmtDateTime(c.created_at)}{c.edited_at && ' (수정됨)'}</div>
              <div className="whitespace-pre-wrap">{renderMentions(c.body)}</div>
            </li>
          ))}
          {!data.comments.length && <li className="text-xs text-slate-400">아직 댓글이 없습니다</li>}
        </ul>
        <form onSubmit={sendComment} className="mt-3 space-y-1.5">
          <textarea className={inputCls} rows={2} placeholder="댓글 입력 (사람을 언급하려면 아래 '멘션' 선택)" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="comment-input" />
          <div className="flex items-center gap-2">
            <select className="rounded-md border px-2 py-1 text-xs" value="" onChange={(e) => { const u = dir.users.find((x) => x.id === e.target.value); if (u) setComment((c) => `${c}${c && !c.endsWith(' ') ? ' ' : ''}@[${u.name}](${u.id}) `); }} aria-label="멘션할 사람">
              <option value="">@ 멘션</option>{dir.users.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <span className="flex-1" />
            <Button size="sm" type="submit">등록</Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">변경 이력</h2>
        <ul className="space-y-1 text-xs text-slate-600" data-testid="history">
          {data.history.map((h: any) => (
            <li key={h.id}>
              <span className="text-slate-400">{fmtDateTime(h.created_at)}</span> · <b>{h.actor_name ?? '시스템'}</b> · {ACTION_LABEL[h.action] ?? h.action}
              {h.action !== 'created' && Object.entries(h.changes ?? {}).filter(([k, v]: any) => FIELD_LABEL[k] && v && typeof v === 'object' && 'to' in v).map(([k, v]: any) => (
                <span key={k} className="ml-1">[{FIELD_LABEL[k]}: {fmtVal(k, v?.from, userName)} → {fmtVal(k, v?.to, userName)}]</span>
              ))}
              {h.changes?.note && <span className="ml-1">“{h.changes.note}”</span>}
              {['file_attached', 'link_attached', 'attachment_removed', 'checklist_added', 'checklist_done', 'checklist_undone', 'checklist_removed'].includes(h.action) && <span className="ml-1">{h.changes?.name ?? h.changes?.title ?? h.changes?.text}</span>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">작성: {t.created_by_name} · {fmtDateTime(t.created_at)}</p>
      </section>

      <QuickAddTask open={sub} onClose={() => setSub(false)} defaults={{ parentId: id, dueDate: t.due_date ?? undefined, assigneeId: t.assignee_id ?? undefined }} onCreated={() => reload()} />
      <TimeBlockModal open={blockOpen} onClose={() => setBlockOpen(false)} task={t} onDone={reload} />
      <DepsModal open={depOpen} onClose={() => setDepOpen(false)} taskId={id} current={data.dependencies.map((d: any) => d.id)} onSave={(ids) => { patch({ dependsOn: ids }); setDepOpen(false); }} />
      {isAssignee && null}
    </div>
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

function TimeBlockModal({ open, onClose, task, onDone }: { open: boolean; onClose: () => void; task: any; onDone: () => void }) {
  const cals = useApi<{ calendars: any[] }>(open ? '/api/calendars' : null);
  const [f, setF] = useState({ date: '', start: '09:00', end: '10:00', calendarId: '' });
  const [conf, setConf] = useState<any[]>([]);
  useEffect(() => { if (open) setF({ date: task.due_date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), start: '09:00', end: '10:00', calendarId: '' }); }, [open, task.due_date]);
  const personal = cals.data?.calendars.find((c) => c.type === 'personal');
  const iso = (d: string, t: string) => `${d}T${t}:00+09:00`;
  useEffect(() => {
    if (!open || !f.date) return;
    api(`/api/events/conflicts?start=${encodeURIComponent(iso(f.date, f.start))}&end=${encodeURIComponent(iso(f.date, f.end))}`).then((r) => setConf(r.conflicts)).catch(() => {});
  }, [open, f.date, f.start, f.end]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/events', { body: { calendarId: f.calendarId || personal?.id, title: `[업무] ${task.title}`, start: iso(f.date, f.start), end: iso(f.date, f.end), taskId: task.id, kind: 'task_block' } });
      toast.ok('캘린더에 실행 시간을 배정했습니다'); onClose(); onDone(); broadcastRefresh();
    } catch (er: any) { toast.error(er.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="업무 실행 시간 배정">
      <form onSubmit={save} className="space-y-3">
        <p className="text-xs text-slate-500">업무 마감일과 별도로, 실제로 일할 시간을 캘린더에 잡아 둡니다.</p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="날짜"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
          <Field label="시작"><input type="time" className={inputCls} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></Field>
          <Field label="종료"><input type="time" className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></Field>
        </div>
        <Field label="캘린더">
          <select className={inputCls} value={f.calendarId || personal?.id || ''} onChange={(e) => setF({ ...f, calendarId: e.target.value })}>
            {cals.data?.calendars.filter((c) => c.perms.edit).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {conf.length > 0 && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">겹치는 일정: {conf.map((c) => `${c.title}(${fmtDateTime(c.start)})`).join(', ')}</p>}
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
