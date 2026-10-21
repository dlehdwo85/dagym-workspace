'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Link2, ListPlus, NotebookPen, Plus, Repeat, Trash2, Unlink, Wand2 } from 'lucide-react';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import { Avatar, Button, DueChip, Modal, StatusBadge, cx, inputCls, toast } from './ui';
import { MeetingRecorder } from './MeetingRecorder';

const ROLE_LABEL: Record<string, string> = { link: '연결', block: '업무 시간', followup: '회의 후속', prep: '준비', series: '회차 업무' };
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** 일정에 연결된 업무 목록 (미리보기·편집 공용) */
export function LinkedTaskList({ tasks, onUnlink, compact }: { tasks: any[]; onUnlink?: (t: any) => void; compact?: boolean }) {
  if (!tasks.length) return <p className="text-xs text-ink-3">연결된 업무가 없습니다</p>;
  return (
    <ul className={cx('divide-y divide-line rounded-input border border-line', compact && 'text-sm')} data-testid="linked-tasks">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
          <StatusBadge status={t.status} />
          <Link href={`/tasks/${t.id}`} className={cx('min-w-0 flex-1 truncate hover:underline', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</Link>
          {!compact && <span className="hidden rounded bg-slate-100 px-1.5 text-[11px] text-ink-2 sm:inline">{ROLE_LABEL[t.link_role] ?? '연결'}</span>}
          <DueChip due={t.due_date} status={t.status} />
          <Avatar id={t.assignee_id} name={t.assignee_name} size={20} />
          {onUnlink && t.link_role === 'link' && (
            <button type="button" className="rounded p-0.5 text-ink-3 hover:text-red-600" onClick={() => onUnlink(t)} aria-label={`${t.title} 연결 해제`}><Unlink className="size-3.5" /></button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 일정 편집 화면의 "업무" 영역 (S-1·S-2·S-8·S-9).
 * eventId: 저장된 일정 id(예외 행이면 그 id), occurrenceStart: 반복 회차
 */
export function EventWork({ eventId, occurrenceStart, eventDate, recurring, attendees, canEdit, canWork }: {
  eventId: string; occurrenceStart?: string; eventDate: string; recurring: boolean; attendees: { user_id: string; name: string }[]; canEdit: boolean; canWork: boolean;
}) {
  const { dir, user } = useSession();
  const occQ = occurrenceStart ? `?occurrenceStart=${encodeURIComponent(occurrenceStart)}` : '';
  const linked = useApi<{ tasks: any[] }>(`/api/events/${eventId}/tasks${occQ}`);
  const notes = useApi<{ body: string; updatedAt: string | null; updatedBy: string | null; canEdit: boolean }>(`/api/events/${eventId}/notes${occQ}`);
  const presets = useApi<{ presets: { id: string; label: string; items: { title: string; daysBefore: number }[] }[] }>(!recurring && canEdit ? `/api/events/${eventId}/prep` : null);
  const series = useApi<{ rules: any[] }>(recurring ? `/api/events/${eventId}/series` : null);
  const [body, setBody] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<{ title: string; assigneeId: string; dueDate: string; noteLine?: string } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [prep, setPrep] = useState({ preset: '', assigneeId: '' });
  const [rule, setRule] = useState({ title: '', daysBefore: 1, assigneeId: '' });
  // 불러온 메모는 아직 아무것도 입력하지 않았을 때만 채운다 (불러오는 순간 입력한 내용을 덮어쓰지 않게 — 최신 상태로 비교)
  useEffect(() => { if (notes.data) { const loaded = notes.data.body; setBody((b) => (b === null ? loaded : b)); } }, [notes.data]);
  const tasks = useMemo(() => linked.data?.tasks ?? [], [linked.data]);
  const followed = useMemo(() => new Set(tasks.filter((t) => t.note_line).map((t) => t.note_line.trim())), [tasks]);
  const withTitle = (id: string, name: string) => { const t = dir.users.find((x) => x.id === id)?.title; return t ? `${name} · ${t}` : name; };
  const people = (attendees.length ? attendees : dir.users.map((u) => ({ user_id: u.id, name: u.name }))).map((p) => ({ ...p, label: withTitle(p.user_id, p.name) }));
  const refresh = () => { linked.reload(); broadcastRefresh(); };

  async function saveNotes() {
    try { await api(`/api/events/${eventId}/notes`, { method: 'PUT', body: { body: body ?? '', occurrenceStart } }); notes.reload(); toast.ok('회의 메모를 저장했습니다'); } catch (e: any) { toast.error(e.message); }
  }
  async function create() {
    if (!newTask?.title.trim()) return;
    try {
      if (newTask.noteLine !== undefined && body !== notes.data?.body) await api(`/api/events/${eventId}/notes`, { method: 'PUT', body: { body: body ?? '', occurrenceStart } });
      await api(`/api/events/${eventId}/tasks`, { body: { title: newTask.title, assigneeId: newTask.assigneeId || null, dueDate: newTask.dueDate || null, noteLine: newTask.noteLine, occurrenceStart } });
      toast.ok(newTask.noteLine ? '후속 업무를 만들고 연결했습니다' : '업무를 만들고 연결했습니다');
      setNewTask(null); refresh();
    } catch (e: any) { toast.error(e.message); }
  }
  async function unlink(t: any) {
    try { await api(`/api/events/${eventId}/tasks/${t.id}`, { method: 'DELETE' }); refresh(); } catch (e: any) { toast.error(e.message); }
  }
  async function makePrep() {
    try { const r = await api(`/api/events/${eventId}/prep`, { body: { preset: prep.preset, assigneeId: prep.assigneeId || null } }); toast.ok(`준비 업무 ${r.ids.length}건을 만들었습니다`); refresh(); } catch (e: any) { toast.error(e.message); }
  }
  async function addRule() {
    if (!rule.title.trim()) return;
    try { await api(`/api/events/${eventId}/series`, { body: { title: rule.title, daysBefore: Number(rule.daysBefore), assigneeId: rule.assigneeId || null } }); toast.ok('회차마다 업무를 만들도록 설정했습니다'); setRule({ title: '', daysBefore: 1, assigneeId: '' }); series.reload(); refresh(); } catch (e: any) { toast.error(e.message); }
  }
  async function removeRule(id: string) {
    if (!confirm('이 규칙을 끌까요? 아직 시작 안 한 앞으로의 회차 업무는 정리됩니다.')) return;
    try { await api(`/api/events/${eventId}/series/${id}`, { method: 'DELETE' }); series.reload(); refresh(); } catch (e: any) { toast.error(e.message); }
  }
  const lines = (body ?? '').split('\n').map((l) => l.replace(/^\s*[-*•·]\s*/, '').trim()).filter((l) => l.length >= 2);
  const defaultDue = addDays(eventDate, 3);

  return (
    <div className="space-y-4 rounded-card border border-line bg-slate-50/60 p-4" data-testid="event-work">
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="flex flex-1 items-center gap-1.5 text-sm font-semibold"><ClipboardList className="size-4 text-ink-3" />연결 업무 <span className="text-xs font-normal text-ink-2">{tasks.length}</span></h3>
          {canWork && <Button type="button" size="sm" variant="secondary" onClick={() => setLinkOpen(true)}><Link2 />기존 업무 연결</Button>}
          {canWork && <Button type="button" size="sm" variant="secondary" onClick={() => setNewTask({ title: '', assigneeId: '', dueDate: defaultDue })}><Plus />새 업무</Button>}
        </div>
        <LinkedTaskList tasks={tasks} onUnlink={canWork ? unlink : undefined} />
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><NotebookPen className="size-4 text-ink-3" />회의 메모
          {notes.data?.updatedBy && <span className="text-xs font-normal text-ink-3">· {notes.data.updatedBy} 저장</span>}</h3>
        {canWork ? (
          <>
            <textarea className={inputCls} rows={4} value={body ?? ''} onChange={(e) => setBody(e.target.value)} data-testid="meeting-notes"
              placeholder={'결정 사항과 할 일을 한 줄씩 적으세요\n- 3월 프로모션 포스터 시안 (김디자인)\n- 런닝머신 수리 업체 견적 받기'} aria-label="회의 메모" />
            <div className="mt-1.5 flex justify-end"><Button type="button" size="sm" variant="secondary" onClick={saveNotes} disabled={body === notes.data?.body}>메모 저장</Button></div>
          </>
        ) : <p className="whitespace-pre-wrap rounded-input bg-white p-2 text-sm">{notes.data?.body || <span className="text-ink-3">메모가 없습니다</span>}</p>}
        {canWork && lines.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="note-lines">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center gap-2 rounded-input bg-white px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate">{l}</span>
                {followed.has(l) ? <span className="text-xs font-medium text-green-600">업무로 만듦</span> : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setNewTask({ title: l.replace(/\s*\([^)]*\)\s*$/, ''), assigneeId: people.find((p) => l.includes(p.name))?.user_id ?? '', dueDate: defaultDue, noteLine: l })} aria-label={`${l} 업무로 만들기`}>
                    <ListPlus />업무로
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* V30 ⑥ (#74) 녹음 → 회의록 AI 요약: 할 일 후보 [업무로] = 메모 줄과 같은 후속 업무(noteLine) */}
      <MeetingRecorder eventId={eventId} occurrenceStart={occurrenceStart} canWork={canWork} followed={followed}
        onTodo={(t) => setNewTask({ title: t.title, assigneeId: (t.assignee && people.find((p) => t.assignee!.includes(p.name))?.user_id) || '', dueDate: t.due || defaultDue, noteLine: t.title })} />

      {!recurring && canEdit && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Wand2 className="size-4 text-ink-3" />준비 업무 자동 만들기</h3>
          <div className="flex flex-wrap gap-2">
            <select className={inputCls + ' h-9 w-auto'} value={prep.preset} onChange={(e) => setPrep({ ...prep, preset: e.target.value })} aria-label="준비 업무 묶음">
              <option value="">묶음 선택</option>
              {presets.data?.presets.map((p) => <option key={p.id} value={p.id}>{p.label} — {p.items.map((x) => `D-${x.daysBefore} ${x.title}`).join(', ')}</option>)}
            </select>
            <select className={inputCls + ' h-9 w-auto'} value={prep.assigneeId} onChange={(e) => setPrep({ ...prep, assigneeId: e.target.value })} aria-label="준비 업무 담당자">
              <option value="">담당자 (나)</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.label}</option>)}
            </select>
            <Button type="button" size="sm" onClick={makePrep} disabled={!prep.preset}>만들기</Button>
          </div>
          <p className="mt-1 text-xs text-ink-2">일정 날짜를 옮기면 아직 끝나지 않은 준비 업무의 마감도 함께 옮겨집니다.</p>
        </section>
      )}

      {recurring && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Repeat className="size-4 text-ink-3" />회차마다 만드는 업무</h3>
          <ul className="mb-2 space-y-1">
            {series.data?.rules.filter((r) => r.active).map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-input bg-white px-2.5 py-1.5 text-sm">
                <span className="flex-1">{r.title} <span className="text-xs text-ink-2">· 회의 {r.days_before}일 전 마감 · {r.assignee_name ?? '만든 사람'}</span></span>
                {canEdit && <button type="button" onClick={() => removeRule(r.id)} className="rounded p-0.5 text-ink-3 hover:text-red-600" aria-label={`${r.title} 규칙 끄기`}><Trash2 className="size-3.5" /></button>}
              </li>
            ))}
            {!series.data?.rules.some((r) => r.active) && <li className="text-xs text-ink-3">예: 매주 회의 하루 전까지 “주간 보고 작성”</li>}
          </ul>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <input className={inputCls + ' h-9 min-w-[160px] flex-1'} value={rule.title} onChange={(e) => setRule({ ...rule, title: e.target.value })} placeholder="업무 제목 (예: 주간 보고 작성)" aria-label="회차 업무 제목" />
              <select className={inputCls + ' h-9 w-auto'} value={rule.daysBefore} onChange={(e) => setRule({ ...rule, daysBefore: Number(e.target.value) })} aria-label="회의 며칠 전 마감">
                {[0, 1, 2, 3, 5, 7].map((n) => <option key={n} value={n}>{n ? `${n}일 전 마감` : '당일 마감'}</option>)}
              </select>
              <select className={inputCls + ' h-9 w-auto'} value={rule.assigneeId} onChange={(e) => setRule({ ...rule, assigneeId: e.target.value })} aria-label="회차 업무 담당자">
                <option value="">담당자 (나)</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.label}</option>)}
              </select>
              <Button type="button" size="sm" onClick={addRule}>추가</Button>
            </div>
          )}
          <p className="mt-1 text-xs text-ink-2">앞으로 2주 안의 회차마다 1건씩 만들고, 회차가 취소되면 그 업무도 정리합니다.</p>
        </section>
      )}

      <Modal open={!!newTask} onClose={() => setNewTask(null)} title={newTask?.noteLine ? '회의 후속 업무' : '일정에서 업무 만들기'}>
        {newTask && (
          <div className="space-y-3">
            <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">제목</span>
              <input className={inputCls} value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} autoFocus /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">담당자{attendees.length ? ' (참석자)' : ''}</span>
                <select className={inputCls} value={newTask.assigneeId} onChange={(e) => setNewTask({ ...newTask, assigneeId: e.target.value })}>
                  <option value="">미정</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.label}</option>)}
                  {attendees.length > 0 && <option disabled>──────</option>}
                  {attendees.length > 0 && dir.users.filter((u) => !attendees.some((a) => a.user_id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
                </select></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">마감일</span>
                <input type="date" className={inputCls} value={newTask.dueDate} onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })} /></label>
            </div>
            <p className="text-xs text-ink-2">만든 업무는 이 일정에 자동으로 연결되고 담당자에게 알림이 갑니다.{user.role === 'staff' ? ' 소속은 담당자의 현장으로 정해집니다.' : ''}</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setNewTask(null)}>취소</Button><Button type="button" onClick={create}>만들기</Button></div>
          </div>
        )}
      </Modal>
      <LinkTaskModal open={linkOpen} onClose={() => setLinkOpen(false)} eventId={eventId} occurrenceStart={occurrenceStart} exclude={tasks.map((t) => t.id)} onLinked={() => { setLinkOpen(false); refresh(); }} />
    </div>
  );
}

function LinkTaskModal({ open, onClose, eventId, occurrenceStart, exclude, onLinked }: { open: boolean; onClose: () => void; eventId: string; occurrenceStart?: string; exclude: string[]; onLinked: () => void }) {
  const [q, setQ] = useState('');
  const list = useApi<{ tasks: any[] }>(open ? `/api/tasks?includeDone=0&limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}` : null, [q]);
  async function link(id: string) {
    try { await api(`/api/events/${eventId}/tasks`, { body: { taskId: id, ...(occurrenceStart ? { occurrenceStart } : {}) } }); toast.ok('업무를 연결했습니다'); onLinked(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="기존 업무 연결">
      <input className={inputCls} placeholder="업무 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="연결할 업무 검색" autoFocus />
      <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto">
        {list.data?.tasks.filter((t) => !exclude.includes(t.id)).map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
            <StatusBadge status={t.status} /><span className="min-w-0 flex-1 truncate">{t.title}</span><DueChip due={t.due_date} status={t.status} />
            <Button type="button" size="sm" variant="secondary" onClick={() => link(t.id)} aria-label={`${t.title} 연결`}>연결</Button>
          </li>
        ))}
        {list.data && !list.data.tasks.length && <li className="py-6 text-center text-sm text-ink-3">검색 결과가 없습니다</li>}
      </ul>
    </Modal>
  );
}

