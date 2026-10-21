'use client';
import Link from 'next/link';
import { RevenueGoal } from './RevenueGoal';
import { MediaThumb } from '@/components/MediaView';
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Moon, Play, Settings2, Sparkles } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Modal, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { NaverForm } from './Ads';
import { ApproveRow, CH_DOT, CH_STATE, ChannelSetup, ConnectButton, type HomeCh } from './Marketing';
import { channelLabel, whenLabel, type CardContent } from './ApprovalCard';

const C = '#7C3AED';
/** 대표(10/20 오후): 홈 맨 위 입력창 문구는 'AI 비서' — 이름을 붙이는 안은 검토 중이라 라벨 하나만 바꾸면 되게 */
export const HOME_AI_LABEL = 'AI 비서';
const CH_COLOR: Record<string, string> = { instagram: '#DB2777', facebook: '#2563EB', threads: '#111827', blog: '#16A34A', youtube: '#DC2626', naver_place: '#059669', other: '#64748B' };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const dayShort = (d: string) => { const x = new Date(`${d}T00:00:00+09:00`); return `${x.getMonth() + 1}/${x.getDate()}`; };
const wd = (d: string) => '일월화수목금토'[new Date(`${d}T00:00:00+09:00`).getDay()];
const hm = (at: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));

type Home = {
  canEdit: boolean; cards: { cards: string[]; mine: boolean; company: string[] | null }; cardLabels: Record<string, string>;
  kpi: { approvals: number; approvalsDetail: { contents: number; adPlans: number }; today: { id: string; channel: string; kind: string | null; at: string; status: string }[]; week: { done: number; planned: number }; ads: { cost7: number; clicks7: number; today: number } | null; calls7: number };
  approve: (CardContent & { media: string | null })[]; approvalHour: number;
  production?: { leftCredits: number | null; monthlyCredits: number | null; images: number | null; videos: number | null; over: boolean; overMessage: string | null; planLabel: string | null } | null;
  goal: { id: string; month: string; status: string; posts: { done: number; planned: number; target: number | null }; inquiries: { done: number; target: number | null }; adCost: { spent: number; budget: number | null }; objectives: string[]; message: string | null; weekTopic: string | null; week: number | null } | null;
  queue: { kind: string; id: string; title: string; state: 'waiting' | 'running' | 'done'; at: string | null; href: string; night: boolean; canRun: boolean; canNight: boolean; note?: string }[];
  night: { id: string; title: string; kind: string }[]; nightScope: Record<string, boolean>;
  week: { day: string; posts: { id: string; channel: string; status: string; title: string }[] }[];
  perf: { day: string; cost: number; clicks: number; calls: number }[];
  ads: { accounts: number; on: number; off: number; monthlyCap: number | null; stopped: boolean; today: number; suggestions: number; campaigns: { id: string; name: string; ctr: number | null; cpc: number | null; cost: number }[] } | null;
  recent: { id: string; title: string; channel: string; kind: string | null; published_at: string | null; published_url: string | null; media: string | null }[];
  suggestions: { key: string; title: string; detail: string; href: string }[];
  channels: HomeCh[];
};

/** 0 회사 채팅 입력창(폴시아 1): 기존 AI 비서 대화를 그대로 — 홈에는 입력창 + 마지막 답 카드 1개 */
function HomeChat() {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ q: string; a: string; threadId?: string } | null>(null);
  useEffect(() => { try { const v = localStorage.getItem('wos_mkt_home_ai'); if (v) setLast(JSON.parse(v)); } catch {} }, []);
  const ctl = useRef<AbortController | null>(null);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim(); if (!q || busy) return;
    setBusy(true); ctl.current = new AbortController();
    try {
      const r = await api('/api/ai/chat', { body: { text: q, space: 'marketing', context: { page: 'home' } }, signal: ctl.current.signal });
      const next = { q, a: r.reply || (r.blocked ? '업무와 무관한 질문은 답하지 않습니다' : '(답 없음)'), threadId: r.threadId };
      setLast(next); setText(''); try { localStorage.setItem('wos_mkt_home_ai', JSON.stringify(next)); } catch {}
    } catch (er: any) { if (er?.name !== 'AbortError') toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-violet-200 bg-white p-3 shadow-card" data-testid="mkt-home-chat">
      <form onSubmit={ask} className="flex items-center gap-2">
        <Sparkles className="size-5 shrink-0 text-violet-600" aria-hidden />
        <input className={cx(inputCls, 'min-w-0 flex-1')} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${HOME_AI_LABEL} — 예: 이번 주 인스타 게시 뭐 남았어?`} aria-label={HOME_AI_LABEL} data-testid="mkt-home-ask" maxLength={2000} />
        <Button type="submit" size="sm" disabled={busy || !text.trim()} data-testid="mkt-home-ask-send">{busy ? '생각 중…' : '묻기'}</Button>
      </form>
      {last && (
        <div className="mt-2 rounded-input bg-violet-50/50 p-2 text-sm" data-testid="mkt-home-answer">
          <div className="text-xs text-ink-3">Q. {last.q}</div>
          <div className="mt-1 whitespace-pre-wrap">{last.a}</div>
          <Link href="/assistant?space=marketing" className="mt-1 inline-block text-xs font-medium" style={{ color: C }}>{HOME_AI_LABEL}에서 이어서 →</Link>
        </div>
      )}
    </section>
  );
}

/** ⚙ 카드 켜기/끄기·순서(폴시아 5): 사람별 덮어쓰기, 관리자는 회사 기본으로도 */
function CardSettings({ home, onClose, onDone }: { home: Home; onClose: () => void; onDone: () => void }) {
  const all = Object.keys(home.cardLabels);
  const [list, setList] = useState<string[]>([...home.cards.cards, ...all.filter((k) => !home.cards.cards.includes(k))]);
  const [on, setOn] = useState<Set<string>>(new Set(home.cards.cards));
  const move = (i: number, d: -1 | 1) => { const n = [...list]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setList(n); };
  async function save(company: boolean) {
    try { await api('/api/marketing/home', { body: { action: 'cards', cards: list.filter((k) => on.has(k)), company } }); toast.ok(company ? '회사 기본으로 저장했습니다' : '내 홈 구성으로 저장했습니다'); onDone(); }
    catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open onClose={onClose} title="홈 카드 구성">
      <ul className="divide-y divide-line text-sm" data-testid="mkt-home-cards">
        {list.map((k, i) => (
          <li key={k} className="flex items-center gap-2 py-1.5">
            <input type="checkbox" checked={on.has(k)} onChange={(e) => { const s = new Set(on); if (e.target.checked) s.add(k); else s.delete(k); setOn(s); }} aria-label={home.cardLabels[k]} data-testid={`mkt-card-${k}`} />
            <span className="flex-1">{home.cardLabels[k]}</span>
            <button type="button" onClick={() => move(i, -1)} className="rounded p-1 text-ink-3 hover:bg-slate-100" aria-label="위로"><ArrowUp className="size-4" /></button>
            <button type="button" onClick={() => move(i, 1)} className="rounded p-1 text-ink-3 hover:bg-slate-100" aria-label="아래로"><ArrowDown className="size-4" /></button>
          </li>))}
      </ul>
      <p className="mt-2 text-xs text-ink-3">{home.cards.mine ? '지금은 내 구성을 쓰고 있습니다' : home.cards.company ? '지금은 회사 기본 구성을 쓰고 있습니다' : '지금은 기본 순서입니다'}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {home.cards.mine && <Button variant="secondary" onClick={async () => { await api('/api/marketing/home', { body: { action: 'cards', cards: [] } }); onDone(); }}>회사 기본으로 되돌리기</Button>}
        {home.canEdit && <Button variant="secondary" onClick={() => save(true)} data-testid="mkt-cards-company">회사 기본으로 저장</Button>}
        <Button onClick={() => save(false)} data-testid="mkt-cards-save">내 홈에 저장</Button>
      </div>
    </Modal>
  );
}

const Thumb = ({ media, mime, channel, size = 'size-14' }: { media: string | null; mime?: string | null; channel: string; size?: string }) => media
  ? <MediaThumb src={`/api/library/${media}/download?inline=1`} mime={mime} className={cx(size, 'shrink-0 rounded-input object-cover')} />
  : <span className={cx(size, 'flex shrink-0 items-center justify-center rounded-input text-[10px] font-bold text-white')} style={{ background: CH_COLOR[channel] ?? CH_COLOR.other }}>{channelLabel(channel).slice(0, 4)}</span>;

const STATE: Record<string, [string, string]> = { waiting: ['대기', 'bg-slate-100 text-ink-2'], running: ['실행 중', 'bg-sky-50 text-sky-800'], done: ['완료', 'bg-emerald-50 text-emerald-800'] };

/**
 * ⑥ 마케팅 홈(시안 DESIGN_HOME_SIDEBAR 10/20 · 대표 승인 10/20 오후, 영업 홈과 같은 밀도). 위 → 아래:
 * 0 AI 비서 입력창 · 1 숫자 4칸 · 2 ① 지금 승인할 것 상위 3(썸네일·[승인][수정 요청][미리보기]) · 3 AI 작업 큐(대기→실행 중→완료, [지금 실행]/[밤에]) + 🌙 밤사이 결과
 * · 4 ② 이번 주 게시 캘린더 줄(7일 × 채널 점) · 5 ③ 성과 7일 미니 차트 + 광고 카드([켜기]는 대표 승인 — 여기서 켜지 않음) · 6 ④ 최근 게시물 6 + [다음 할 일 제안] → [업무로 만들기] · 7 ⑤ 채널 상태 한 줄 · ⚙ 카드 켜기/끄기·순서
 * 채널 0개면 '채널 연결 3단계' 맨 위, 끊긴 채널은 빨간 띠(로컬 10/19 그대로). 앱(390)은 같은 순서를 한 열로.
 */
export function MarketingHome() {
  const { data, error, reload } = useApi<Home>('/api/marketing/home');
  const [naver, setNaver] = useState(false); const [cfg, setCfg] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set()); const [busy, setBusy] = useState<string | null>(null);
  if (error) return <div className="mx-auto max-w-4xl text-sm text-red-700" data-testid="space-home-marketing">{error.message}</div>;
  if (!data) return <div className="mx-auto max-w-4xl" data-testid="space-home-marketing"><Skeleton className="h-40" /></div>;
  const chs = data.channels;
  const linked = chs.filter((c) => c.kind !== 'helper' && (c.state === 'connected' || c.state === 'broken')).length;
  const broken = chs.filter((c) => c.state === 'broken');
  const on = (k: string) => data.cards.cards.includes(k);
  async function act(body: Record<string, unknown>, key: string, okMsg: string) {
    setBusy(key);
    try { await api('/api/marketing/home', { body }); toast.ok(okMsg); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  const maxCost = Math.max(1, ...data.perf.map((p) => p.cost)); const maxCalls = Math.max(1, ...data.perf.map((p) => p.calls));
  const cost7 = data.perf.reduce((a, p) => a + p.cost, 0), calls7 = data.perf.reduce((a, p) => a + p.calls, 0);
  const kpi: [string, string, string, string][] = [
    ['승인 대기', String(data.kpi.approvals), data.kpi.approvalsDetail.adPlans ? `시안 ${data.kpi.approvalsDetail.contents} · 광고 개선안 ${data.kpi.approvalsDetail.adPlans}` : '시안', '/s/marketing/approvals'],
    ['오늘 게시', String(data.kpi.today.length), data.kpi.today.length ? data.kpi.today.slice(0, 2).map((t) => `${channelLabel(t.channel, t.kind)} ${hm(t.at)}`).join(' · ') : '예정 없음', '/s/marketing/calendar'],
    ['이번 주 게시', `${data.kpi.week.done}/${data.kpi.week.done + data.kpi.week.planned}`, '완료/예정', '/s/marketing/calendar'],
    data.kpi.ads ? ['7일 광고비', won(data.kpi.ads.cost7), `클릭 ${data.kpi.ads.clicks7.toLocaleString('ko-KR')} · 문의 ${data.kpi.calls7}`, '/s/marketing/ads'] : ['7일 문의', `${data.kpi.calls7}건`, '광고 연결 없음', '/s/marketing/calls'],
  ];
  const sections: Record<string, React.ReactNode> = {
    chat: <HomeChat key="chat" />,
    kpi: <div key="kpi" className="space-y-2"><section className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="mkt-home-kpi">
      {kpi.map(([l, v, sub, href]) => <Link key={l} href={href} className="rounded-card border border-line bg-white p-3 shadow-card hover:border-violet-300" data-testid="mkt-kpi"><div className="text-[11px] text-ink-2">{l}</div>
<div className="text-xl font-bold tabular-nums" style={{ color: C }}>{v}</div><div className="truncate text-[11px] text-ink-3">{sub}</div></Link>)}
    </section>
      {/* 대표 10/20 15:40 (#103): 이번 달 남은 제작 n건 · 초과 안내 */}
      {data.production && data.production.leftCredits !== null && <Link href="/s/marketing/automation" className={cx('block rounded-card border p-3 text-sm shadow-card hover:border-violet-300', data.production.over ? 'border-red-200 bg-red-50/40' : 'border-line bg-white')} data-testid="mkt-home-production">
        <b>이번 달 남은 제작</b> <span className="tabular-nums">이미지 {data.production.images}장 또는 영상 {data.production.videos}편 <span className="text-xs text-ink-3">(크레딧 {data.production.leftCredits}/{data.production.monthlyCredits}{data.production.planLabel ? ` · ${data.production.planLabel}` : ''})</span></span>
        {data.production.overMessage && <div className="mt-1 text-xs text-red-800">{data.production.overMessage}</div>}</Link>}
      {/* 대표 10/20 18:00 ②: 이번 달 목표 n/m 막대(승인된 목표) — 없으면 [목표 만들기] */}
      {data.goal ? <Link href="/s/marketing/goals" className="block rounded-card border border-line bg-white p-3 shadow-card hover:border-violet-300" data-testid="mkt-home-goal">
        <div className="flex flex-wrap items-center gap-2 text-sm"><b>이번 달 목표</b>{data.goal.status === 'pending' && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800">초안 — 승인 필요</span>}
          <span className="text-xs text-ink-2">{data.goal.objectives[0] ?? ''}</span>{data.goal.weekTopic && <span className="ml-auto text-xs text-ink-3">{data.goal.week}주 주제 · {data.goal.weekTopic}</span>}</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 text-xs">{([['게시', data.goal.posts.done, data.goal.posts.target, '건'], ['문의', data.goal.inquiries.done, data.goal.inquiries.target, '건'], ['광고비', data.goal.adCost.spent, data.goal.adCost.budget, '원']] as [string, number, number | null, string][]).map(([l, d, t, u]) => (
          <div key={l}><div className="flex justify-between"><span className="text-ink-2">{l}</span><span className="tabular-nums" data-testid={`mkt-goal-${l}`}>{u === '원' ? d.toLocaleString('ko-KR') : d}{t ? `/${u === '원' ? t.toLocaleString('ko-KR') : t}` : ''}{u}</span></div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${t ? Math.min(100, Math.round((d / t) * 100)) : 0}%`, background: C }} /></div></div>))}</div>
      </Link> : data.canEdit ? <Link href="/s/marketing/goals" className="block rounded-card border border-dashed border-line p-3 text-center text-xs text-ink-2 hover:border-violet-300" data-testid="mkt-home-goal-none">이번 달 운영 목표가 없습니다 — AI 초안 만들기 →</Link> : null}
      {/* 대표 10/20 20:00 ③ 월 매출 목표 vs 실적(영업 계약 + 워크인 결제) */}
      <RevenueGoal canEdit={data.canEdit} />
    </div>,
    approve: <section key="approve" className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="mkt-home-now">
      <h2 className="flex items-center justify-between text-base font-bold" data-testid="mkt-home-head"><span>{data.kpi.approvalsDetail.contents ? <>① 지금 승인할 것 <span className="text-orange-700">{data.kpi.approvalsDetail.contents}건</span></> : '① 지금 승인할 것 없음 ✓'}</span>
        {data.kpi.approvalsDetail.contents > 0 && <Link href="/s/marketing/approvals" className="text-xs font-medium" style={{ color: C }}>전체 →</Link>}</h2>
      {data.approve.length ? <ul className="divide-y divide-line">{data.approve.map((c) => (
        <li key={c.id} className="flex gap-3 py-2" data-testid="mkt-home-approve">
          <Thumb media={c.media} mime={(c as any).mediaMime} channel={c.channel} />
          <div className="min-w-0 flex-1"><ApproveRow c={c} canDecide={data.canEdit} onDone={reload} />
            <Link href={`/s/marketing/approvals?c=${c.id}`} className="text-xs underline" data-testid="mkt-home-preview">미리보기</Link></div>
        </li>))}</ul>
        : <p className="mt-1 text-xs text-ink-3">새 시안이 올라오면 마감 임박 순으로 여기에 보입니다.</p>}
    </section>,
    queue: <section key="queue" className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="mkt-home-queue">
      <h2 className="flex items-center justify-between text-base font-bold"><span>AI 작업 큐 <span className="text-sm font-normal text-ink-3">대기 → 실행 중 → 완료</span></span><Link href="/s/marketing/automation" className="text-xs font-medium" style={{ color: C }}>자동 제작 →</Link></h2>
      {data.queue.length ? <ul className="divide-y divide-line text-sm">{data.queue.map((q) => (
        <li key={`${q.kind}:${q.id}`} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="mkt-queue-row" data-state={q.state}>
          <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', STATE[q.state][1])}>{STATE[q.state][0]}</span>
          {q.night && <span className="text-[11px] text-violet-700" title="밤사이 비서">🌙</span>}
          <Link href={q.href} className="min-w-0 flex-1 truncate hover:underline">{q.title}</Link>
          {q.note && <span className="text-[11px] text-ink-3">{q.note}</span>}
          {q.at && <span className="text-[11px] text-ink-3">{whenLabel(q.at)}</span>}
          {q.canRun && <Button size="sm" variant="secondary" disabled={busy === q.id} onClick={() => act({ action: 'run', kind: q.kind, id: q.id }, q.id, '실행했습니다')} data-testid="mkt-queue-run"><Play className="size-3.5" />지금 실행</Button>}
          {q.canNight && <Button size="sm" variant="secondary" disabled={busy === q.id} onClick={() => act({ action: 'night', kind: q.kind, id: q.id }, q.id, '오늘 밤 22시에 실행합니다')} data-testid="mkt-queue-night"><Moon className="size-3.5" />밤에</Button>}
        </li>))}</ul>
        : <p className="mt-1 text-xs text-ink-3">기다리는 AI 작업이 없습니다. 자동 제작 규칙·광고 개선안·문서 작업·문자/견적 시안이 여기에 모입니다.</p>}
      {data.night.length > 0 && <div className="mt-3 rounded-input border border-violet-200 bg-violet-50/40 p-2 text-sm" data-testid="mkt-home-night">
        <div className="font-semibold">🌙 밤사이 결과 <span className="font-normal text-ink-3">{data.night.length}건</span></div>
        <ul className="mt-1 space-y-0.5 text-xs">{data.night.map((n) => <li key={n.id}><Link href={n.kind === 'doc' ? '/assistant?space=marketing' : `/s/marketing/approvals?c=${n.id}`} className="hover:underline">{n.title}</Link></li>)}</ul>
      </div>}
      {data.canEdit && !Object.values(data.nightScope).some(Boolean) && <p className="mt-2 text-[11px] text-ink-3">밤사이 비서는 꺼져 있습니다 — 관리 › AI 사용 내역 › 보관·한도 설정에서 범위를 켭니다(돈·외부 발송은 자동 아님).</p>}
    </section>,
    week: <section key="week" className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="mkt-home-week">
      <h2 className="flex items-center justify-between text-base font-bold"><span>② 이번 주 게시</span><Link href="/s/marketing/calendar" className="text-xs font-medium" style={{ color: C }}>콘텐츠 캘린더 →</Link></h2>
      <div className="mt-2 grid grid-cols-7 gap-1">{data.week.map((d, i) => (
        <Link key={d.day} href="/s/marketing/calendar" className={cx('rounded-input border p-1.5 text-center', i === 0 ? 'border-violet-300 bg-violet-50/40' : 'border-line')} data-testid="mkt-week-day" title={d.posts.map((p) => p.title).join('\n')}>
          <div className="text-[11px] text-ink-2">{i === 0 ? '오늘' : `${dayShort(d.day)}(${wd(d.day)})`}</div>
          <div className="mt-1 flex min-h-[14px] flex-wrap justify-center gap-0.5">{d.posts.map((p) => <span key={p.id} className={cx('size-2.5 rounded-full', p.status === 'published' ? 'ring-1 ring-emerald-500 ring-offset-1' : '')} style={{ background: CH_COLOR[p.channel] ?? CH_COLOR.other }} data-testid="mkt-week-row" />)}</div>
        </Link>))}</div>
      <p className="mt-1 text-[11px] text-ink-3">점 색 = 채널(인스타 분홍·페북 파랑·블로그 초록·유튜브 빨강), 초록 테두리 = 게시됨</p>
    </section>,
    perf: <section key="perf" className="grid gap-3 md:grid-cols-2" data-testid="mkt-home-perf">
      <div className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="flex items-center justify-between text-base font-bold"><span>③ 성과 <span className="text-sm font-normal text-ink-3">최근 7일</span></span><Link href="/s/marketing/ads" className="text-xs font-medium" style={{ color: C }}>자세히 →</Link></h2>
        <div className="mt-2 grid grid-cols-3 gap-2 text-sm">{([['광고비', won(cost7)], ['전화·문의', `${calls7}건`], ['문의 1건당', calls7 ? won(cost7 / calls7) : '—']] as [string, string][]).map(([l, v]) => <div key={l} className="rounded-input bg-slate-50 p-2" data-testid="mkt-perf-card"><div className="text-[11px] text-ink-2">{l}</div><div className="text-base font-bold tabular-nums">{v}</div></div>)}</div>
        <svg viewBox="0 0 140 44" className="mt-2 h-14 w-full" role="img" aria-label="최근 7일 광고비·문의" data-testid="mkt-perf-chart">
          {data.perf.map((p, i) => <rect key={p.day} x={i * 20 + 4} y={40 - (p.cost / maxCost) * 30} width={12} height={(p.cost / maxCost) * 30} rx={2} fill="#C4B5FD" />)}
          <polyline points={data.perf.map((p, i) => `${i * 20 + 10},${40 - (p.calls / maxCalls) * 30}`).join(' ')} fill="none" stroke="#7C3AED" strokeWidth={1.5} />
          {data.perf.map((p, i) => <text key={p.day} x={i * 20 + 10} y={44} fontSize={5} textAnchor="middle" fill="#94A3B8">{dayShort(p.day)}</text>)}
        </svg>
      </div>
      <div className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="mkt-home-ads">
        <h2 className="flex items-center justify-between text-base font-bold"><span>광고</span><Link href="/s/marketing/ad-ops" className="text-xs font-medium" style={{ color: C }}>광고 운영 →</Link></h2>
        {data.ads ? <>
          <p className="mt-1 text-sm">캠페인 켜짐 <b>{data.ads.on}</b> · 꺼짐 {data.ads.off}{data.ads.monthlyCap !== null && <> · 월 상한 {won(data.ads.monthlyCap)}{data.ads.stopped && <span className="ml-1 rounded-full bg-red-50 px-1.5 text-[11px] text-red-700">상한 도달</span>}</>} · 오늘 지출 {won(data.ads.today)}</p>
          {data.ads.campaigns.length > 0 && <ul className="mt-1 divide-y divide-line text-xs">{data.ads.campaigns.map((c) => <li key={c.id} className="flex items-center gap-2 py-1"><span className="min-w-0 flex-1 truncate">{c.name}</span><span className="tabular-nums text-ink-2">CTR {c.ctr ?? '—'}%</span><span className="tabular-nums text-ink-2">CPC {c.cpc !== null ? won(c.cpc) : '—'}</span></li>)}</ul>}
          <p className="mt-1 text-[11px] text-ink-3">{data.ads.suggestions ? `개선안 ${data.ads.suggestions}건 대표 승인 대기` : '개선안 없음'} · [켜기]는 대표 승인(광고 운영 화면)</p>
        </> : <p className="mt-1 text-xs text-ink-3">광고 계정을 연결하면 캠페인 상태·예산·오늘 지출·소재별 CTR/CPC 가 여기에 보입니다.</p>}
      </div>
    </section>,
    recent: <section key="recent" className="grid gap-3 md:grid-cols-2" data-testid="mkt-home-recent">
      <div className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-base font-bold">④ 최근 게시물</h2>
        {data.recent.length ? <div className="mt-2 grid grid-cols-3 gap-1.5">{data.recent.map((r) => <a key={r.id} href={r.published_url ?? `/s/marketing/approvals?c=${r.id}`} target={r.published_url ? '_blank' : undefined} rel="noopener noreferrer" className="block" title={r.title} data-testid="mkt-recent"><Thumb media={r.media} mime={(r as any).mediaMime} channel={r.channel} size="aspect-square w-full" /><div className="mt-0.5 truncate text-[11px] text-ink-2">{r.title}</div></a>)}</div>
          : <p className="mt-1 text-xs text-ink-3">아직 게시한 글이 없습니다.</p>}
      </div>
      <div className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="mkt-home-suggest">
        <h2 className="text-base font-bold">다음 할 일 제안 <span className="text-sm font-normal text-ink-3">회사 상황으로 {data.suggestions.length}개</span></h2>
        {data.suggestions.length ? <ul className="mt-1 space-y-1 text-sm">{data.suggestions.map((s) => (
          <li key={s.key} className="flex items-start gap-2" data-testid="mkt-suggest-row">
            <input type="checkbox" className="mt-1" checked={picked.has(s.key)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(s.key); else n.delete(s.key); setPicked(n); }} aria-label={s.title} />
            <span className="min-w-0 flex-1"><Link href={s.href} className="font-medium hover:underline">{s.title}</Link><span className="block text-xs text-ink-3">{s.detail}</span></span>
          </li>))}</ul> : <p className="mt-1 text-xs text-ink-3">지금 당장 할 일이 없습니다 ✓</p>}
        {data.suggestions.length > 0 && <Button size="sm" className="mt-2" disabled={!picked.size || busy === 'task'} onClick={async () => { await act({ action: 'task', keys: [...picked] }, 'task', '업무로 만들었습니다'); setPicked(new Set()); }} data-testid="mkt-suggest-task">업무로 만들기{picked.size ? ` (${picked.size})` : ''}</Button>}
      </div>
    </section>,
    channels: <section key="channels" className="rounded-card border border-line bg-white px-4 py-3 shadow-card" data-testid="mkt-home-channels">
      <Link href="/s/marketing/connections" className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs" data-testid="mkt-channel-line">
        <span className="font-semibold">⑤ 채널</span>
        {chs.map((c) => <span key={c.key} className="inline-flex items-center gap-1" data-testid="mkt-channel-dot" data-state={c.state} title={`${c.label}: ${CH_STATE[c.state]}${c.account ? ` (${c.account})` : ''}`}>
          <span className="size-2 rounded-full" style={{ background: CH_DOT[c.state] }} />{c.label}{c.state === 'connected' && c.account ? <span className="text-ink-3">· {c.account}</span> : c.state !== 'connected' ? <span className="text-ink-3">· {CH_STATE[c.state]}</span> : null}</span>)}
      </Link>
    </section>,
  };
  return (
    <div className="mx-auto max-w-4xl space-y-3" data-testid="space-home-marketing">
      <div className="flex items-center justify-between"><h1 className="text-xl font-bold" style={{ color: C }}>홈</h1>
        <button type="button" onClick={() => setCfg(true)} className="inline-flex items-center gap-1 rounded-input px-2 py-1 text-xs text-ink-2 hover:bg-slate-100" aria-label="홈 카드 구성" data-testid="mkt-home-config"><Settings2 className="size-4" />카드 구성</button></div>
      {broken.map((c) => (
        <div key={c.key} className="flex flex-wrap items-center gap-2 rounded-card border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="mkt-broken-banner">
          <span className="min-w-0 flex-1"><b>{c.label}</b> 연결이 끊겼습니다{c.account ? ` (${c.account})` : ''}</span>
          {data.canEdit && <ConnectButton ch={c} onNaver={() => setNaver(true)} label="다시 연결" />}
        </div>))}
      {linked === 0 && data.canEdit && <ChannelSetup channels={chs} onNaver={() => setNaver(true)} />}
      {data.cards.cards.filter(on).map((k) => sections[k])}
      {naver && <NaverForm onClose={() => setNaver(false)} onDone={() => { setNaver(false); reload(); }} />}
      {cfg && <CardSettings home={data} onClose={() => setCfg(false)} onDone={() => { setCfg(false); reload(); }} />}
    </div>
  );
}
