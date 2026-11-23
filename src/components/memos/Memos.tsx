'use client';
// #1135 메모 · 주요 메모(대표 11/23 · 설계 docs/research/SECURE_MEMO_DESIGN_2026-11-23.md)
// 메모마다 볼 사람(사람·부서, 보기/고치기)을 정한다. 기본은 나만. 주요 메모의 아이디·비밀번호·참고는 ●●●● 로 가려 두고,
// [보기]·[복사]는 본인 확인(10분) 뒤에만 서버에서 그 칸만 받아 30초 보여 주고 지운다. 복사한 값은 30초 뒤 클립보드를 비운다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArchiveRestore, Copy, Eye, EyeOff, ExternalLink, History, KeyRound, Lock, LockOpen, NotebookPen, Plus, Search, StickyNote, Trash2, Users } from 'lucide-react';
import { ApiError, api, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, askConfirm, cx, fmtDate, fmtDateTime, inputCls, toast } from '@/components/ui';

type Level = 'view' | 'edit';
type Kind = 'note' | 'secret';
type Row = { id: string; kind: Kind; title: string; preview: string | null; site_url: string | null; updated_at: string; deleted_at: string | null; creator_name: string | null; level: Level; share_users: number; share_units: number };
type Access = { userId?: string | null; unitId?: string | null; level: Level; name?: string; kind?: 'user' | 'unit'; inactive?: boolean };
type Detail = { memo: { id: string; kind: Kind; title: string; body: string | null; siteUrl: string | null; creatorName: string | null; createdAt: string; updatedAt: string; updaterName: string | null; level: Level; isCreator: boolean }; access: Access[]; unlockedUntil: string | null };
type Status = { secretReady: boolean; unlockedUntil: string | null; method: 'totp' | 'password' | 'relogin'; unlockMinutes: number };
type People = { users: { id: string; name: string; email: string }[]; units: { id: string; name: string; parent_id: string | null }[] };
type Field3 = 'username' | 'password' | 'note';
const FIELD_LABEL: Record<Field3, string> = { username: '아이디', password: '비밀번호', note: '참고' };
const SHOW_MS = 30_000;

const shareText = (u: number, o: number) => (u + o === 0 ? '나만' : [u ? `${u}명` : '', o ? `부서 ${o}곳` : ''].filter(Boolean).join(', '));
const openUrl = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);

/** 본인 확인 상태(남은 시간) — 화면 어디서든 같은 값 */
function useUnlock(initial: string | null | undefined) {
  const [until, setUntil] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { if (initial !== undefined) setUntil(initial ? Date.parse(initial) : null); }, [initial]);
  useEffect(() => { if (!until) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [until]);
  const left = until ? Math.max(0, until - Date.now()) : 0;
  return { left, open: left > 0, set: (iso: string | null) => setUntil(iso ? Date.parse(iso) : null) };
}

export function MemosHome() {
  const [tab, setTab] = useState<'all' | Kind | 'trash'>('all');
  const [q, setQ] = useState('');
  const qs = useMemo(() => { const p = new URLSearchParams(); if (tab === 'note' || tab === 'secret') p.set('kind', tab); if (tab === 'trash') p.set('deleted', '1'); if (q.trim()) p.set('q', q.trim()); return p.toString(); }, [tab, q]);
  const list = useApi<{ memos: Row[]; secretReady: boolean }>(`/api/memos${qs ? `?${qs}` : ''}`, [qs]);
  const status = useApi<Status>('/api/memos/status');
  const unlock = useUnlock(status.data ? status.data.unlockedUntil : undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState<Kind | null>(null);
  const [askUnlock, setAskUnlock] = useState<null | ((ok: boolean) => void)>(null);
  /** 잠겨 있으면 본인 확인 창을 띄우고, 확인되면 true */
  const ensureUnlocked = useCallback(() => new Promise<boolean>((res) => { if (unlock.open) return res(true); setAskUnlock(() => res); }), [unlock.open]);
  const ready = status.data?.secretReady ?? list.data?.secretReady ?? false;
  const rows = list.data?.memos ?? [];
  const tabs: [typeof tab, string][] = [['all', '전체'], ['note', '일반 메모'], ['secret', '주요 메모'], ['trash', '휴지통']];

  return (
    <div className="mx-auto max-w-3xl" data-testid="memos-page">
      <PageHeader title="메모" icon={NotebookPen} sub="메모마다 볼 사람을 정합니다. 처음에는 나만 봅니다. 대표·관리자도 공유받지 않으면 보지 못합니다."
        actions={<>
          <Button variant="secondary" onClick={() => setCreate('note')} data-testid="memo-new-note"><Plus />일반 메모</Button>
          <Button onClick={() => setCreate('secret')} disabled={!ready} title={ready ? undefined : '주요 메모 암호화 키가 아직 설정되지 않았습니다'} data-testid="memo-new-secret"><KeyRound />주요 메모</Button>
        </>} />
      {!ready && status.data && <p className="mb-3 rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="memo-vault-off">주요 메모(아이디·비밀번호)는 플랫폼 관리자가 암호화 키를 넣은 뒤 쓸 수 있습니다. 일반 메모는 지금 쓸 수 있습니다.</p>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-input border border-line bg-white p-0.5 text-sm shadow-card" role="tablist" aria-label="메모 종류">
          {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`memo-tab-${k}`}
            className={cx('shrink-0 rounded-md px-2.5 py-1.5 font-medium', tab === k ? 'bg-brand-600 text-white shadow-card' : 'text-ink-2 hover:bg-slate-100')}>{l}</button>)}
        </div>
        <label className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·사이트 주소로 찾기" className={cx(inputCls, 'pl-8')} data-testid="memo-search" aria-label="메모 찾기" />
        </label>
        <UnlockBadge unlock={unlock} onLock={async () => { await api('/api/memos/unlock', { method: 'DELETE' }).catch(() => {}); unlock.set(null); }} />
      </div>
      {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Skeleton rows={5} /> : rows.length === 0 ? (
        <Empty title={tab === 'trash' ? '휴지통이 비어 있습니다' : q ? '찾는 메모가 없습니다' : '아직 메모가 없습니다'} icon={NotebookPen}>
          {tab === 'trash' ? '지운 메모는 30일 동안 여기 있다가 완전히 지워집니다.' : '사이트 아이디·비밀번호는 [주요 메모]에, 나머지는 [일반 메모]에 적어 두세요.'}
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="memo-list">
          {rows.map((m) => (
            <li key={m.id}>
              <button onClick={() => (tab === 'trash' ? null : setOpen(m.id))} className={cx('flex w-full items-start gap-3 px-3 py-2.5 text-left', tab !== 'trash' && 'hover:bg-slate-50')} data-testid="memo-row" data-kind={m.kind}>
                {m.kind === 'secret' ? <KeyRound className="mt-0.5 size-4 shrink-0 text-ink-3" aria-label="주요 메모" /> : <StickyNote className="mt-0.5 size-4 shrink-0 text-ink-3" aria-label="일반 메모" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink" data-testid="memo-row-title">{m.title}</span>
                  <span className="block truncate text-xs text-ink-3">{m.kind === 'secret' ? (m.site_url || '사이트 주소 없음') : (m.preview || '내용 없음')}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-ink-3">
                  <span className="flex items-center justify-end gap-1" data-testid="memo-row-share"><Users className="size-3.5" />{shareText(m.share_users, m.share_units)}</span>
                  <span className="block">{fmtDate(m.deleted_at ?? m.updated_at)}{m.level === 'view' ? ' · 보기만' : ''}</span>
                </span>
              </button>
              {tab === 'trash' && <div className="-mt-1 flex justify-end px-3 pb-2"><Button size="sm" variant="secondary" data-testid="memo-restore" onClick={async () => {
                try { await api(`/api/memos/${m.id}/restore`, { method: 'POST' }); toast.ok('되살렸습니다'); list.reload(); } catch (e) { toast.error((e as Error).message); }
              }}><ArchiveRestore />되살리기</Button></div>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-3">주요 메모의 아이디·비밀번호는 암호화해 저장하고, 볼 때마다 기록이 남습니다. AI·알림·메일·내보내기에는 들어가지 않습니다.</p>

      {open && <MemoDetail id={open} status={status.data} unlock={unlock} ensureUnlocked={ensureUnlocked} onClose={() => setOpen(null)} onChanged={() => list.reload()} />}
      {create && <MemoCreate kind={create} onClose={() => setCreate(null)} onDone={(id) => { setCreate(null); list.reload(); setOpen(id); }} />}
      {askUnlock && <UnlockDialog status={status.data} onClose={(ok, until) => { if (ok) unlock.set(until ?? null); const r = askUnlock; setAskUnlock(null); r(ok); }} />}
    </div>
  );
}

function UnlockBadge({ unlock, onLock }: { unlock: ReturnType<typeof useUnlock>; onLock: () => void }) {
  if (!unlock.open) return null;
  const s = Math.ceil(unlock.left / 1000);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-input border border-line bg-white px-2 py-1 text-xs text-ink-2" data-testid="memo-unlocked">
      <LockOpen className="size-3.5" />본인 확인됨 · {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')} 남음
      <button onClick={onLock} className="ml-1 rounded px-1 font-medium text-brand-700 hover:bg-slate-100" data-testid="memo-lock">잠그기</button>
    </span>
  );
}

function UnlockDialog({ status, onClose }: { status: Status | null; onClose: (ok: boolean, until?: string | null) => void }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const method = status?.method ?? 'password';
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api<{ unlockedUntil: string | null }>('/api/memos/unlock', { body: method === 'totp' ? { code: v } : method === 'password' ? { password: v } : {} });
      onClose(true, r.unlockedUntil);
    } catch (e) { setErr((e as Error).message); setV(''); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={() => onClose(false)} title="본인 확인">
      <div className="space-y-3" data-testid="memo-unlock">
        <p className="text-sm text-ink-2">주요 메모를 보거나 고치려면 본인 확인이 필요합니다. 확인하면 {status?.unlockMinutes ?? 10}분 동안 다시 묻지 않습니다.</p>
        {method === 'relogin' ? (
          <p className="rounded-input bg-slate-50 px-3 py-2 text-sm text-ink-2">소셜 계정(비밀번호 없음)은 로그아웃 후 다시 로그인하고 10분 안에 [확인]을 누르면 됩니다.</p>
        ) : (
          <Field label={method === 'totp' ? '2단계 인증 코드(OTP 앱 6자리)' : '내 워크인 비밀번호'}>
            <input autoFocus type={method === 'totp' ? 'text' : 'password'} inputMode={method === 'totp' ? 'numeric' : undefined} autoComplete={method === 'totp' ? 'one-time-code' : 'current-password'}
              value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v) go(); }} className={inputCls} data-testid="memo-unlock-input" />
          </Field>
        )}
        {err && <p className="text-sm text-red-700" role="alert" data-testid="memo-unlock-error">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onClose(false)}>취소</Button>
          <Button onClick={go} disabled={busy || (method !== 'relogin' && !v)} data-testid="memo-unlock-go">확인</Button>
        </div>
      </div>
    </Modal>
  );
}

/** 칸 하나: ●●●● → [보기] 30초 / [복사] 뒤 30초에 클립보드 비우기 */
function SecretField({ memoId, field, ensureUnlocked, onUnlocked }: { memoId: string; field: Field3; ensureUnlocked: () => Promise<boolean>; onUnlocked: (iso: string | null) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const fetchValue = async (purpose: 'view' | 'copy'): Promise<string | null> => {
    for (let i = 0; i < 2; i++) {
      try {
        const r = await api<{ values: Record<Field3, string>; unlockedUntil: string }>(`/api/memos/${memoId}/reveal`, { body: { fields: [field], purpose } });
        onUnlocked(r.unlockedUntil);
        return r.values[field] ?? '';
      } catch (e) {
        if (e instanceof ApiError && e.code === 'memo_locked' && i === 0) { if (!(await ensureUnlocked())) return null; continue; }
        toast.error((e as Error).message); return null;
      }
    }
    return null;
  };
  const view = async () => {
    if (shown !== null) { setShown(null); return; }
    const v = await fetchValue('view'); if (v === null) return;
    setShown(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), SHOW_MS);
  };
  const copy = async () => {
    const v = await fetchValue('copy'); if (v === null) return;
    try {
      await navigator.clipboard.writeText(v);
      toast.ok(`${FIELD_LABEL[field]}을(를) 복사했습니다 — 30초 뒤 클립보드를 비웁니다`);
      setTimeout(() => { navigator.clipboard.writeText('').catch(() => {}); }, SHOW_MS);
    } catch { toast.error('복사하지 못했습니다 — [보기]로 확인해 주세요'); }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2 last:border-0" data-testid={`memo-secret-${field}`}>
      <span className="w-16 shrink-0 text-xs text-ink-3">{FIELD_LABEL[field]}</span>
      <span className={cx('min-w-[8rem] flex-1 break-all text-sm', shown === null ? 'tracking-widest text-ink-3' : 'font-mono text-ink')} data-testid={`memo-secret-${field}-value`}>
        {shown === null ? '●●●●●●' : shown || '(비어 있음)'}
      </span>
      <span className="flex shrink-0 gap-1">
        <Button size="sm" variant="secondary" onClick={view} data-testid={`memo-view-${field}`}>{shown === null ? <><Eye />보기</> : <><EyeOff />가리기</>}</Button>
        {field !== 'note' && <Button size="sm" variant="secondary" onClick={copy} data-testid={`memo-copy-${field}`}><Copy />복사</Button>}
      </span>
    </div>
  );
}

function MemoDetail({ id, status, unlock, ensureUnlocked, onClose, onChanged }: { id: string; status: Status | null; unlock: ReturnType<typeof useUnlock>; ensureUnlocked: () => Promise<boolean>; onClose: () => void; onChanged: () => void }) {
  const d = useApi<Detail>(`/api/memos/${id}`, [id]);
  const [edit, setEdit] = useState<null | { title: string; body: string; siteUrl: string; username?: string; password?: string; note?: string; secret: boolean }>(null);
  const [share, setShare] = useState<Access[] | null>(null);
  const [log, setLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const m = d.data?.memo;
  const canEdit = m?.level === 'edit';
  const save = async () => {
    if (!edit || !m) return;
    setBusy(true);
    try {
      const body: Record<string, string> = { title: edit.title };
      if (m.kind === 'note') body.body = edit.body; else body.siteUrl = edit.siteUrl;
      if (edit.secret) { body.username = edit.username ?? ''; body.password = edit.password ?? ''; body.note = edit.note ?? ''; }
      await api(`/api/memos/${m.id}`, { method: 'PATCH', body });
      toast.ok('저장했습니다'); setEdit(null); d.reload(); onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'memo_locked') { if (await ensureUnlocked()) await save(); }
      else toast.error((e as Error).message);
    } finally { setBusy(false); }
  };
  /** 아이디·비밀번호 고치기: 본인 확인 → 지금 값을 받아 칸에 채움(값은 이 창 안에서만) */
  const editSecret = async () => {
    if (!m) return;
    if (!(await ensureUnlocked())) return;
    try {
      const r = await api<{ values: Record<Field3, string>; unlockedUntil: string }>(`/api/memos/${m.id}/reveal`, { body: { fields: ['username', 'password', 'note'], purpose: 'view' } });
      unlock.set(r.unlockedUntil);
      setEdit({ title: m.title, body: '', siteUrl: m.siteUrl ?? '', ...r.values, secret: true });
    } catch (e) { toast.error((e as Error).message); }
  };
  const remove = async () => {
    if (!m || !(await askConfirm(`'${m.title}' 메모를 휴지통으로 옮길까요? 30일 안에 되살릴 수 있습니다.`, { danger: true, ok: '휴지통으로' }))) return;
    try { await api(`/api/memos/${m.id}`, { method: 'DELETE' }); toast.ok('휴지통으로 옮겼습니다'); onChanged(); onClose(); } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Modal open onClose={onClose} title={m ? m.title : '메모'} wide>
      {d.error ? <ErrorBox error={d.error} retry={d.reload} /> : !m ? <Skeleton rows={4} /> : (
        <div className="space-y-4" data-testid="memo-detail" data-kind={m.kind}>
          <p className="text-xs text-ink-3">{m.kind === 'secret' ? '주요 메모' : '일반 메모'} · 만든 사람 {m.creatorName ?? '-'} · 마지막 수정 {fmtDateTime(m.updatedAt)}{m.updaterName ? ` (${m.updaterName})` : ''}{m.level === 'view' ? ' · 나는 보기만' : ''}</p>
          {edit ? (
            <div className="space-y-3" data-testid="memo-edit">
              <Field label="제목"><input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className={inputCls} maxLength={120} data-testid="memo-edit-title" /></Field>
              {m.kind === 'note' ? (
                <Field label="내용"><textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} rows={10} className={inputCls} data-testid="memo-edit-body" /></Field>
              ) : <>
                <Field label="사이트 주소"><input value={edit.siteUrl} onChange={(e) => setEdit({ ...edit, siteUrl: e.target.value })} className={inputCls} placeholder="예: https://example.com" data-testid="memo-edit-url" /></Field>
                {edit.secret && <SecretInputs v={edit} set={(p) => setEdit({ ...edit, ...p })} />}
              </>}
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button onClick={save} disabled={busy || !edit.title.trim()} data-testid="memo-edit-save">저장</Button></div>
            </div>
          ) : m.kind === 'note' ? (
            <div className="whitespace-pre-wrap break-words rounded-input border border-line bg-slate-50 px-3 py-2 text-sm text-ink" data-testid="memo-body">{m.body || '내용 없음'}</div>
          ) : (
            <div className="rounded-input border border-line px-3" data-testid="memo-secret">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2">
                <span className="w-16 shrink-0 text-xs text-ink-3">사이트</span>
                <span className="min-w-[8rem] flex-1 break-all text-sm" data-testid="memo-site">{m.siteUrl || '없음'}</span>
                {m.siteUrl && <a href={openUrl(m.siteUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs font-medium text-ink-2 hover:bg-slate-50" data-testid="memo-site-open"><ExternalLink className="size-3.5" />열기</a>}
              </div>
              {(['username', 'password', 'note'] as Field3[]).map((f) => <SecretField key={f} memoId={m.id} field={f} ensureUnlocked={ensureUnlocked} onUnlocked={unlock.set} />)}
            </div>
          )}
          {!edit && canEdit && <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEdit({ title: m.title, body: m.body ?? '', siteUrl: m.siteUrl ?? '', secret: false })} data-testid="memo-edit-open">{m.kind === 'secret' ? '제목·주소 고치기' : '고치기'}</Button>
            {m.kind === 'secret' && <Button variant="secondary" size="sm" onClick={editSecret} disabled={!status?.secretReady} data-testid="memo-edit-secret"><Lock />아이디·비밀번호 고치기</Button>}
          </div>}

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">볼 사람</h3>
              {canEdit && share === null && <Button size="sm" variant="secondary" onClick={() => setShare(d.data!.access.map((a) => ({ userId: a.userId, unitId: a.unitId, level: a.level, name: a.name, kind: a.kind })))} data-testid="memo-share-open"><Users />바꾸기</Button>}
            </div>
            {share !== null ? (
              <ShareEditor value={share} onChange={setShare} onCancel={() => setShare(null)} onSave={async () => {
                try { await api(`/api/memos/${m.id}/access`, { method: 'PUT', body: { access: share.map((a) => ({ userId: a.userId ?? undefined, unitId: a.unitId ?? undefined, level: a.level })) } }); toast.ok('볼 사람을 바꿨습니다'); setShare(null); d.reload(); onChanged(); }
                catch (e) { toast.error((e as Error).message); }
              }} />
            ) : (
              <ul className="space-y-1 text-sm" data-testid="memo-access">
                <li className="flex items-center justify-between rounded-input bg-slate-50 px-2.5 py-1.5"><span>{m.creatorName ?? '만든 사람'} <span className="text-xs text-ink-3">만든 사람</span></span><span className="text-xs text-ink-2">고치기</span></li>
                {d.data!.access.map((a) => <li key={`${a.kind}:${a.userId ?? a.unitId}`} className="flex items-center justify-between rounded-input bg-slate-50 px-2.5 py-1.5" data-testid="memo-access-row">
                  <span>{a.name}{a.kind === 'unit' ? <span className="text-xs text-ink-3"> 부서(아래 부서 포함)</span> : null}{a.inactive ? <span className="text-xs text-ink-3"> · 사용 중지</span> : null}</span>
                  <span className="text-xs text-ink-2">{a.level === 'edit' ? '고치기' : '보기'}</span></li>)}
                {!d.data!.access.length && <li className="px-1 text-xs text-ink-3">만든 사람만 볼 수 있습니다.</li>}
              </ul>
            )}
          </section>

          {canEdit && <section>
            <button onClick={() => setLog((v) => !v)} className="flex items-center gap-1 text-sm font-semibold text-ink" data-testid="memo-log-toggle"><History className="size-4" />기록 {log ? '접기' : '보기'}</button>
            {log && <MemoLog id={m.id} />}
          </section>}

          {canEdit && !edit && <div className="flex justify-end border-t border-line pt-3"><Button variant="secondary" size="sm" onClick={remove} data-testid="memo-delete"><Trash2 />휴지통으로</Button></div>}
        </div>
      )}
    </Modal>
  );
}

function SecretInputs({ v, set }: { v: { username?: string; password?: string; note?: string }; set: (p: { username?: string; password?: string; note?: string }) => void }) {
  const [show, setShow] = useState(false);
  return <>
    <Field label="아이디"><input value={v.username ?? ''} onChange={(e) => set({ username: e.target.value })} className={inputCls} autoComplete="off" data-testid="memo-in-username" /></Field>
    <Field label="비밀번호">
      <div className="flex gap-2">
        <input type={show ? 'text' : 'password'} value={v.password ?? ''} onChange={(e) => set({ password: e.target.value })} className={inputCls} autoComplete="new-password" data-testid="memo-in-password" />
        <Button type="button" variant="secondary" onClick={() => setShow((s) => !s)} aria-label={show ? '비밀번호 가리기' : '비밀번호 보기'}>{show ? <EyeOff /> : <Eye />}</Button>
      </div>
    </Field>
    <Field label="참고(보안 질문·2단계 인증 안내 등)"><textarea value={v.note ?? ''} onChange={(e) => set({ note: e.target.value })} rows={3} className={inputCls} data-testid="memo-in-note" /></Field>
  </>;
}

function ShareEditor({ value, onChange, onSave, onCancel }: { value: Access[]; onChange: (v: Access[]) => void; onSave?: () => void; onCancel?: () => void }) {
  const ppl = useApi<People>('/api/memos/people');
  const users = (ppl.data?.users ?? []).filter((x) => !value.some((a) => a.userId === x.id));
  const units = (ppl.data?.units ?? []).filter((x) => !value.some((a) => a.unitId === x.id));
  const setLevel = (i: number, level: Level) => onChange(value.map((a, j) => (j === i ? { ...a, level } : a)));
  return (
    <div className="space-y-2" data-testid="memo-share-editor">
      <ul className="space-y-1 text-sm">
        {value.map((a, i) => <li key={`${a.userId ?? a.unitId}`} className="flex items-center gap-2 rounded-input bg-slate-50 px-2.5 py-1.5" data-testid="memo-share-row">
          <span className="min-w-0 flex-1 truncate">{a.name ?? '-'}{a.unitId ? <span className="text-xs text-ink-3"> 부서</span> : null}</span>
          <select value={a.level} onChange={(e) => setLevel(i, e.target.value as Level)} className="rounded-input border border-line bg-white px-2 py-1 text-xs" aria-label={`${a.name} 단계`} data-testid="memo-share-level">
            <option value="view">보기</option><option value="edit">고치기</option>
          </select>
          <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded px-1.5 text-xs text-ink-3 hover:bg-slate-200" aria-label={`${a.name} 빼기`} data-testid="memo-share-remove">빼기</button>
        </li>)}
        {!value.length && <li className="px-1 text-xs text-ink-3">아무도 고르지 않으면 나만 봅니다.</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <select value="" onChange={(e) => { const x = users.find((u) => u.id === e.target.value); if (x) onChange([...value, { userId: x.id, level: 'view', name: x.name, kind: 'user' }]); }} className={cx(inputCls, 'w-auto min-w-[10rem] flex-1')} aria-label="사람 추가" data-testid="memo-share-add-user">
          <option value="">+ 사람 추가</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
        </select>
        <select value="" onChange={(e) => { const x = units.find((u) => u.id === e.target.value); if (x) onChange([...value, { unitId: x.id, level: 'view', name: x.name, kind: 'unit' }]); }} className={cx(inputCls, 'w-auto min-w-[10rem] flex-1')} aria-label="부서 추가" data-testid="memo-share-add-unit">
          <option value="">+ 부서 추가(아래 부서 포함)</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      {onSave && <div className="flex justify-end gap-2"><Button variant="secondary" size="sm" onClick={onCancel}>취소</Button><Button size="sm" onClick={onSave} data-testid="memo-share-save">저장</Button></div>}
    </div>
  );
}

const LOG_LABEL: Record<string, string> = { 'memo.create': '만듦', 'memo.update': '고침', 'memo.share': '볼 사람 바꿈', 'memo.reveal': '열어 봄', 'memo.delete': '휴지통으로', 'memo.restore': '되살림' };
function MemoLog({ id }: { id: string }) {
  const l = useApi<{ log: { id: number; action: string; at: string; actor: string | null; fields: string[] | null; purpose: string | null; added: number; removed: number }[] }>(`/api/memos/${id}/log`, [id]);
  if (l.error) return <ErrorBox error={l.error} retry={l.reload} />;
  if (!l.data) return <Skeleton rows={3} />;
  return (
    <ul className="mt-1.5 max-h-60 space-y-0.5 overflow-y-auto text-xs" data-testid="memo-log">
      {l.data.log.map((r) => <li key={r.id} className="flex gap-2 border-b border-line py-1 last:border-0" data-testid="memo-log-row">
        <span className="w-28 shrink-0 tabular-nums text-ink-3">{fmtDateTime(r.at)}</span>
        <span className="text-ink">{r.actor ?? '-'} · {r.action === 'memo.reveal' ? `${(r.fields ?? []).map((f) => FIELD_LABEL[f as Field3] ?? f).join('·')} ${r.purpose === 'copy' ? '복사' : '보기'}` : (LOG_LABEL[r.action] ?? r.action)}{r.action === 'memo.update' && r.fields?.length ? ` (${r.fields.map((f) => FIELD_LABEL[f as Field3] ?? ({ title: '제목', body: '내용', siteUrl: '사이트 주소' } as Record<string, string>)[f] ?? f).join('·')})` : ''}{r.action === 'memo.share' ? ` (+${r.added} −${r.removed})` : ''}</span>
      </li>)}
      {!l.data.log.length && <li className="text-ink-3">기록이 없습니다.</li>}
    </ul>
  );
}

function MemoCreate({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ title: '', body: '', siteUrl: '', username: '', password: '', note: '' });
  const [share, setShare] = useState<Access[]>([]);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/api/memos', { body: { kind, title: f.title, ...(kind === 'note' ? { body: f.body } : { siteUrl: f.siteUrl, username: f.username, password: f.password, note: f.note }), access: share.map((a) => ({ userId: a.userId ?? undefined, unitId: a.unitId ?? undefined, level: a.level })) } });
      toast.ok('만들었습니다'); onDone(r.id);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={kind === 'secret' ? '새 주요 메모' : '새 일반 메모'} wide>
      <div className="space-y-3" data-testid="memo-create">
        <Field label="제목"><input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputCls} maxLength={120} placeholder={kind === 'secret' ? '예: 세금계산서 발행 사이트' : '예: 거래처 응대 메모'} data-testid="memo-in-title" /></Field>
        {kind === 'note' ? (
          <Field label="내용"><textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} rows={8} className={inputCls} data-testid="memo-in-body" /></Field>
        ) : <>
          <Field label="사이트 주소"><input value={f.siteUrl} onChange={(e) => setF({ ...f, siteUrl: e.target.value })} className={inputCls} placeholder="예: https://example.com" data-testid="memo-in-url" /></Field>
          <SecretInputs v={f} set={(p) => setF({ ...f, ...p })} />
          <p className="text-xs text-ink-3">아이디·비밀번호·참고는 암호화해 저장합니다. 볼 때는 본인 확인이 필요하고, 누가 언제 열었는지 기록됩니다.</p>
        </>}
        <section>
          <h3 className="mb-1.5 text-sm font-semibold text-ink">볼 사람</h3>
          <ShareEditor value={share} onChange={setShare} />
        </section>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={go} disabled={busy || !f.title.trim()} data-testid="memo-create-go">만들기</Button></div>
      </div>
    </Modal>
  );
}
