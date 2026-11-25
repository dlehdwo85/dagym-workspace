'use client';
import { useState } from 'react';
import { api, useApi } from '../client';
import { Button, cx, fmtDateTime, inputCls, toast } from '../ui';

type Src = { id: string; label: string; url: string; words: string[]; status: string; statusLabel: string; last_checked_at: string | null; items: number };
type Item = { id: string; source_id: string; title: string; url: string; posted_date: string | null; first_seen_at: string; task_id: string | null; label: string };

/** #1181 상업화 마감 3번(설계 A): 내 수집 원천 — 게시판·RSS 주소를 넣으면 하루 두 번(09·15시) 새 글을 모아 줌. 회사 전용(다른 회사·공용 목록과 섞이지 않음) */
export function WatchSources() {
  const { data, reload } = useApi<{ canEdit: boolean; max: number; sources: Src[]; items: Item[] }>('/api/sales/watch');
  const [f, setF] = useState({ label: '', url: '', words: '' }); const [busy, setBusy] = useState('');
  if (!data) return null;
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast.ok(ok); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(''); } };
  const add = () => run('add', () => api('/api/sales/watch', { body: { label: f.label.trim(), url: f.url.trim(), words: f.words.split(/[,·\s]+/).map((w) => w.trim()).filter(Boolean) } }).then(() => setF({ label: '', url: '', words: '' })), '넣었습니다 — 바로 한 번 받아 봤습니다');
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="sales-watch">
      <h2 className="font-semibold">내 수집 원천</h2>
      <p className="mt-1 text-xs text-ink-2">회사가 보는 게시판·공지 페이지·RSS 주소를 넣으면 하루 두 번(09·15시) 새 글을 모아 아래에 보여 줍니다. 찾을 낱말을 넣으면 그 낱말이 든 글만. 로그인이 필요한 페이지·자동 수집을 막은 사이트는 넣을 수 없습니다. 회사당 {data.max}개.</p>
      {data.canEdit && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_12rem_auto]" data-testid="sales-watch-form">
          <input className={cx(inputCls, 'h-9')} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="이름(예: 협회 공지)" maxLength={60} data-testid="sales-watch-label" />
          <input className={cx(inputCls, 'h-9 min-w-0')} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://… 게시판·RSS 주소" data-testid="sales-watch-url" />
          <input className={cx(inputCls, 'h-9')} value={f.words} onChange={(e) => setF({ ...f, words: e.target.value })} placeholder="찾을 낱말(쉼표, 선택)" data-testid="sales-watch-words" />
          <Button size="sm" disabled={busy === 'add' || !f.label.trim() || !/^https?:\/\//.test(f.url.trim()) || data.sources.length >= data.max} onClick={add} data-testid="sales-watch-add">{busy === 'add' ? '확인 중…' : '넣기'}</Button>
        </div>
      )}
      {!data.sources.length ? <p className="mt-2 text-xs text-ink-3" data-testid="sales-watch-empty">아직 넣은 주소가 없습니다.</p> : (
        <ul className="mt-2 divide-y divide-line text-sm">{data.sources.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="sales-watch-source">
            <span className="min-w-0 flex-1 truncate"><b>{s.label}</b> <span className="text-xs text-ink-3">{s.url}</span>{s.words.length > 0 && <span className="ml-1 text-xs text-ink-2">· 낱말 {s.words.join('·')}</span>}</span>
            <span className={cx('rounded-full px-2 py-0.5 text-xs', s.status === 'ok' ? 'bg-emerald-50 text-emerald-800' : s.status === 'new' ? 'bg-slate-100 text-ink-2' : 'bg-red-50 text-red-800')} data-testid="sales-watch-status">{s.statusLabel}</span>
            <span className="text-xs text-ink-3">글 {s.items}{s.last_checked_at ? ` · ${fmtDateTime(s.last_checked_at)}` : ''}</span>
            {data.canEdit && <><Button size="sm" variant="secondary" disabled={busy === s.id} onClick={() => run(s.id, () => api(`/api/sales/watch/${s.id}`, { body: { action: 'check' } }), '받아 왔습니다')} data-testid="sales-watch-check">지금 받기</Button>
              <button type="button" className="text-xs text-red-700 underline" onClick={() => run(`d${s.id}`, () => api(`/api/sales/watch/${s.id}`, { method: 'DELETE' }), '뺐습니다')} data-testid="sales-watch-remove">빼기</button></>}
          </li>))}</ul>
      )}
      {data.items.length > 0 && (
        <div className="mt-3" data-testid="sales-watch-items">
          <p className="text-xs font-medium text-ink-2">최근 30일 새 글 {data.items.length}건</p>
          <ul className="mt-1 divide-y divide-line text-sm">{data.items.slice(0, 30).map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="sales-watch-item">
              <a href={it.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate hover:underline">{it.title}</a>
              <span className="text-xs text-ink-3">{it.label}{it.posted_date ? ` · ${it.posted_date}` : ''}</span>
              {it.task_id ? <a href={`/tasks/${it.task_id}`} className="text-xs text-brand-700 underline">업무 열기</a>
                : <Button size="sm" variant="secondary" disabled={busy === it.id} onClick={() => run(it.id, () => api(`/api/sales/watch/${it.source_id}`, { body: { action: 'task', itemId: it.id } }), '업무로 만들었습니다')} data-testid="sales-watch-task">업무로</Button>}
            </li>))}</ul>
        </div>
      )}
    </section>
  );
}
