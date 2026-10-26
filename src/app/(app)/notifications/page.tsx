'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, Loading, cx, fmtDateTime, toast } from '@/components/ui';
import { NOTIFICATION_TYPES } from '@/lib/types';
import { cameBack, useUrlState } from '@/components/urlState';

const SPACE_CHIP: Record<string, string> = { sales: '영업', marketing: '마케팅', work: '업무' };
type Tab = 'unread' | 'all' | 'archived' | 'activity';
const TABS: Tab[] = ['unread', 'all', 'archived', 'activity'];
const SWIPE = 70; // px — 왼쪽으로 밀면 읽음, 오른쪽으로 밀면 보관
const LONG_PRESS = 500; // ms — 길게 누르면 다중 선택

export default function Notifications() {
  const router = useRouter();
  // #104 ⑥: 묶음 알림 링크(/notifications?space=marketing) → 그 공간 알림만
  const [spaceQ, setSpaceQ] = useUrlState('space', '');
  const space = SPACE_CHIP[spaceQ] ? spaceQ : null;
  // V32 0: 기본은 안 읽은 알림만 — 누르면 바로 읽음(배지 감소), 서버 실패 때만 되돌림. [전체]로 읽은 것까지 · #110 [보관함]
  // #242 2단계: 탭은 주소(?tab=)에 — 알림을 눌러 업무·승인함에 갔다 뒤로 와도 보던 탭
  const [tabQ, setTabQ] = useUrlState('tab', 'unread');
  const tab = (TABS.includes(tabQ as Tab) ? tabQ : 'unread') as Tab;
  const setTab = (t: Tab) => setTabQ(t);
  const { data, error, loading, reload, setData } = useApi<any>(`/api/notifications${tab === 'archived' ? '?archived=1' : space ? `?space=${space}` : ''}`);
  // 로컬 10/19(대표) 홈 개편: 홈 '최근 활동' 카드가 여기 '활동' 탭으로
  const [doneIds, setDoneIds] = useState<string[]>([]); // 이 화면에서 방금 처리한 알림 — 다시 불러와도 안 읽음 탭에 "…함 ✓"로 남김
  // #110: 이 화면에서 읽음 처리한 알림은 흐리게 남겨 둔다(탭을 바꾸면 빠짐). #242 2단계: 눌러서 다른 화면에 갔다 뒤로 와도 남김(이 창 동안, 같은 탭)
  const [readHere, setReadHere] = useState<string[]>([]);
  // #110: 길게 눌러(또는 [선택]) 여러 건 고르기
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const hereKey = `${tab}|${space ?? ''}`;
  useEffect(() => {
    let ids: string[] = [];
    if (cameBack()) try { const r = JSON.parse(sessionStorage.getItem('wos_notif_here') ?? 'null'); if (r?.k === hereKey && Array.isArray(r.ids)) ids = r.ids; } catch { /* 무시 */ } // 뒤로가기로 돌아왔을 때만
    setReadHere(ids); setSelecting(false); setPicked([]);
  }, [hereKey]);
  useEffect(() => { try { sessionStorage.setItem('wos_notif_here', JSON.stringify({ k: hereKey, ids: readHere })); } catch { /* 무시 */ } }, [readHere]); // eslint-disable-line react-hooks/exhaustive-deps
  // #104 ⑥ 종류별 묶음 접기(이 기기 기억)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setCollapsed(JSON.parse(localStorage.getItem('notif-collapsed') ?? '{}')); } catch { /* 무시 */ } }, []);
  const toggle = (k: string) => setCollapsed((c) => { const n = { ...c, [k]: !c[k] }; try { localStorage.setItem('notif-collapsed', JSON.stringify(n)); } catch { /* 무시 */ } return n; });
  const act = useApi<{ items: any[] }>(tab === 'activity' ? '/api/notifications/activity' : null);
  /** 로컬 10/20 알림에서 바로 처리: 서버가 준 버튼(승인/수정 요청·연장 승인/거절·답글/확인·배정 확인/오늘 할 일·10분 뒤) → 처리되면 그 자리에 "승인함 ✓" */
  async function runAction(n: any, a: { id: string; label: string; input?: 'text'; open?: true }) {
    let text: string | undefined;
    if (a.open) { // #618 [승인함 열기]/[열기]: 읽음 표시 + 그 화면으로(서버 처리 없음)
      if (!n.read_at) read([n.id]);
      router.push(n.link || '/');
      return;
    }
    if (a.input === 'text') { const t = prompt(`${a.label} 내용`); if (t === null) return; text = t.trim(); if (!text) { toast.error(`${a.label} 내용을 적어 주세요`); return; } }
    try {
      const r = await api<{ label: string; unread: number }>(`/api/notifications/${n.id}/action`, { body: { action: a.id, text, only: true } }); // 184차 #676: 목록의 [확인]은 이 줄만
      setData((d: any) => d && { ...d, unread: r.unread, items: d.items.map((x: any) => (x.id === n.id ? { ...x, action_done: r.label, read_at: x.read_at ?? new Date().toISOString(), actions: [] } : x)) });
      setDoneIds((d) => [...d, n.id]);
      window.dispatchEvent(new CustomEvent('wos-unread', { detail: { value: r.unread } }));
      toast.ok(`${r.label} ✓`); broadcastRefresh();
    } catch (e: any) { toast.error(e.message); }
  }
  /** 읽음(ids 없으면 모두) · archive = 읽음 + 보관(목록에서 빠짐). 화면·배지는 먼저 바꾸고 서버 실패 때만 되돌림 */
  async function read(ids?: string[], archive = false) {
    if (!data) return;
    const now = new Date().toISOString();
    const target = ids ? new Set(ids) : null;
    const changed = data.items.filter((n: any) => !n.read_at && (!target || target.has(n.id))).length;
    const prev = data;
    setData({ ...data, unread: ids ? Math.max(0, data.unread - changed) : 0, items: data.items.filter((n: any) => !(archive && target?.has(n.id))).map((n: any) => (!n.read_at && (!target || target.has(n.id)) ? { ...n, read_at: now } : n)) });
    if (ids && !archive) setReadHere((r) => [...r, ...ids]);
    if (ids) setPicked((p) => p.filter((x) => !target!.has(x)));
    window.dispatchEvent(new CustomEvent('wos-unread', { detail: ids ? { delta: -changed } : { value: 0 } }));
    try {
      const r = await api<{ unread: number }>('/api/notifications/read', { body: ids ? (archive ? { ids, archive: true } : { ids }) : { all: true } });
      window.dispatchEvent(new CustomEvent('wos-unread', { detail: { value: r.unread } }));
      if (archive) toast.ok(`${ids!.length}건 보관했습니다`);
    } catch (e: any) {
      setData(prev); window.dispatchEvent(new CustomEvent('wos-unread', { detail: { value: prev.unread } })); toast.error(e.message || '읽음 처리를 못 했습니다');
    }
  }
  async function unarchive(ids: string[]) {
    if (!data) return;
    const prev = data;
    setData({ ...data, items: data.items.filter((n: any) => !ids.includes(n.id)) });
    try { await api('/api/notifications/read', { body: { ids, unarchive: true } }); toast.ok('목록으로 되돌렸습니다'); }
    catch (e: any) { setData(prev); toast.error(e.message); }
  }
  const visible: any[] = data ? (tab === 'unread' ? data.items.filter((n: any) => !n.read_at || doneIds.includes(n.id) || readHere.includes(n.id)) : data.items) : [];
  // #104 ⑥ 종류별 묶음(순서 = 첫 알림 순서) — 머리줄에 건수·안 읽음·[묶음 읽음]·접기
  const groups: { key: string; label: string; items: any[] }[] = [];
  for (const n of visible) {
    let g = groups.find((x) => x.key === n.type);
    if (!g) { g = { key: n.type, label: NOTIFICATION_TYPES[n.type as keyof typeof NOTIFICATION_TYPES] ?? n.type, items: [] }; groups.push(g); }
    g.items.push(n);
  }
  const pickToggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickedUnread = picked.filter((id) => visible.some((n) => n.id === id && !n.read_at));
  const listTabs = ([['unread', '안 읽음'], ['all', '전체'], ['archived', '보관함']] as const);
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">알림 {data?.unread ? <span className="text-sm text-red-600">{data.unread}</span> : null}{space && <span className="ml-1 rounded-full bg-brand-50 px-2 text-xs font-normal text-brand-700" data-testid="notif-space-filter">{SPACE_CHIP[space]}만 <button type="button" className="underline" onClick={() => setSpaceQ('')}>해제</button></span>}</h1>
        <div className="flex gap-2"><Link href="/settings" className="text-sm text-brand-600 hover:underline">알림 설정</Link>
          {tab !== 'activity' && tab !== 'archived' && <Button size="sm" variant="secondary" onClick={() => { setSelecting((s) => !s); setPicked([]); }} data-testid="notif-select" aria-pressed={selecting}>{selecting ? '선택 끝' : '선택'}</Button>}
          <Button size="sm" variant="secondary" onClick={() => read()} disabled={!data?.unread} data-testid="read-all">모두 읽음</Button></div>
      </div>
      <div className="flex gap-1 text-sm" role="tablist" aria-label="알림 보기">
        {listTabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={k === 'unread' ? 'notif-unread' : k === 'all' ? 'notif-all' : 'notif-archived'}
            className={cx('rounded-full px-3 py-1', tab === k ? 'bg-brand-600 text-white' : 'bg-white text-ink-2 ring-1 ring-line')}>{l}{k === 'unread' && data?.unread ? ` ${data.unread}` : ''}</button>
        ))}
        <button role="tab" aria-selected={tab === 'activity'} onClick={() => setTab('activity')} data-testid="notif-activity"
          className={cx('rounded-full px-3 py-1', tab === 'activity' ? 'bg-brand-600 text-white' : 'bg-white text-ink-2 ring-1 ring-line')}>활동</button>
      </div>
      {/* #110 다중 선택 띠 */}
      {selecting && tab !== 'activity' && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm" data-testid="notif-sel-bar">
          <span className="font-medium">{picked.length}건 선택</span>
          <Button size="sm" onClick={() => read(pickedUnread)} disabled={!pickedUnread.length} data-testid="notif-sel-read">읽음</Button>
          <Button size="sm" variant="secondary" onClick={() => read(picked, true)} disabled={!picked.length} data-testid="notif-sel-archive">보관</Button>
          <button type="button" className="text-xs text-ink-2 underline" onClick={() => setPicked(visible.map((n) => n.id))}>모두 선택</button>
          <button type="button" className="text-xs text-ink-2 underline" onClick={() => { setSelecting(false); setPicked([]); }}>취소</button>
          <span className="ml-auto text-[11px] text-ink-3">휴대폰: 왼쪽으로 밀면 읽음 · 오른쪽으로 밀면 보관 · 길게 누르면 선택</span>
        </div>)}
      {tab === 'activity' ? (
        act.error ? <ErrorBox error={act.error} retry={act.reload} /> : !act.data ? <Loading /> : !act.data.items.length ? <Empty title="최근 활동이 없습니다">최근 30일 동안 내가 볼 수 있는 업무의 등록·완료·댓글이 여기에 보입니다.</Empty> : (
          <ul className="divide-y rounded-lg border bg-white" data-testid="activity-list">
            {act.data.items.map((a: any, i: number) => (
              <li key={i} className="flex min-w-0 items-start gap-3 px-4 py-2.5 text-sm">
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', a.kind === 'done' ? 'bg-green-500' : a.kind === 'comment' ? 'bg-accent-500' : 'bg-slate-300')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate"><b className="font-semibold">{a.actor_name ?? '시스템'}</b> {a.kind === 'done' ? '완료' : a.kind === 'comment' ? '댓글' : a.kind === 'alarm_dismissed' ? '알람 해제' : a.kind === 'alarm_snoozed' ? '알람 미룸' : '등록'} ·<Link href={`/tasks/${a.task_id}`} className="hover:underline">{a.title}</Link></p>
                  {a.body && <p className="truncate text-xs text-ink-2">{a.body}</p>}
                  <p className="text-[11px] text-ink-3">{fmtDateTime(a.at)}</p>
                </div>
              </li>))}
          </ul>)
      ) : error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Loading /> : !visible.length ? (
        <Empty title={tab === 'archived' ? '보관한 알림이 없습니다' : tab === 'all' ? '알림이 없습니다' : '새 알림이 없습니다'}>{tab === 'unread' && data.items.length > 0 && <button className="text-sm text-brand-600 underline" onClick={() => setTab('all')}>읽은 알림 보기</button>}</Empty>
      ) : (
        <div className="space-y-2" data-testid="notifications">
          {groups.map((g) => { const unread = g.items.filter((n) => !n.read_at).map((n) => n.id); const open = !collapsed[g.key];
            return (
              <section key={g.key} className="rounded-lg border bg-white" data-testid={`notif-group-${g.key}`}>
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-ink-2">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left" onClick={() => toggle(g.key)} aria-expanded={open} aria-label={`${g.label} ${open ? '접기' : '펼치기'}`} data-testid={`notif-group-toggle-${g.key}`}>
                    <span className={cx('inline-block transition-transform', open ? 'rotate-90' : '')}>▸</span><b className="truncate font-semibold text-ink">{g.label}</b><span>{g.items.length}건{unread.length ? ` · 안 읽음 ${unread.length}` : ''}</span>
                  </button>
                  {unread.length > 0 && <button type="button" className="shrink-0 rounded-full border border-line px-2 py-0.5 hover:bg-slate-50" onClick={() => read(unread)} data-testid={`notif-group-read-${g.key}`}>묶음 읽음</button>}
                </div>
                {open && <ul className="divide-y border-t">
                  {g.items.map((n: any) => (
                    <Row key={n.id} n={n} archived={tab === 'archived'} selecting={selecting} picked={picked.includes(n.id)} onPick={() => pickToggle(n.id)} onLongPress={() => { setSelecting(true); setPicked((p) => (p.includes(n.id) ? p : [...p, n.id])); }}
                      onRead={() => read([n.id])} onArchive={() => read([n.id], true)} onUnarchive={() => unarchive([n.id])} onOpen={() => !n.read_at && read([n.id])} runAction={runAction} />
                  ))}
                </ul>}
              </section>);
          })}
        </div>
      )}
    </div>
  );
}

/** #110 한 줄: [읽음]/[보관] 버튼 · 읽은 줄은 흐리게 · 휴대폰 스와이프(왼쪽 읽음·오른쪽 보관) · 길게 누르면 선택 모드 · 선택 모드면 체크 상자 */
function Row({ n, archived, selecting, picked, onPick, onLongPress, onRead, onArchive, onUnarchive, onOpen, runAction }: { n: any; archived: boolean; selecting: boolean; picked: boolean; onPick: () => void; onLongPress: () => void; onRead: () => void; onArchive: () => void; onUnarchive: () => void; onOpen: () => void; runAction: (n: any, a: any) => void }) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY, t: Date.now() }; moved.current = false;
    clearTimer(); timer.current = setTimeout(() => { if (!moved.current) { onLongPress(); try { navigator.vibrate?.(15); } catch { /* 무시 */ } } }, LONG_PRESS);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current || selecting || archived) return;
    const t = e.touches[0]; const x = t.clientX - start.current.x, y = t.clientY - start.current.y;
    if (Math.abs(x) > 8 || Math.abs(y) > 8) { moved.current = true; clearTimer(); }
    if (Math.abs(x) > Math.abs(y) * 1.2) setDx(Math.max(-140, Math.min(140, x)));
  };
  const onTouchEnd = () => {
    clearTimer();
    if (dx <= -SWIPE && !n.read_at) onRead(); else if (dx >= SWIPE) onArchive();
    setDx(0); start.current = null;
  };
  const dim = !!n.read_at && !archived;
  return (
    <li className={cx('relative overflow-hidden', !n.read_at && 'bg-brand-50/50')} data-testid="notif-item" data-space={n.space ?? ''} data-read={n.read_at ? '1' : '0'} data-picked={picked ? '1' : '0'}>
      {dx !== 0 && <div className={cx('absolute inset-y-0 flex items-center px-4 text-xs font-medium text-white', dx < 0 ? 'right-0 bg-brand-600' : 'left-0 bg-slate-500')}>{dx < 0 ? '읽음' : '보관'}</div>}
      <div className={cx('flex gap-3 px-4 py-3 transition-transform', dim && 'opacity-60')} style={dx ? { transform: `translateX(${dx}px)`, transitionDuration: '0ms' } : undefined}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={() => { clearTimer(); setDx(0); }}
        onContextMenu={(e) => { if (start.current) e.preventDefault(); }}>
        {selecting ? <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={picked} onChange={onPick} aria-label={`${n.title} 선택`} data-testid="notif-check" />
          : <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-600')} />}
        {selecting ? (
          <button type="button" className="min-w-0 flex-1 text-left" onClick={onPick}>
            <div className="text-xs text-slate-500">{n.space && SPACE_CHIP[n.space] && <span className="mr-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-ink-2">{SPACE_CHIP[n.space]}</span>}{relTime(n.created_at)}</div>
            <div className="text-sm font-medium">{n.title}</div>
          </button>
        ) : (
          <Link href={n.link} onClick={onOpen} className="min-w-0 flex-1" draggable={false}>
            <div className="text-xs text-slate-500">{n.space && SPACE_CHIP[n.space] && <span className="mr-1 rounded-full bg-slate-100 px-1.5 text-[10px] text-ink-2" data-testid="notif-space-chip">{SPACE_CHIP[n.space]}</span>}<span title={fmtDateTime(n.created_at)}>{relTime(n.created_at)}</span>{n.actor_name ? ` · ${n.actor_name}` : ''}{n.read_at && !archived ? ' · 읽음' : ''}</div>
            <div className="text-sm font-medium">{n.title}</div>
            {n.body && <div className="truncate text-sm text-slate-600">{n.body}</div>}
            {/* #104 ② 묶음 알림: 담긴 건을 펼쳐 보여 줌 */}
            {Array.isArray(n.meta?.items) && n.meta.items.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-ink-2" data-testid="notif-digest-items">
              {n.meta.items.map((it: any, i: number) => <li key={i} className="truncate">· {it.title}</li>)}
            </ul>}
          </Link>)}
        {!selecting && (n.action_done ? <span className="shrink-0 self-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700" data-testid="notif-done">{n.action_done} ✓</span>
          : !!n.actions?.length ? (
          <span className="flex shrink-0 flex-col gap-1 self-center sm:flex-row" data-testid={n.type === 'review_requested' ? 'review-actions' : 'notif-actions'}>
            {n.actions.map((a: any, i: number) => <Button key={a.id} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => runAction(n, a)} data-testid={`na-${a.id}`}>{a.label}</Button>)}
          </span>) : null)}
        {!selecting && <span className="flex shrink-0 flex-col items-end gap-1 self-center text-[11px] text-ink-3">
          {archived ? <button type="button" className="rounded-full border border-line px-2 py-0.5 hover:bg-slate-50" onClick={onUnarchive} data-testid="notif-unarchive">되돌리기</button>
            : <>{!n.read_at && <button type="button" className="rounded-full border border-line px-2 py-0.5 hover:bg-slate-50" onClick={onRead} data-testid="notif-read">읽음</button>}
              <button type="button" className="rounded-full px-2 py-0.5 hover:bg-slate-50" onClick={onArchive} data-testid="notif-archive" title="보관함으로(목록에서 빠짐)">보관</button></>}
        </span>}
      </div>
    </li>
  );
}

/** 검수(10/16): 알림 시각은 "방금·n분 전·n시간 전·어제" — 하루 넘으면 날짜·시각 */
function relTime(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  if (ms < 60_000) return '방금';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}분 전`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}시간 전`;
  if (ms < 2 * 86_400_000) return '어제';
  return fmtDateTime(iso);
}
