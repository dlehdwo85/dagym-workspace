'use client';
import { dtf } from '@/lib/dtf';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Check, Download, ExternalLink, ListPlus, Plus, Sparkles } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { PortalApplyLink, portalService } from './PortalApply';

/** #450 영업실 '지원사업' — 기업마당·K-Startup·기관 공지 공고를 회사 프로필로 맞춤(1차 규칙 + AI 세일즈 판단) → 관심·신청 준비(담당 업무·마감 알림) → 신청·선정·탈락 기록 */
const C = '#2563EB';
type Flag = { level: 'ok' | 'warn' | 'no'; text: string; need?: string };
/** #783 기대 효과 */
type Effect = { receive: string; amount: string | null; selfPay: string | null; prepHours: number | null; perBusiness: { brand: string; line: string }[]; confirm: string[] };
type Ai = { verdict: 'fit' | 'maybe' | 'no'; reasons: string[]; brands: string[]; docs: string[]; summary: string | null; at: string | null; use: string[]; schedule: string | null; auto: boolean; stale?: boolean; effect?: Effect | null };
/** #568 주 1회 묶음 — 이번 주 맞는 공고(AI ✅ 또는 1차 ✅) 상위 10건 */
type Weekly = { week: string; items: { id: string; title: string; by: 'ai' | 'rule'; dday: number | null; applyEnd: string | null; agency: string | null; brands: string[]; use: string | null; auto: boolean }[]; aiCount: number; aiFailed: number; sentTo: number; createdAt: string };
type Work = { id: string; status: string; statusLabel: string; ownerId: string | null; ownerName: string | null; taskId: string | null; brands: string[]; appliedAt: string | null; resultAt: string | null; amountAwarded: string | null; resultMemo: string | null; memo: string | null };
type Item = { id: string; title: string; agency: string | null; executor: string | null; category: string | null; source: string; sourceLabel: string; regions: string[]; nationwide: boolean; applyStart: string | null; applyEnd: string | null;
  applyText: string | null; dday: number | null; amount: string | null; amountKrw: number | null; kinds: string[]; url: string | null; applyUrl: string | null; manual: boolean; mine: boolean; isNew: boolean; target: string | null; alsoOn: string[]; pending?: boolean; queued?: boolean; listed?: boolean; listedAt?: string | null;
  final?: { verdict: 'fit' | 'maybe' | 'no'; by: 'ai' | 'rule'; conflict: boolean };
  rule: { score: number; verdict: 'fit' | 'maybe' | 'no'; flags: Flag[] }; ai: Ai | null; hidden: boolean; work: Work | null };
type View = { sort: string | null; dd: string; kind: string; aud?: string };
type Blanks = { fields: { key: string; label: string; items: number }[]; items: number };
type ListData = { tab: string; today: string; items: Item[]; total: number; counts: Record<string, number>; hiddenNo: number; weekly: Weekly | null; canEdit: boolean; platformAdmin: boolean; aiOn: boolean; people: { id: string; name: string }[];
  view: View; sortUsed: string; chips: { dd: Record<string, number>; kind: Record<string, number>; aud?: Record<string, number> } | null; kindLabel: Record<string, string>; audLabel?: Record<string, string>; pendingCount: number; blanks: Blanks; aiCostKrw: number | null; weeklyAiMax: number;
  auto: { on: boolean; enabled: boolean; saved: boolean; queue: number; stopped: string | null; left: number; at: string | null; done: number };
  profile: { saved: boolean; filled: boolean; autoAi: boolean; region: string | null; sigungu: string | null; size: string | null; founded: string | null; interests: string[]; brands: string[] };
  sources: { slug: string; label: string; last_run_at: string | null; last_status: string | null; summary: string | null }[]; bySource?: { counts: { source: string; label: string; n: number }[]; lastAt: string | null }; keys: { bizinfo: boolean; datago: boolean }; statusLabel: Record<string, string> };

const TABS: [string, string][] = [['fit', '맞춤'], ['closing', '마감 임박'], ['list', '신청 목록'], ['mine', '관심·준비'], ['results', '신청·결과'], ['all', '전체']];
/** #781 정렬·D-day·종류(사람별 기억) */
const SORTS: [string, string][] = [['fit', '맞춤 순'], ['deadline', '마감 임박 순'], ['new', '새로 올라온 순'], ['amount', '지원 금액 큰 순']];
const DDS: [string, string, string][] = [['all', '전체', ''], ['d3', 'D-3', '오늘부터 3일 안 마감'], ['d7', 'D-7', '7일 안 마감'], ['d14', 'D-14', '14일 안 마감'], ['d30', 'D-30', '30일 안 마감'], ['open', '상시·예산 소진', '마감일 없음(상시·예산 소진 시·마감 미정)']];
const won = (n: number) => `약 ${n.toLocaleString('ko-KR')}원`;
const VERDICT: Record<string, [string, string, string]> = { fit: ['✅', '해당', 'border-emerald-200 bg-emerald-50 text-emerald-800'], maybe: ['⚠', '확인 필요', 'border-amber-200 bg-amber-50 text-amber-800'], no: ['❌', '해당 없음', 'border-red-200 bg-red-50 text-red-700'] };
const FLAG_CLS: Record<Flag['level'], string> = { ok: 'bg-emerald-50 text-emerald-800', warn: 'bg-amber-50 text-amber-800', no: 'bg-red-50 text-red-700' };
const STATUS_CLS: Record<string, string> = { interest: 'bg-sky-50 text-sky-800', preparing: 'bg-blue-600 text-white', applied: 'bg-violet-50 text-violet-800', selected: 'bg-emerald-600 text-white', rejected: 'bg-slate-200 text-ink-2', dropped: 'bg-slate-100 text-ink-3' };
const STEPS: [string, string][] = [['interest', '관심'], ['preparing', '신청 준비'], ['applied', '신청 완료'], ['selected', '선정'], ['rejected', '탈락'], ['dropped', '포기']];
const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const kday = (d: string | null) => (d ? dtf('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${d}T12:00:00+09:00`)) : '');
const linkCls = 'inline-flex min-h-[32px] items-center gap-1 rounded-input border border-line bg-white px-2.5 text-xs font-medium text-ink-2';
const csv = (s: string) => s.split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);

function Dday({ d, text }: { d: number | null; text?: string | null }) {
  if (d == null) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2" data-testid="support-dday">{text && /상시|소진|수시/.test(text) ? '상시·소진 시' : '마감 미정'}</span>;
  const cls = d < 0 ? 'bg-slate-100 text-ink-3' : d <= 3 ? 'bg-red-600 text-white' : d <= 7 ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-ink-2';
  return <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', cls)} data-testid="support-dday">{d < 0 ? '마감' : d === 0 ? 'D-day' : `D-${d}`}</span>;
}
function Verdict({ it }: { it: Pick<Item, 'ai' | 'rule' | 'queued' | 'final'> }) {
  // 로컬 10/28 23:50: 규칙 '해당 없음'이 AI '확인 필요'보다 앞섬(서버 final) — AI '해당'인데 규칙 '해당 없음'이면 옆에 '규칙과 다름 · 확인'
  const f = it.final ?? { verdict: it.ai?.verdict ?? it.rule.verdict, by: it.ai ? 'ai' : 'rule', conflict: false };
  const v = f.verdict;
  if (it.queued && !it.ai) return <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" data-testid="support-verdict" data-verdict={v} data-by="rule" data-queued="1"
    title="새 공고 자동 AI 판단 차례 — 정기 실행(15분마다) 때 차례로 판단합니다(회사 AI 예산에서)">⏳ AI 확인 중</span>; // #785: 실제로 판단 차례에 있을 때만
  // #649 ③: 1차 규칙만 맞는 공고는 '해당'이 아님 — #782(대표 10/28 "AI 확인 중이라고 왜?"): 판단 차례가 아니면 '규칙상 맞음 · AI 판단 전'(사람이 [AI 판단]을 눌러야 정해짐)
  const pending = !it.ai && v === 'fit';
  const [icon, label, cls] = pending ? ['', '규칙상 맞음 · AI 판단 전', 'border-sky-200 bg-sky-50 text-sky-800'] : VERDICT[v];
  return <><span className={cx('shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold', cls)} data-testid="support-verdict" data-verdict={v} data-by={f.by} data-pending={pending ? '1' : undefined}
    title={f.by === 'ai' ? 'AI 세일즈 판단' : it.ai ? `1차 규칙이 자격 '해당 없음'으로 봄(AI 는 '${VERDICT[it.ai.verdict][1]}')` : pending ? '지역·업력·규모·업종 규칙으로는 맞음 — 참여 가능 여부는 [AI 판단]을 눌러야 정해집니다' : '1차 규칙 판단(지역·업력·규모·업종·관심 분야)'}>{icon ? `${icon} ` : ''}{label}{!pending && <span className="ml-1 font-normal opacity-70">{f.by === 'ai' ? 'AI' : '1차'}</span>}</span>
    {f.conflict && <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900" data-testid="support-rule-conflict" title="AI 는 '해당', 1차 규칙(지역·대상·업종 등)은 '해당 없음' — 원문으로 확인하세요">규칙과 다름 · 확인</span>}</>;
}
const Flags = ({ flags, max }: { flags: Flag[]; max?: number }) => (
  <div className="flex flex-wrap gap-1" data-testid="support-flags">{flags.slice(0, max ?? flags.length).map((f, i) => <span key={i} className={cx('rounded-full px-1.5 py-0.5 text-[11px]', FLAG_CLS[f.level])} data-level={f.level}>{f.level === 'ok' ? '✓' : f.level === 'no' ? '✕' : '!'} {f.text}</span>)}
    {max != null && flags.length > max && <span className="text-[11px] text-ink-3">외 {flags.length - max}</span>}</div>
);

export function Support() {
  const sp = useSearchParams(); const router = useRouter();
  const tab = TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab')! : 'fit'; const openId = sp.get('id');
  const [q, setQ] = useState(''); const [showNo, setShowNo] = useState(false); const [adding, setAdding] = useState(false); const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null); const [bulk, setBulk] = useState(false); // view = 이 화면에서 고친 정렬·칩(처음엔 서버가 기억한 것)
  const qs = new URLSearchParams({ tab, ...(q.trim() ? { q: q.trim() } : {}), ...(showNo ? { showNo: '1' } : {}), ...(view ? { sort: view.sort ?? '', dd: view.dd, kind: view.kind, aud: view.aud ?? 'all' } : {}) }).toString();
  const { data: fresh, error, reload } = useApi<ListData>(`/api/sales/support?${qs}`);
  const [last, setLast] = useState<ListData | null>(null); // 칩을 바꾸는 동안 앞 목록을 그대로 보여 줌(깜빡임 없이)
  useEffect(() => { if (fresh) setLast(fresh); }, [fresh]);
  const data = fresh ?? last;
  const cur: View = view ?? data?.view ?? { sort: null, dd: 'all', kind: 'all', aud: 'all' };
  function pickView(p: Partial<View>) { const next = { ...cur, ...p }; setView(next); api('/api/sales/support/view', { method: 'PUT', body: next }).catch(() => {}); }
  const go = (p: Record<string, string | null>) => { const n = new URLSearchParams(sp.toString()); for (const [k, v] of Object.entries(p)) { if (v == null) n.delete(k); else n.set(k, v); } router.replace(`/s/sales/support${n.toString() ? `?${n}` : ''}`, { scroll: false }); };
  /** #815 누른 직후 [되돌리기] — 처음 누른 것이면 회수(업무 휴지통·진행 기록 처음 상태), 아니면 앞 상태·담당으로 */
  const undoOf = (it: Item) => ({ label: '되돌리기', run: () => {
    const prev = it.work;
    (prev ? api(`/api/sales/support/${it.id}/work`, { body: { status: prev.status, ...(prev.ownerId ? { ownerId: prev.ownerId } : {}) } }) : api(`/api/sales/support/${it.id}/withdraw`, { body: { confirm: true } }))
      .then(() => { toast.ok(prev ? `'${prev.statusLabel}'(으)로 되돌렸습니다` : '되돌렸습니다 — 만든 업무는 휴지통으로 옮겼습니다'); reload(); }).catch((e) => toast.error(e.message));
  } });
  async function act(it: Item, status: 'interest' | 'preparing') {
    setBusy(`${it.id}:${status}`);
    try { await api(`/api/sales/support/${it.id}/work`, { body: { status } }); toast.ok(status === 'interest' ? '관심으로 두고 담당 업무를 만들었습니다 — 마감 7일·3일 전에 알립니다' : '신청 준비 업무(체크리스트)를 만들었습니다 — 마감 7일·3일 전에 알립니다', undoOf(it)); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function analyze(it: Item) {
    setBusy(`${it.id}:ai`);
    try { const r = await api<{ costKrw: number }>(`/api/sales/support/${it.id}/analyze`, { body: {} }); toast.ok(`AI 세일즈가 판단했습니다(${won(r.costKrw)})`); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function listIt(it: Item, on: boolean) {
    setBusy(`${it.id}:list`);
    try { await api(`/api/sales/support/${it.id}/list`, { body: { on } }); toast.ok(on ? '이번 주 신청 목록에 담았습니다' : '신청 목록에서 뺐습니다', on ? { label: '목록 보기', run: () => go({ tab: 'list' }) } : undefined); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function toTask(it: Item, ownerId: string) {
    setBusy(`${it.id}:task`);
    try { await api(`/api/sales/support/${it.id}/work`, { body: { status: 'preparing', ...(ownerId ? { ownerId } : {}) } }); toast.ok('담당에게 신청 준비 업무를 넘겼습니다 — 서류 체크리스트·마감 7일·3일 전 알림', undoOf(it)); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function hide(it: Item, hidden: boolean) {
    try { await api(`/api/sales/support/${it.id}/hide`, { body: { hidden } }); reload(); if (hidden) toast.ok('맞춤 목록에서 숨겼습니다', { label: '되돌리기', run: () => { api(`/api/sales/support/${it.id}/hide`, { body: { hidden: false } }).then(reload).catch(() => {}); } }); }
    catch (e: any) { toast.error(e.message); }
  }
  type TopR = { asked: number; done: number; failed: number; costKrw: number; error: string | null; left: number; stopped: boolean };
  async function analyzeTop(n: number) {
    setBusy('top');
    try {
      const r = await api<TopR>('/api/sales/support/analyze-top', { body: { n } }); setBulk(false);
      if (r.failed) toast.error(`${r.done}건 판단, ${r.failed}건 실패${r.error ? `(${r.error})` : ''}`); else toast.ok(r.asked ? `위에서 ${r.done}건을 AI 세일즈가 판단했습니다(${won(r.costKrw)})` : '판단할 공고가 없습니다'); reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  // 269차 #803 [대기 중인 공고 모두 AI 판단](로컬 20:45: 마케팅 승인함과 헷갈리지 않게 '지원사업 공고'로): 20건씩 이어서(4건씩 같이) — 한도·예산에 걸리거나 [멈추기]를 누르면 멈춤
  const [allRun, setAllRun] = useState<{ done: number; total: number; costKrw: number } | null>(null);
  const stopAll = useRef(false);
  async function analyzeAll(total: number) {
    setBusy('top'); stopAll.current = false; let done = 0, failed = 0, costKrw = 0, error: string | null = null, stopped = false;
    setAllRun({ done: 0, total, costKrw: 0 });
    try {
      for (let k = 0; k < 50 && !stopAll.current; k++) {
        const r = await api<TopR>('/api/sales/support/analyze-top', { body: { n: 20 } });
        done += r.done; failed += r.failed; costKrw += r.costKrw; error ??= r.error; stopped = r.stopped;
        setAllRun({ done, total: done + r.left, costKrw });
        if (!r.asked || !r.left || stopped || !r.done) break;
      }
      setBulk(false);
      const msg = `AI 세일즈가 ${done}건을 판단했습니다(${won(costKrw)})`;
      if (stopped) toast.error(`${msg}. AI 예산이나 한도에 걸려 멈췄습니다${error ? `(${error})` : ''}`);
      else if (failed) toast.error(`${msg}. ${failed}건은 실패했습니다${error ? `(${error})` : ''}`);
      else toast.ok(stopAll.current ? `${msg}. 멈췄습니다` : msg);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); setAllRun(null); reload(); }
  }
  async function weeklyNow() {
    setBusy('weekly');
    try { const r = await api<{ items: number; aiCount: number; aiFailed: number; aiError: string | null }>('/api/sales/support/weekly', { body: {} }); toast.ok(`이번 주 맞는 공고 ${r.items}건으로 묶었습니다${r.aiCount ? ` · AI 세일즈가 새로 판단 ${r.aiCount}건` : ''}${r.aiFailed ? ` · 판단 실패 ${r.aiFailed}건${r.aiError ? ` — ${r.aiError}` : ''}` : ''}`); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  if (error && !data) return <ErrorBox error={error} retry={reload} />;
  const noKeys = data && !data.keys.bizinfo && !data.keys.datago;
  return (
    <div className="mx-auto max-w-5xl space-y-3" data-testid="sales-support">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>지원사업</h1>
        <span className="text-xs text-ink-2">정부·지자체 지원사업 공고를 우리 회사 기준으로 걸러 봅니다</span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          <input className={cx(inputCls, 'h-8 w-40 py-1 text-sm')} value={q} onChange={(e) => setQ(e.target.value)} placeholder="찾기" aria-label="공고 찾기" data-testid="support-search" />
          {data?.canEdit && data.aiOn && data.pendingCount > 0 && <Button size="sm" variant="secondary" disabled={busy === 'top'} onClick={() => setBulk(true)} data-testid="support-analyze-top"><Sparkles className="size-3.5" aria-hidden />{busy === 'top' ? '판단 중…' : '공고 여러 건 AI 판단'}</Button>}
          <Button size="sm" onClick={() => setAdding(true)} data-testid="support-add"><Plus className="size-3.5" aria-hidden />직접 추가</Button>
        </span>
      </div>
      {noKeys && <div className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="support-keys-needed"><b>원천 인증키 입력 필요</b> — 기업마당 인증키(또는 공공데이터포털 인증키)가 들어가면 하루 두 번(08·14시) 새 공고를 가져옵니다. {data!.platformAdmin ? <Link href="/platform" className="underline">플랫폼 운영 › 영업 수집기 설정</Link> : '플랫폼 운영자에게 요청해 주세요.'} 그 전에도 [직접 추가]로 공고·지난 신청 이력을 넣을 수 있습니다.</div>}
      <ProfileBox summary={data?.profile ?? null} blanks={data?.blanks ?? null} onSaved={reload} />
      <div className="flex flex-wrap gap-1.5" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => go({ tab: k === 'fit' ? null : k })}
        className={cx('rounded-full border px-3 py-1 text-xs', tab === k ? 'border-transparent font-semibold text-white' : 'border-line bg-white')} style={tab === k ? { background: C } : undefined} data-testid={`support-tab-${k}`}>{l} <span className="tabular-nums">{data?.counts?.[k] ?? ''}</span></button>)}</div>
      {!data ? <Skeleton rows={5} /> : <>
        {data.bySource && <p className="text-[11px] text-ink-3" data-testid="support-source-counts">출처(열린 공고) {data.bySource.counts.map((c) => `${c.label} ${c.n}`).join(' · ')}{data.bySource.lastAt ? ` · 마지막 수집 ${fmtDateTime(data.bySource.lastAt)}` : ''}</p>}
        {data.chips && <ViewBar data={data} cur={cur} onPick={pickView} />}
        {tab === 'fit' && (data.weekly || (data.canEdit && data.aiOn)) && <WeeklyBox weekly={data.weekly} canEdit={data.canEdit && data.aiOn} auto={data.weeklyAiMax} busy={busy === 'weekly'} onNow={weeklyNow} onOpen={(id) => go({ id })} />}
        {tab === 'fit' && <AutoNote data={data} />}
        {tab === 'fit' && <p className="text-xs text-ink-3">1차 규칙 = 본점 지역·시·군, 업력, 규모·상시근로자, 업종, 인증, 관심 분야.{data.hiddenNo > 0 && <> 자격이 안 맞는 공고 {data.hiddenNo}건은 빼고 보여 줍니다 — <button type="button" className="underline" onClick={() => setShowNo(true)} data-testid="support-show-no">보기</button></>}{showNo && <> · <button type="button" className="underline" onClick={() => setShowNo(false)}>다시 빼기</button></>}</p>}
        {tab === 'list' && <ApplyList data={data} busy={busy} onOpen={(id) => go({ id })} onTask={toTask} onUnlist={(it) => listIt(it, false)} />}
        <ul className={cx('space-y-2', tab === 'list' && 'hidden')} data-testid="support-list">{tab !== 'list' && data.items.map((it) => (
          <li key={it.id} className={cx('rounded-card border bg-white p-3 shadow-card', it.work ? 'border-blue-200' : 'border-line')} data-testid="support-item" data-id={it.id} data-status={it.work?.status ?? ''}>
            <div className="flex flex-wrap items-start gap-1.5">
              <Verdict it={it} />
              {it.ai?.stale && <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-ink-2" data-testid="support-ai-stale" title="AI 판단 뒤 회사 프로필(지역·규모·근로자·매출·업종·인증)이 바뀌었습니다">{it.queued ? '예전 프로필 기준 · 다시 판단 차례' : '예전 프로필 기준'}</span>}
              <button type="button" onClick={() => go({ id: it.id })} className="min-w-0 flex-1 text-left text-sm font-semibold hover:underline" data-testid="support-open">{it.title}</button>
              {it.isNew && <span className="rounded-full bg-rose-50 px-1.5 text-[10px] font-bold text-rose-700">NEW</span>}
              <Dday d={it.dday} text={it.applyText} />
            </div>
            <p className="mt-1 text-xs text-ink-2">{[it.agency, it.executor && it.executor !== it.agency ? it.executor : null, it.regions.length ? it.regions.join('·') : it.nationwide ? '전국' : null,
              it.applyEnd ? `마감 ${kday(it.applyEnd)}` : it.applyText, it.amount && `지원 ${it.amount}`].filter(Boolean).join(' · ')}
              {it.kinds.length > 0 && <span className="ml-1 inline-flex flex-wrap gap-0.5 align-middle" data-testid="support-kinds">{it.kinds.map((k) => <span key={k} className="rounded bg-slate-100 px-1 text-[10px] text-ink-2">{data.kindLabel[k] ?? k}</span>)}</span>}
              <span className="text-ink-3"> · 출처 {it.sourceLabel}{it.alsoOn.length ? `(+${it.alsoOn.join('·')})` : ''}</span></p>
            <div className="mt-1.5"><Flags flags={it.rule.flags} max={4} /></div>
            {it.ai?.effect?.receive && <p className="mt-1.5 text-xs text-ink-2" data-testid="support-effect-line"><b className="font-semibold text-ink">받는 것</b> {it.ai.effect.receive}{it.ai.effect.amount ? ` · ${it.ai.effect.amount}` : ''}{it.ai.effect.prepHours ? ` · 준비 약 ${it.ai.effect.prepHours}시간` : ''}</p>}
            {it.ai && <p className="mt-1.5 text-xs text-ink-2" data-testid="support-ai-line"><Sparkles className="mr-0.5 inline size-3 text-violet-600" aria-hidden />{it.ai.use[0] ? `접목: ${it.ai.use[0]}` : it.ai.reasons[0] ?? it.ai.summary}{it.ai.brands.length > 0 && <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">{it.ai.brands.map((b) => <span key={b} className="rounded-full border border-violet-200 bg-violet-50 px-1.5 text-[11px] text-violet-800">{b}</span>)}</span>}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {it.work ? <><span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_CLS[it.work.status])} data-testid="support-status">{it.work.statusLabel}</span>
                <span className="text-xs text-ink-2">{it.work.ownerName ? `담당 ${it.work.ownerName}` : ''}{it.work.appliedAt ? ` · 신청 ${kday(it.work.appliedAt)}` : ''}{it.work.resultMemo ? ` · ${it.work.resultMemo.slice(0, 40)}` : ''}</span>
                {it.work.status === 'interest' && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act(it, 'preparing')} data-testid="support-prepare">신청 준비</Button>}
                <Button size="sm" variant="secondary" onClick={() => go({ id: it.id })}>진행 기록</Button></>
                : <><Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act(it, 'interest')} data-testid="support-interest">{busy === `${it.id}:interest` ? '…' : '관심'}</Button>
                  <Button size="sm" disabled={!!busy} onClick={() => act(it, 'preparing')} data-testid="support-prepare">{busy === `${it.id}:preparing` ? '…' : '신청 준비'}</Button></>}
              {data.aiOn && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => analyze(it)} data-testid="support-analyze" title={data.aiCostKrw != null ? `회사 AI 예산에서 ${won(data.aiCostKrw)}` : undefined}><Sparkles className="size-3.5" aria-hidden />{busy === `${it.id}:ai` ? '판단 중…' : it.ai ? '다시 판단' : `AI 판단${data.aiCostKrw != null ? ` · ${won(data.aiCostKrw)}` : ''}`}</Button>}
              {(!it.work || ['interest', 'preparing'].includes(it.work.status)) && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => listIt(it, !it.listed)} data-testid="support-list-toggle" data-on={it.listed ? '1' : '0'}>{it.listed ? <><Check className="size-3.5" aria-hidden />목록에 담음</> : <><ListPlus className="size-3.5" aria-hidden />목록에 담기</>}</Button>}
              {it.url && <a href={it.url} target="_blank" rel="noopener noreferrer" className={linkCls}><ExternalLink className="size-3.5" aria-hidden />원문</a>}
              {!it.work && !it.manual && <button type="button" className="ml-auto text-xs text-ink-3 underline" onClick={() => hide(it, !it.hidden)} data-testid="support-hide">{it.hidden ? '숨김 풀기' : '숨기기'}</button>}
            </div>
          </li>))}
          {tab !== 'list' && !data.items.length && <li className="rounded-card border border-dashed border-line p-6 text-center text-sm text-ink-3" data-testid="support-empty">{tab === 'mine' ? '관심·신청 준비 중인 공고가 없습니다 — 맞춤 탭에서 [관심]·[신청 준비]를 누르세요' : tab === 'results' ? '신청·결과 기록이 없습니다 — 지난 신청은 [직접 추가]로 넣을 수 있습니다' : '조건에 맞는 공고가 없습니다'}</li>}
        </ul>
        {data.total > data.items.length && <p className="text-center text-xs text-ink-3">위 {data.items.length}건 · 모두 {data.total}건 — 찾기·칩으로 좁혀 보세요</p>}
        <SourceLine sources={data.sources} />
      </>}
      {adding && <ManualAdd people={data?.people ?? []} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); reload(); go({ id }); }} />}
      {bulk && data && <BulkAi pending={data.pendingCount} cost={data.aiCostKrw} busy={busy === 'top'} onRun={analyzeTop} onAll={data.auto.on ? null : () => analyzeAll(data.pendingCount)} run={allRun} onStop={() => { stopAll.current = true; }} onClose={() => { if (!allRun) setBulk(false); }} />}
      {openId && <Detail id={openId} onClose={() => go({ id: null })} onChanged={reload} />}
    </div>
  );
}

/** #568 이번 주 맞는 지원사업 묶음(월요일 아침 자동, 관리자는 [지금 다시 묶기]) — 칩을 누르면 상세 */
/** #781 정렬·D-day·종류 칩(숫자 = 지금 탭·찾기 기준) — 고른 것은 사람별로 기억 */
function ViewBar({ data, cur, onPick }: { data: ListData; cur: View; onPick: (p: Partial<View>) => void }) {
  const chip = (on: boolean) => cx('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-[#2563EB] bg-[#EFF6FF] font-semibold text-[#1D4ED8]' : 'border-line bg-white text-ink-2');
  return (
    <div className="space-y-1.5 rounded-card border border-line bg-white p-2" data-testid="support-viewbar">
      <div className="flex flex-wrap items-center gap-1"><span className="w-10 shrink-0 text-[11px] text-ink-3">정렬</span>
        {SORTS.map(([k, l]) => <button key={k} type="button" aria-pressed={data.sortUsed === k} className={chip(data.sortUsed === k)} onClick={() => onPick({ sort: k })} data-testid={`support-sort-${k}`}>{l}</button>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="w-10 shrink-0 text-[11px] text-ink-3">마감</span>
        {DDS.map(([k, l, t]) => <button key={k} type="button" aria-pressed={cur.dd === k} title={t || undefined} className={chip(cur.dd === k)} onClick={() => onPick({ dd: k })} data-testid={`support-dd-${k}`}>{l} <span className="tabular-nums">{data.chips?.dd[k] ?? 0}</span></button>)}</div>
      <div className="flex flex-wrap items-center gap-1"><span className="w-10 shrink-0 text-[11px] text-ink-3">종류</span>
        {[['all', '전체'] as [string, string], ...Object.entries(data.kindLabel)].map(([k, l]) => <button key={k} type="button" aria-pressed={cur.kind === k} className={chip(cur.kind === k)} onClick={() => onPick({ kind: k })} data-testid={`support-kind-${k}`}>{l} <span className="tabular-nums">{data.chips?.kind[k] ?? 0}</span></button>)}</div>
      {data.audLabel && <div className="flex flex-wrap items-center gap-1"><span className="w-10 shrink-0 text-[11px] text-ink-3">대상</span>
        {[['all', '전체'] as [string, string], ...Object.entries(data.audLabel)].map(([k, l]) => <button key={k} type="button" aria-pressed={(cur.aud ?? 'all') === k} className={chip((cur.aud ?? 'all') === k)} onClick={() => onPick({ aud: k })} data-testid={`support-aud-${k}`}>{l} <span className="tabular-nums">{data.chips?.aud?.[k] ?? 0}</span></button>)}
        {cur.aud === 'small' && <span className="text-[11px] text-ink-3" data-testid="support-aud-small-note">우리 회사에 해당 없는 소상공인 지원도 이유와 함께 보여 줍니다</span>}</div>}
    </div>
  );
}

/** #784 이번 주 신청 목록 — 담은 공고를 마감 순 표로(받는 것·예상 금액·자부담·준비 시간) · [엑셀로] · 담당 고르고 [업무로] = 신청 준비 업무 · [빼기] */
function ApplyList({ data, busy, onOpen, onTask, onUnlist }: { data: ListData; busy: string | null; onOpen: (id: string) => void; onTask: (it: Item, ownerId: string) => void; onUnlist: (it: Item) => void }) {
  const [owner, setOwner] = useState<Record<string, string>>({});
  const hours = data.items.reduce((n, x) => n + (x.ai?.effect?.prepHours ?? 0), 0);
  const th = 'px-2 py-1.5 text-left text-[11px] font-semibold text-ink-3 whitespace-nowrap';
  return (
    <section className="rounded-card border border-line bg-white p-3" data-testid="support-apply-list">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">이번 주 신청 목록 {data.items.length}건</b>
        <span className="text-xs text-ink-2">마감 순{hours ? ` · 준비 시간 합계 약 ${hours}시간` : ''} · 받는 것·금액·자부담·준비 시간은 AI 판단(참고용) — 원문으로 꼭 확인</span>
        <a href={`/api/sales/support/export`} className={cx(linkCls, 'ml-auto')} data-testid="support-list-export"><Download className="size-3.5" aria-hidden />엑셀로 내려받기</a>
      </div>
      {!data.items.length ? <p className="mt-2 rounded-input border border-dashed border-line p-5 text-center text-sm text-ink-3" data-testid="support-list-empty">담은 공고가 없습니다 — 맞춤 탭 카드에서 [목록에 담기]를 누르세요</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-xs" data-testid="support-apply-table">
            <thead><tr className="border-b border-line">{['공고', '마감', '받는 것', '예상 금액', '자부담', '준비', '담당·업무', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
            <tbody>{data.items.map((it) => { const e = it.ai?.effect; const w = it.work; return (
              <tr key={it.id} className="border-b border-line align-top last:border-0" data-testid="support-apply-row" data-id={it.id}>
                <td className="max-w-[260px] px-2 py-2"><button type="button" className="text-left font-semibold hover:underline" onClick={() => onOpen(it.id)}>{it.title}</button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-ink-3"><Verdict it={it} />{it.agency}</div>
                  {!!e?.confirm.length && <p className="mt-1 text-[11px] text-amber-900" data-testid="support-apply-confirm">확인할 것: {e.confirm.join(' · ')}</p>}</td>
                <td className="whitespace-nowrap px-2 py-2"><Dday d={it.dday} text={it.applyText} /><div className="mt-0.5 text-[11px] text-ink-3">{it.applyEnd ? kday(it.applyEnd) : ''}</div></td>
                <td className="max-w-[220px] px-2 py-2" data-testid="support-apply-receive">{e?.receive || <span className="text-ink-3">{it.ai ? '—' : 'AI 판단 전'}</span>}
                  {!!e?.perBusiness.length && <ul className="mt-1 space-y-0.5 text-[11px] text-ink-2">{e.perBusiness.map((b) => <li key={b.brand}><span className="rounded border border-violet-200 bg-violet-50 px-1 text-violet-800">{b.brand}</span> {b.line}</li>)}</ul>}</td>
                <td className="max-w-[160px] px-2 py-2">{e?.amount ?? it.amount ?? '—'}</td>
                <td className="max-w-[140px] px-2 py-2">{e?.selfPay ?? '—'}</td>
                <td className="whitespace-nowrap px-2 py-2">{e?.prepHours ? `약 ${e.prepHours}시간` : '—'}</td>
                <td className="px-2 py-2">{w?.status === 'preparing' ? <span className="whitespace-nowrap text-ink-2" data-testid="support-apply-owner">신청 준비 · {w.ownerName ?? '담당 없음'}</span> : (
                  <div className="flex items-center gap-1"><select className={cx(inputCls, 'h-8 w-28 py-0 text-xs')} value={owner[it.id] ?? w?.ownerId ?? ''} onChange={(ev) => setOwner({ ...owner, [it.id]: ev.target.value })} aria-label="담당" data-testid="support-apply-owner-pick">
                    <option value="">나</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                    <Button size="sm" disabled={!!busy} onClick={() => onTask(it, owner[it.id] ?? w?.ownerId ?? '')} data-testid="support-apply-task">{busy === `${it.id}:task` ? '…' : '업무로'}</Button></div>)}</td>
                <td className="px-2 py-2"><button type="button" className="text-[11px] text-ink-3 underline" disabled={!!busy} onClick={() => onUnlist(it)} data-testid="support-apply-remove">빼기</button></td>
              </tr>); })}</tbody>
          </table>
        </div>)}
      <p className="mt-2 text-[11px] text-ink-3">[업무로] = 고른 담당에게 ‘신청 준비’ 업무(준비 서류 체크리스트·마감 7일·3일 전 알림). 신청하면 [진행 기록]에서 ‘신청 완료’로 바꾸면 목록에서 빠집니다.</p>
    </section>
  );
}

/** #782·#785 AI 판단 안내 한 줄 — 자동 판단 중(판단 차례 n건) · 예산에 걸려 멈춤 · 꺼짐(규칙상 맞음 · AI 판단 전 n건은 [AI 판단]) */
function AutoNote({ data }: { data: ListData }) {
  const a = data.auto; const cost = data.aiCostKrw != null ? `건당 ${won(data.aiCostKrw)}` : '';
  const box = 'rounded-input border px-2.5 py-1.5 text-xs';
  if (a.on && a.stopped) return <p className={cx(box, 'border-amber-300 bg-amber-50 text-amber-900')} data-testid="support-auto-note" data-state="stopped"><b>AI 자동 판단을 멈췄습니다</b> — 이번 달 회사 AI 예산(또는 한도)을 다 썼습니다. 남은 {a.left}건은 예산이 채워지면 이어서 판단합니다. 급한 공고는 공고마다 [AI 판단]을 누르세요.</p>;
  if (a.on) return a.queue > 0 || data.pendingCount > 0 ? <p className={cx(box, 'border-sky-200 bg-sky-50/60 text-sky-900')} data-testid="support-auto-note" data-state="on"><b>AI 세일즈가 새 공고를 자동으로 판단합니다</b>{cost ? `(${cost}, 회사 AI 예산에서)` : ''}{a.queue > 0 ? ` — 지금 판단 차례 ${a.queue}건, 15분마다 차례로(‘AI 확인 중’)` : ''}.</p> : null;
  if (!data.pendingCount) return null;
  return <p className={cx(box, 'border-sky-200 bg-sky-50/60 text-sky-900')} data-testid="support-auto-note" data-state="off"><b>규칙상 맞음 · AI 판단 전 {data.pendingCount}건</b> — 지역·업력·규모·업종 규칙으로만 맞는 공고입니다. 참여할 수 있는지는 공고마다 [AI 판단]을 눌러야 정해집니다{cost ? `(${cost}, 회사 AI 예산에서)` : ''}. {a.saved ? '새 공고 자동 판단이 꺼져 있습니다 — 회사 프로필에서 켤 수 있습니다' : '회사 프로필을 저장하면 새 공고를 자동으로 판단합니다'}{data.canEdit && data.aiOn ? ' · 여러 건은 [공고 여러 건 AI 판단]' : ''}.</p>;
}

/** #782 여러 건 AI 판단(관리자) — 몇 건·예상 비용을 보고 누를 때만 */
function BulkAi({ pending, cost, busy, onRun, onAll, run, onStop, onClose }: { pending: number; cost: number | null; busy: boolean; onRun: (n: number) => void; onAll: (() => void) | null; run: { done: number; total: number; costKrw: number } | null; onStop: () => void; onClose: () => void }) {
  const opts = [...new Set([5, 10, 20].map((n) => Math.min(n, pending)))].filter((n) => n > 0);
  return (
    <Modal open onClose={onClose} title="지원사업 공고 AI 판단">
      <div className="space-y-3 text-sm" data-testid="support-bulk">
        <p className="text-xs text-ink-2">‘규칙상 맞음 · AI 판단 전’ {pending}건 가운데 맞춤 순 위에서부터 판단합니다. 비용은 회사 AI 예산에서 나갑니다{cost != null ? `(건당 ${won(cost)})` : ''}. 한도에 걸리면 멈춥니다.</p>
        <div className="flex flex-wrap gap-2">{opts.map((n) => <Button key={n} size="sm" variant="secondary" disabled={busy} onClick={() => onRun(n)} data-testid={`support-bulk-${n}`}>{busy ? '판단 중…' : `${n}건 판단${cost != null ? ` · ${won(cost * n)}` : ''}`}</Button>)}</div>
        {/* 269차 #803: 대기 중인 것 모두(4건씩 같이) · 270차 #810: 새 공고 자동 판단이 켜져 있으면 정기 실행이 끝까지 판단하므로 단추 없음 */}
        {!onAll && pending > 0 && <p className="text-xs text-ink-2" data-testid="support-bulk-auto">새 공고 자동 판단이 켜져 있어 대기 중인 공고는 정기 실행이 차례로 모두 판단합니다. 누르지 않아도 됩니다.</p>}
        {onAll && pending > 0 && (run
          ? <div className="flex items-center gap-2 rounded-input bg-sky-50 px-3 py-2 text-xs text-sky-900" role="status" data-testid="support-bulk-progress"><span className="flex-1">AI 판단 중 {run.done}/{run.total}건 · {won(run.costKrw)}</span><Button size="sm" variant="secondary" onClick={onStop} data-testid="support-bulk-stop">멈추기</Button></div>
          : <Button size="sm" disabled={busy} onClick={onAll} data-testid="support-bulk-all">대기 중인 공고 모두 AI 판단({pending}건{cost != null ? ` · 약 ${won(cost * pending).replace(/^약\s*/, '')}` : ''})</Button>)}
        <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={onClose} disabled={!!run}>닫기</Button></div>
      </div>
    </Modal>
  );
}

function WeeklyBox({ weekly, canEdit, auto, busy, onNow, onOpen }: { weekly: Weekly | null; canEdit: boolean; auto: number; busy: boolean; onNow: () => void; onOpen: (id: string) => void }) {
  const lead = weekly?.items.find((x) => x.use);
  return (
    <section className="rounded-card border border-emerald-200 bg-emerald-50/50 p-3 text-sm" data-testid="support-weekly" data-week={weekly?.week ?? ''}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-emerald-900">이번 주 맞는 지원사업 {weekly ? `${weekly.items.length}건` : ''}</b>
        <span className="text-xs text-ink-2">{weekly ? `${kday(weekly.week)} 주 기준${weekly.aiCount ? ` · AI 세일즈가 새로 판단 ${weekly.aiCount}건` : ''}` : `월요일 아침마다 AI 판단에서 ‘해당’이 나온 공고를 묶어 드립니다${auto > 0 ? `(판단 전 공고는 ${auto}건까지 그때 판단)` : ''}`}</span>
        {canEdit && <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={onNow} data-testid="support-weekly-now"><Sparkles className="size-3.5" aria-hidden />{busy ? '묶는 중…' : weekly ? '지금 다시 묶기' : '이번 주 묶음 만들기'}</Button>}
      </div>
      {weekly && weekly.items.length > 0 && <ul className="mt-1.5 flex flex-wrap gap-1.5">{weekly.items.map((x) => (
        <li key={x.id}><button type="button" onClick={() => onOpen(x.id)} className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs hover:underline" data-testid="support-weekly-item" data-by={x.by}>{x.by === 'ai' ? '✅ ' : ''}{x.title.slice(0, 40)}{x.dday != null ? ` · ${x.dday === 0 ? 'D-day' : `D-${x.dday}`}` : ''}</button></li>))}</ul>}
      {weekly && !weekly.items.length && <p className="mt-1 text-xs text-ink-3">이번 주에는 AI 판단에서 ‘해당’이 나온 공고가 없습니다.</p>}
      {lead?.use && <p className="mt-1 text-xs text-ink-2">접목: {lead.use}</p>}
    </section>
  );
}

function SourceLine({ sources }: { sources: ListData['sources'] }) {
  return (
    <footer className="space-y-0.5 border-t border-line pt-2 text-[11px] text-ink-3" data-testid="support-sources">
      <p>공고 원문 출처: 기업마당(bizinfo.go.kr) · K-Startup(k-startup.go.kr) · 각 기관 공지(플랫폼 운영 › 지원사업 감시 페이지). 공고 내용은 원문 그대로 옮기고, 자세한 조건은 원문 링크에서 확인하세요. 1차 판단·AI 판단은 참고용입니다.</p>
      {sources.map((s) => <p key={s.slug} className={cx(portalService(s.summary) && 'text-amber-900')}>{s.label}: {s.last_run_at ? `마지막 수집 ${fmtDateTime(s.last_run_at)}` : '아직 수집 전'}{s.summary ? ` — ${s.summary}` : ''}<PortalApplyLink summary={s.summary} /></p>)}
    </footer>
  );
}

/** 회사 지원사업 프로필 — 요약 한 줄(접힘) · 관리자는 펼쳐서 고침 */
function ProfileBox({ summary, blanks, onSaved }: { summary: ListData['profile'] | null; blanks: Blanks | null; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const { data, reload } = useApi<any>(open ? '/api/sales/support/profile' : null);
  const [f, setF] = useState<Record<string, any> | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data && !f) { const p = data.profile; setF({ regionSido: p.region_sido ?? '', regionSigungu: p.region_sigungu ?? '', founded: p.founded ?? '', size: p.size ?? '', employees: p.employees == null ? '' : String(p.employees), revenue: p.revenue_krw == null ? '' : String(p.revenue_krw),
    industries: p.industries.join(', '), keywords: p.keywords.join(', '), certs: p.certs, brands: p.brands.join(', '), interests: p.interests, excludes: p.excludes.join(', '), memo: p.memo ?? '', autoAi: data.autoAi !== false, certsNone: !!p.certs_none }); } }, [data, f]);
  if (!summary) return null;
  const line = summary.filled ? [summary.region && `${summary.region}${summary.sigungu ? ` ${summary.sigungu}` : ''}`, summary.size, summary.founded && `설립 ${summary.founded.slice(0, 4)}년`, summary.interests.length && `관심 ${summary.interests.join('·')}`, summary.brands.length && `브랜드 ${summary.brands.join('·')}`,
    summary.saved && (summary.autoAi ? '새 공고 AI 자동 판단' : 'AI 자동 판단 꺼짐')].filter(Boolean).join(' · ') : '';
  const set = (k: string, v: any) => setF((x) => ({ ...(x ?? {}), [k]: v }));
  const toggle = (k: 'certs' | 'interests', v: string) => setF((x) => ({ ...(x ?? {}), [k]: (x?.[k] as string[]).includes(v) ? (x?.[k] as string[]).filter((y) => y !== v) : [...(x?.[k] as string[]), v], ...(k === 'certs' ? { certsNone: false } : {}) }));
  async function save() {
    if (!f) return; setBusy(true);
    try {
      await api('/api/sales/support/profile', { method: 'PUT', body: { regionSido: f.regionSido || null, regionSigungu: f.regionSigungu || null, founded: f.founded || null, size: f.size || null, employees: f.employees === '' ? null : Number(f.employees), revenueKrw: f.revenue === '' ? null : Number(f.revenue),
        industries: csv(f.industries), keywords: csv(f.keywords), certs: f.certs, brands: csv(f.brands), interests: f.interests, excludes: csv(f.excludes), memo: f.memo || null, autoAi: !!f.autoAi, certsNone: !!f.certsNone && !f.certs.length } });
      toast.ok('회사 프로필을 저장했습니다 — 맞춤 순서를 다시 계산했습니다'); setF(null); reload(); onSaved(); setOpen(false);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const ro = data && !data.canEdit;
  return (
    <section className={cx('rounded-card border p-3', summary.saved ? 'border-line bg-white' : 'border-[#93C5FD] bg-[#EFF6FF]')} data-testid="support-profile">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b>우리 회사 프로필</b>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-2" data-testid="support-profile-line">{line || '아직 비어 있음 — 본점 지역·설립일·규모·관심 분야를 넣으면 맞는 공고부터 보여 줍니다'}{summary.filled && !summary.saved ? ' (회사 정보에서 채운 기본값)' : ''}</span>
        <Button size="sm" variant="secondary" onClick={() => setOpen(!open)} data-testid="support-profile-toggle">{open ? '접기' : summary.saved ? '프로필 보기·고치기' : '프로필 채우기'}</Button>
      </div>
      {blanks && blanks.items > 0 && <p className="mt-1 text-xs text-amber-900" data-testid="support-profile-blanks">빈칸 {blanks.fields.length}개({blanks.fields.map((f) => f.label).join('·')})를 채우면 {blanks.items}건 더 판단합니다 — 지금은 ‘확인 필요’로 남아 있습니다.</p>}
      {open && (!f ? <Skeleton rows={3} className="mt-2" /> : <div className="mt-3 space-y-2" data-testid="support-profile-form">
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="본점 시·도"><select className={inputCls} value={f.regionSido} onChange={(e) => set('regionSido', e.target.value)} disabled={ro} data-testid="profile-sido"><option value="">고르기</option>{SIDO.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="본점 시·군·구"><input className={inputCls} value={f.regionSigungu} onChange={(e) => set('regionSigungu', e.target.value)} placeholder="예: ○○시" maxLength={20} disabled={ro} data-testid="profile-sigungu" /></Field>
          <Field label="설립일(업력)"><input type="date" className={inputCls} value={f.founded} onChange={(e) => set('founded', e.target.value)} disabled={ro} data-testid="profile-founded" /></Field>
          <Field label="규모"><select className={inputCls} value={f.size} onChange={(e) => set('size', e.target.value)} disabled={ro} data-testid="profile-size"><option value="">고르기</option>{(data.sizes as string[]).map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="상시근로자(명)"><input className={inputCls} inputMode="numeric" value={f.employees} onChange={(e) => set('employees', e.target.value.replace(/\D/g, ''))} disabled={ro} data-testid="profile-employees" /></Field>
          <Field label="최근 연 매출(원, 선택)"><input className={inputCls} inputMode="numeric" value={f.revenue} onChange={(e) => set('revenue', e.target.value.replace(/\D/g, ''))} disabled={ro} /></Field>
          <Field label="업종(쉼표)" className="sm:col-span-2"><input className={inputCls} value={f.industries} onChange={(e) => set('industries', e.target.value)} disabled={ro} /></Field>
        </div>
        <Field label="보유 인증"><div className="flex flex-wrap gap-1">{(data.certOptions as string[]).map((c) => <button key={c} type="button" disabled={ro} onClick={() => toggle('certs', c)} className={cx('rounded-full border px-2 py-0.5 text-xs', f.certs.includes(c) ? 'border-[#2563EB] bg-white font-semibold text-[#1D4ED8]' : 'border-line bg-white text-ink-2')} data-testid="profile-cert">{c}</button>)}
          <label className="ml-1 inline-flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={!!f.certsNone && !f.certs.length} disabled={ro} onChange={(e) => setF((x) => ({ ...(x ?? {}), certsNone: e.target.checked, ...(e.target.checked ? { certs: [] } : {}) }))} data-testid="profile-certs-none" />보유 인증 없음</label></div></Field>
        <Field label="관심 분야"><div className="flex flex-wrap gap-1">{[...new Set([...(data.interestOptions as string[]), ...(f.interests as string[])])].map((c) => <button key={c} type="button" disabled={ro} onClick={() => toggle('interests', c)} className={cx('rounded-full border px-2 py-0.5 text-xs', f.interests.includes(c) ? 'border-[#2563EB] bg-white font-semibold text-[#1D4ED8]' : 'border-line bg-white text-ink-2')} data-testid="profile-interest">{c}</button>)}</div></Field>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="브랜드·사업부(쉼표)"><input className={inputCls} value={f.brands} onChange={(e) => set('brands', e.target.value)} disabled={ro} data-testid="profile-brands" /></Field>
          <Field label="키워드(쉼표)"><input className={inputCls} value={f.keywords} onChange={(e) => set('keywords', e.target.value)} placeholder="예: 출입 관리, 상표" disabled={ro} data-testid="profile-keywords" /></Field>
          <Field label="빼는 낱말(쉼표)"><input className={inputCls} value={f.excludes} onChange={(e) => set('excludes', e.target.value)} placeholder="예: 농업, 어업" disabled={ro} /></Field>
        </div>
        <Field label="회사 소개(AI 판단에 함께 줌)"><textarea className={inputCls} rows={2} maxLength={1000} value={f.memo} onChange={(e) => set('memo', e.target.value)} disabled={ro} /></Field>
        <label className="flex items-start gap-2 text-xs text-ink-2"><input type="checkbox" className="mt-0.5" checked={!!f.autoAi} onChange={(e) => set('autoAi', e.target.checked)} disabled={ro} data-testid="profile-auto-ai" />
          <span><b className="text-ink">새 공고 AI 자동 판단</b> — 공고가 올라오면 AI 세일즈가 우리 회사 프로필로 참여 가능 여부를 판단합니다(회사 AI 예산에서, 15분마다 차례로). 지역·설립일·규모·근로자·매출·업종·인증을 바꾸면 열린 공고를 다시 판단합니다.</span></label>
        {ro ? <p className="text-xs text-ink-3">프로필은 관리자가 고칩니다.</p> : <div className="flex justify-end"><Button size="sm" disabled={busy} onClick={save} data-testid="profile-save">저장</Button></div>}
      </div>)}
    </section>
  );
}

/** 공고 상세 — 원문 요약·첨부·1차 판단·AI 판단·진행(상태·담당·신청일·결과 메모)·업무·기록 */
function Detail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, error, reload, setData } = useApi<any>(`/api/sales/support/${id}`); const router = useRouter();
  const [w, setW] = useState<Record<string, string> | null>(null); const [busy, setBusy] = useState<string | null>(null); const [editing, setEditing] = useState(false);
  const it: Item | undefined = data?.item;
  useEffect(() => { if (it && !w) setW({ ownerId: it.work?.ownerId ?? '', appliedAt: it.work?.appliedAt ?? '', resultAt: it.work?.resultAt ?? '', amountAwarded: it.work?.amountAwarded ?? '', resultMemo: it.work?.resultMemo ?? '', memo: it.work?.memo ?? '' }); }, [it, w]);
  async function setStatus(status: string) {
    setBusy(status);
    try { const r = await api<any>(`/api/sales/support/${id}/work`, { body: { status, ...(w?.ownerId ? { ownerId: w.ownerId } : {}) } }); setData(r); setW(null); onChanged(); toast.ok(`'${STEPS.find(([k]) => k === status)?.[1]}'(으)로 바꿨습니다`); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function saveWork() {
    if (!w) return; setBusy('save');
    try { const r = await api<any>(`/api/sales/support/${id}/work`, { body: { ownerId: w.ownerId || null, appliedAt: w.appliedAt || null, resultAt: w.resultAt || null, amountAwarded: w.amountAwarded || null, resultMemo: w.resultMemo || null, memo: w.memo || null } }); setData(r); setW(null); onChanged(); toast.ok('진행 기록을 저장했습니다'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function analyze() {
    setBusy('ai');
    try { const r = await api<{ costKrw: number }>(`/api/sales/support/${id}/analyze`, { body: {} }); toast.ok(`AI 세일즈가 판단했습니다(약 ${r.costKrw.toLocaleString('ko-KR')}원)`); reload(); onChanged(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  /** #815 [업무 회수] — 다른 사람이 업무에 댓글·첨부·체크를 남겼으면 한 번 더 묻고 회수 */
  async function withdraw() {
    if (!confirm(data?.task ? '담당 업무를 회수할까요? 업무는 휴지통(30일 보관)으로 가고, 이 공고의 진행 기록은 처음 상태로 돌아갑니다. 담당에게 알림이 갑니다.' : '이 공고의 진행 기록을 처음 상태로 돌릴까요?')) return;
    setBusy('withdraw');
    try {
      const url = `/api/sales/support/${id}/withdraw`;
      let r = await api<any>(url, { body: {} });
      if (r.needsConfirm) { if (!confirm(r.message)) return; r = await api<any>(url, { body: { confirm: true } }); }
      setData(r.view); setW(null); onChanged();
      toast.ok(r.taskId ? '업무를 회수했습니다 — 업무는 휴지통에서 30일 동안 되살릴 수 있습니다' : '진행 기록을 처음 상태로 돌렸습니다', r.taskId ? { label: '휴지통', run: () => router.push('/tasks/trash') } : undefined);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function remove() {
    if (!confirm('직접 넣은 이 공고와 진행 기록을 지울까요?')) return;
    try { await api(`/api/sales/support/${id}`, { method: 'DELETE' }); toast.ok('지웠습니다'); onChanged(); onClose(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open onClose={onClose} title="지원사업 공고" wide>
      {error ? <ErrorBox error={error} retry={reload} /> : !it || !w ? <Skeleton rows={6} /> : <div className="space-y-3 text-sm" data-testid="support-detail">
        <div className="flex flex-wrap items-start gap-1.5"><Verdict it={it} /><h3 className="min-w-0 flex-1 font-semibold" data-testid="support-detail-title">{it.title}</h3><Dday d={it.dday} text={it.applyText} /></div>
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1 text-xs">
          {([['기관', [it.agency, it.executor && it.executor !== it.agency ? it.executor : null].filter(Boolean).join(' · ')], ['지원 분야', it.category], ['지원 대상', data.target], ['지역', it.regions.length ? it.regions.join('·') : it.nationwide ? '전국(표시 없음)' : ''],
            ['신청 기간', data.applyText ?? [it.applyStart, it.applyEnd].filter(Boolean).join(' ~ ')], ['업력 조건', data.bizYears], ['지원 규모', it.amount], ['출처', `${it.sourceLabel}${it.alsoOn.length ? ` (같은 공고: ${it.alsoOn.join('·')})` : ''}`]] as [string, string | null][])
            .filter(([, v]) => v).map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={`${k}:v`} className="break-words">{v}</dd>])}
        </dl>
        <div className="flex flex-wrap gap-1.5">{it.url && <a href={it.url} target="_blank" rel="noopener noreferrer" className={linkCls} data-testid="support-link-origin"><ExternalLink className="size-3.5" aria-hidden />공고 원문</a>}
          {it.applyUrl && <a href={it.applyUrl} target="_blank" rel="noopener noreferrer" className={linkCls}><ExternalLink className="size-3.5" aria-hidden />신청하기</a>}
          {(data.attachments as { name: string; url: string }[]).map((a) => <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className={linkCls}><ExternalLink className="size-3.5" aria-hidden />{a.name.slice(0, 30)}</a>)}</div>
        <section><h4 className="mb-1 text-xs font-semibold text-ink-2">1차 판단(우리 회사 프로필 기준)</h4>{it.rule.flags.length ? <Flags flags={it.rule.flags} /> : <p className="text-xs text-ink-3">걸리는 조건이 없습니다(공고에 지역·업력·규모 조건 표시 없음)</p>}</section>
        <section className="rounded-input border border-violet-200 bg-violet-50/50 p-2.5" data-testid="support-ai-box">
          <div className="flex flex-wrap items-center gap-2"><b className="text-xs text-violet-900"><Sparkles className="mr-0.5 inline size-3.5" aria-hidden />AI 세일즈 판단</b>{it.ai && <span className="text-[11px] text-ink-3">{it.ai.at ? fmtDateTime(it.ai.at) : ''}</span>}
            {data.aiOn && <Button size="sm" variant="secondary" className="ml-auto" disabled={busy === 'ai'} onClick={analyze} data-testid="support-detail-analyze">{busy === 'ai' ? '판단 중…' : it.ai ? '다시 판단' : 'AI 판단'}</Button>}</div>
          {it.ai ? <div className="mt-1.5 space-y-1.5 text-xs">
            <p><span className={cx('rounded-full border px-2 py-0.5 font-semibold', VERDICT[it.ai.verdict][2])}>{VERDICT[it.ai.verdict][0]} {VERDICT[it.ai.verdict][1]}</span>{it.ai.summary && <span className="ml-1.5 text-ink-2">{it.ai.summary}</span>}</p>
            {it.ai.reasons.length > 0 && <ul className="list-disc space-y-0.5 pl-4" data-testid="support-ai-reasons">{it.ai.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            {it.ai.use.length > 0 ? <div className="rounded-input border border-violet-200 bg-white p-2"><b className="text-violet-900">우리 회사에 접목할 점</b><ul className="mt-0.5 list-disc space-y-0.5 pl-4" data-testid="support-ai-use">{it.ai.use.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
              : <p className="text-[11px] text-ink-3" data-testid="support-ai-use-missing">‘우리 회사에 접목할 점’·‘마감·일정’은 10/25 이전 판단에는 없습니다 — [다시 판단]을 누르면 채워집니다.</p>}{/* 로컬 10/25 18:50 ③: 상세에 접목 줄이 없는 까닭을 화면에 */}
            {it.ai.effect ? <div className="rounded-input border border-emerald-200 bg-white p-2" data-testid="support-ai-effect"><b className="text-emerald-900">기대 효과</b>
              <dl className="mt-0.5 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-0.5">{([['받는 것', it.ai.effect.receive], ['예상 금액', it.ai.effect.amount], ['자부담', it.ai.effect.selfPay], ['준비 시간', it.ai.effect.prepHours ? `약 ${it.ai.effect.prepHours}시간` : null]] as [string, string | null][])
                .filter(([, v]) => v).map(([k, v]) => [<dt key={k} className="text-ink-3">{k}</dt>, <dd key={`${k}:v`}>{v}</dd>])}</dl>
              {it.ai.effect.perBusiness.length > 0 && <ul className="mt-1 space-y-0.5">{it.ai.effect.perBusiness.map((b) => <li key={b.brand}><span className="rounded border border-violet-200 bg-violet-50 px-1 text-violet-800">{b.brand}</span> {b.line}</li>)}</ul>}
              {it.ai.effect.confirm.length > 0 && <p className="mt-1 text-amber-900">신청 전 확인: {it.ai.effect.confirm.join(' · ')}</p>}</div>
              : <p className="text-[11px] text-ink-3" data-testid="support-ai-effect-missing">‘기대 효과’(받는 것·예상 금액·자부담·준비 시간)는 10/29 이전 판단에는 없습니다 — 자동 판단이 차례로 채우거나 [다시 판단]을 누르면 채워집니다.</p>}
            {it.ai.schedule && <p data-testid="support-ai-schedule"><span className="text-ink-3">마감·일정</span> {it.ai.schedule}</p>}
            {it.ai.brands.length > 0 && <p className="flex flex-wrap items-center gap-1">맞는 브랜드: {it.ai.brands.map((b) => <span key={b} className="rounded-full border border-violet-200 bg-white px-1.5 text-violet-800">{b}</span>)}</p>}{/* 로컬 10/25 18:50: 칩이 글자에 붙어 보임 → 간격·테두리 */}
            <div><span className="text-ink-3">준비 서류</span>{it.ai.docs.length ? <ul className="mt-0.5 list-disc pl-4" data-testid="support-ai-docs">{it.ai.docs.map((d, i) => <li key={i}>{d}</li>)}</ul> : <span className="ml-1 text-ink-3">공고에 서류 목록이 없음 — 원문·첨부 확인</span>}</div>
          </div> : <p className="mt-1 text-xs text-ink-3">{data.aiOn ? '[AI 판단]을 누르면 해당 여부·이유·맞는 브랜드·준비 서류를 정리합니다(회사 AI 한도에서).' : 'AI 가 설정되지 않았습니다.'}</p>}
        </section>
        <section className="rounded-input border border-blue-200 bg-blue-50/40 p-2.5" data-testid="support-work-box">
          <div className="flex flex-wrap items-center gap-1.5"><b className="text-xs">진행</b>{STEPS.map(([k, l]) => <button key={k} type="button" disabled={!!busy || it.work?.status === k} onClick={() => setStatus(k)}
            className={cx('rounded-full border px-2.5 py-1 text-xs', it.work?.status === k ? `border-transparent font-semibold ${STATUS_CLS[k]}` : 'border-line bg-white')} data-testid={`support-step-${k}`}>{l}</button>)}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="담당"><select className={inputCls} value={w.ownerId} onChange={(e) => setW({ ...w, ownerId: e.target.value })} data-testid="support-owner"><option value="">나(처음 누른 사람)</option>{(data.people as { id: string; name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="신청일"><input type="date" className={inputCls} value={w.appliedAt} onChange={(e) => setW({ ...w, appliedAt: e.target.value })} data-testid="support-applied-at" /></Field>
            <Field label="결과일"><input type="date" className={inputCls} value={w.resultAt} onChange={(e) => setW({ ...w, resultAt: e.target.value })} /></Field>
            <Field label="선정 금액"><input className={inputCls} value={w.amountAwarded} onChange={(e) => setW({ ...w, amountAwarded: e.target.value })} maxLength={100} placeholder="예: 840만원" /></Field>
            <Field label="결과 메모" className="sm:col-span-2"><input className={inputCls} value={w.resultMemo} onChange={(e) => setW({ ...w, resultMemo: e.target.value })} maxLength={2000} placeholder="예: 결과 개별 통보 — 담당자 확인 필요" data-testid="support-result-memo" /></Field>
          </div>
          <Field label="메모" className="mt-2"><textarea className={inputCls} rows={2} value={w.memo} onChange={(e) => setW({ ...w, memo: e.target.value })} maxLength={2000} /></Field>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {data.task && <Link href={`/tasks/${data.task.id}`} className="text-xs underline" data-testid="support-task-link">담당 업무: {data.task.title.slice(0, 50)} · 체크 {data.task.done}/{data.task.total}{data.task.status === 'done' ? ' · 완료' : data.task.due_date ? ` · 마감 ${kday(data.task.due_date)}` : ''}</Link>}
            {it.work && <Button size="sm" variant="secondary" className="ml-auto" disabled={!!busy} onClick={withdraw} data-testid="support-withdraw">{busy === 'withdraw' ? '…' : data.task ? '업무 회수' : '진행 회수'}</Button>}
            <Button size="sm" className={it.work ? '' : 'ml-auto'} disabled={!!busy || !it.work} onClick={saveWork} data-testid="support-work-save">기록 저장</Button>
          </div>
          {!it.work && <p className="mt-1 text-[11px] text-ink-3">[관심]·[신청 준비]를 누르면 담당 업무(체크리스트)가 생기고 마감 7일·3일 전에 알림이 갑니다.</p>}
        </section>
        {data.summary && <section><h4 className="mb-1 text-xs font-semibold text-ink-2">공고 내용(원문)</h4><p className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-input border border-line bg-slate-50 p-2 text-xs" data-testid="support-summary">{data.summary}</p></section>}
        {data.log.length > 0 && <section><h4 className="mb-1 text-xs font-semibold text-ink-2">기록</h4><ul className="space-y-0.5 text-[11px] text-ink-2">{(data.log as any[]).map((g, i) => <li key={i}>{fmtDateTime(g.changed_at)} · {g.by ?? ''} · {data.statusLabel[g.from_status] ?? '—'} → {data.statusLabel[g.to_status] ?? g.to_status}{g.note ? ` (${g.note})` : ''}</li>)}</ul></section>}
        {data.canEditProgram && <div className="flex gap-2 border-t border-line pt-2"><Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}>{editing ? '고치기 닫기' : '공고 고치기'}</Button><Button size="sm" variant="secondary" onClick={remove}>지우기</Button></div>}
        {editing && <ManualEdit id={id} item={it} summary={data.summary} onDone={() => { setEditing(false); reload(); onChanged(); }} />}
      </div>}
    </Modal>
  );
}

type MF = { title: string; agency: string; url: string; applyStart: string; applyEnd: string; amount: string; region: string; summary: string };
function ManualFields({ f, setF }: { f: MF; setF: (f: MF) => void }) {
  const S = (k: keyof MF) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="공고명(필수)" className="sm:col-span-2"><input className={inputCls} value={f.title} onChange={S('title')} maxLength={300} data-testid="manual-title" /></Field>
      <Field label="기관"><input className={inputCls} value={f.agency} onChange={S('agency')} maxLength={100} data-testid="manual-agency" /></Field>
      <Field label="공고 링크"><input className={inputCls} value={f.url} onChange={S('url')} inputMode="url" placeholder="https://" /></Field>
      <Field label="신청 시작"><input type="date" className={inputCls} value={f.applyStart} onChange={S('applyStart')} data-testid="manual-start" /></Field>
      <Field label="신청 마감"><input type="date" className={inputCls} value={f.applyEnd} onChange={S('applyEnd')} data-testid="manual-end" /></Field>
      <Field label="지원 규모"><input className={inputCls} value={f.amount} onChange={S('amount')} maxLength={100} placeholder="예: 상표 42만원 이내" /></Field>
      <Field label="지역"><select className={inputCls} value={f.region} onChange={S('region')}><option value="">전국·모름</option>{SIDO.map((s) => <option key={s}>{s}</option>)}</select></Field>
      <Field label="내용(선택)" className="sm:col-span-2"><textarea className={inputCls} rows={2} value={f.summary} onChange={S('summary')} maxLength={5000} /></Field>
    </div>
  );
}
/** 직접 추가 — 목록에 없는 공고, 지난 신청 이력(신청일·결과 대기 메모) */
function ManualAdd({ people, onClose, onDone }: { people: { id: string; name: string }[]; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState<MF>({ title: '', agency: '', url: '', applyStart: '', applyEnd: '', amount: '', region: '', summary: '' });
  const [st, setSt] = useState(''); const [appliedAt, setAppliedAt] = useState(''); const [memo, setMemo] = useState(''); const [owner, setOwner] = useState(''); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const r = await api<any>('/api/sales/support', { body: { title: f.title, agency: f.agency || null, url: f.url || null, applyStart: f.applyStart || null, applyEnd: f.applyEnd || null, amount: f.amount || null, region: f.region || null, summary: f.summary || null,
        ...(st ? { status: st, appliedAt: appliedAt || null, resultMemo: memo || null } : {}) } });
      if (owner && st) await api(`/api/sales/support/${r.item.id}/work`, { body: { ownerId: owner } });
      toast.ok(st ? `넣고 '${STEPS.find(([k]) => k === st)?.[1]}'(으)로 기록했습니다` : '공고를 넣었습니다'); onDone(r.item.id);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="지원사업 직접 추가" wide>
      <div className="space-y-3 text-sm" data-testid="support-manual">
        <p className="text-xs text-ink-2">목록에 없는 공고나 지난 신청 이력을 넣습니다. 이 회사에만 보입니다.</p>
        <ManualFields f={f} setF={setF} />
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="지금 상태"><select className={inputCls} value={st} onChange={(e) => setSt(e.target.value)} data-testid="manual-status"><option value="">기록 안 함</option>{STEPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          {st && <Field label="담당"><select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">나</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          {['applied', 'selected', 'rejected'].includes(st) && <Field label="신청일"><input type="date" className={inputCls} value={appliedAt} onChange={(e) => setAppliedAt(e.target.value)} data-testid="manual-applied-at" /></Field>}
          {st && <Field label="결과·메모" className="sm:col-span-3"><input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} placeholder="예: 결과 대기 — 개별 통보" data-testid="manual-memo" /></Field>}
        </div>
        <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={onClose}>닫기</Button><Button size="sm" disabled={busy || f.title.trim().length < 2} onClick={save} data-testid="manual-save">넣기</Button></div>
      </div>
    </Modal>
  );
}
function ManualEdit({ id, item, summary, onDone }: { id: string; item: Item; summary: string | null; onDone: () => void }) {
  const [f, setF] = useState<MF>({ title: item.title, agency: item.agency ?? '', url: item.url ?? '', applyStart: item.applyStart ?? '', applyEnd: item.applyEnd ?? '', amount: item.amount ?? '', region: item.regions[0] ?? '', summary: summary ?? '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api(`/api/sales/support/${id}`, { method: 'PATCH', body: { title: f.title, agency: f.agency || null, url: f.url || null, applyStart: f.applyStart || null, applyEnd: f.applyEnd || null, amount: f.amount || null, region: f.region || null, summary: f.summary || null } }); toast.ok('고쳤습니다'); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return <div className="space-y-2 rounded-input border border-line p-2.5"><ManualFields f={f} setF={setF} /><div className="flex justify-end"><Button size="sm" disabled={busy || f.title.trim().length < 2} onClick={save}>저장</Button></div></div>;
}
