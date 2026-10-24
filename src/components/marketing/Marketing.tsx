'use client';
import { AiAsk, AI_ASK_EXAMPLES } from '@/components/AiAsk';
import { MediaThumb } from '@/components/MediaView';
import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { useBackClose } from '@/components/backClose';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { PublishHelper } from './PublishHelper';
import { MediaPick } from './MediaPick';
import { ApprovalCard, BrandChip, needsVisual, StatusChip, channelLabel, deadlineLabel, formatLabel, whenLabel, type CardContent, WhyBox } from './ApprovalCard';
import { ProposalCard, BudgetCard } from './Ops';
import { GoalCard, type Goal } from './Goals';
import { MetaDraftCard, type MetaPlanRow } from './MetaAuto';
import { ConceptSetCard, type ConceptSet } from './Concepts';
import { QualityPanel, type QReport } from './QualityPanel';
import { ChannelPreview } from './ChannelPreview';
import { MODE_HINT, MODE_LABEL, ModeChip, ModeToggle, type Mode } from './ModeToggle';

const C = '#7C3AED';
export const CHANNELS: Record<string, string> = { instagram: '인스타그램', facebook: '페이스북', threads: '스레드', blog: '블로그', youtube: '유튜브', naver_place: '네이버 플레이스', other: '기타' };
const CH_COLOR: Record<string, string> = { instagram: '#DB2777', facebook: '#2563EB', threads: '#111827', blog: '#16A34A', youtube: '#DC2626', naver_place: '#059669', other: '#64748B' };
const STATUS: Record<string, string> = { pending: '승인 대기', approved: '승인됨', changes: '수정 요청', hold: '보류', published: '게시됨', draft: '초안' };
type Content = { id: string; title: string; channel: string; status: string; scheduled_at: string | null; current_version: number; approved_version: number | null; brand: string | null; body: string; media_count: number; created_by_name: string; deadline: string | null; published_url: string | null };

export type HomeCh = { key: string; label: string; kind: 'publish' | 'ads' | 'helper'; state: 'connected' | 'broken' | 'none' | 'helper'; account: string | null; error: string | null; connect: string | null; pending: string | null; signup: string; ask: string };
export type WeekPost = { id: string; title: string; channel: string; kind: string | null; status: string; scheduled_at: string; brand: string | null; failed: boolean; late: boolean };
export const CH_DOT: Record<HomeCh['state'], string> = { connected: '#16A34A', helper: '#16A34A', broken: '#DC2626', none: '#94A3B8' };
export const CH_STATE: Record<HomeCh['state'], string> = { connected: '연결됨', helper: '게시 도우미', broken: '끊김', none: '연결 안 함' };

/** 채널 [연결] 하나: OAuth 주소면 이동, 네이버 검색광고는 입력 창, 준비 중이면 사유 */
export function ConnectButton({ ch, onNaver, label }: { ch: HomeCh; onNaver: () => void; label?: string }) {
  if (ch.connect === 'naver_form') return <Button size="sm" onClick={onNaver} data-testid={`home-connect-${ch.key}`}>{label ?? '연결'}</Button>;
  if (ch.connect) return <a href={ch.connect} className="rounded-input px-3 py-1.5 text-xs font-medium text-white" style={{ background: C }} data-testid={`home-connect-${ch.key}`}>{label ?? '연결'}</a>;
  return <span className="text-[11px] text-ink-3" data-testid={`home-connect-${ch.key}`}>{ch.pending}</span>;
}

/** 처음 가입한 회사: 채널 고르기 → ① 계정 있나요? → ② 없으면 만들기 → ③ [연결] (연결 계정 화면으로 가지 않고 여기서) */
export function ChannelSetup({ channels, onNaver }: { channels: HomeCh[]; onNaver: () => void }) {
  const list = channels.filter((c) => c.kind !== 'helper');
  const [key, setKey] = useState(list[0]?.key ?? ''); const [has, setHas] = useState<boolean | null>(null);
  const ch = list.find((c) => c.key === key);
  return (
    <section className="rounded-card border-2 border-violet-300 bg-white p-4 shadow-card" data-testid="mkt-channel-setup">
      <h2 className="text-base font-bold">채널 연결 3단계</h2>
      <p className="text-xs text-ink-2">연결한 채널은 승인한 시안을 워크인에서 바로 게시하고, 연결 전에는 게시 도우미(복사·열기)로 올립니다.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{list.map((c) => <button key={c.key} type="button" onClick={() => { setKey(c.key); setHas(null); }} className={cx('rounded-full border px-2.5 py-1 text-xs', key === c.key ? 'border-violet-500 bg-violet-50 font-semibold text-violet-800' : 'border-line')} data-testid="setup-channel">{c.label}</button>)}</div>
      {ch && <ol className="mt-3 space-y-2 text-sm">
        <li data-testid="setup-step-1"><span className="font-semibold">1.</span> {ch.ask}
          <span className="ml-2 inline-flex gap-1"><Button size="sm" variant={has === true ? 'primary' : 'secondary'} onClick={() => setHas(true)} data-testid="setup-yes">있어요</Button><Button size="sm" variant={has === false ? 'primary' : 'secondary'} onClick={() => setHas(false)} data-testid="setup-no">없어요</Button></span></li>
        {has === false && <li data-testid="setup-step-2"><span className="font-semibold">2.</span> 먼저 계정을 만드세요 — <a href={ch.signup} target="_blank" rel="noopener" className="font-medium underline" style={{ color: C }} data-testid="setup-signup">{ch.label} 계정 만들기 ↗</a> <span className="text-xs text-ink-3">(만든 뒤 아래 [연결])</span></li>}
        {has !== null && <li className="flex flex-wrap items-center gap-2" data-testid="setup-step-3"><span className="font-semibold">{has ? '2.' : '3.'}</span> <ConnectButton ch={ch} onNaver={onNaver} label={`${ch.label} 연결`} /></li>}
      </ol>}
    </section>
  );
}

/** 지금 승인할 것 한 줄: 마감 시각 + 카드 안 [승인]/[수정 요청] */
export function ApproveRow({ c, canDecide, onDone }: { c: CardContent; canDecide: boolean; onDone: () => void }) {
  const [mode, setMode] = useState<'idle' | 'changes'>('idle'); const [memo, setMemo] = useState(''); const [busy, setBusy] = useState(false);
  async function decide(decision: 'approve' | 'changes') {
    setBusy(true);
    try { await api(`/api/marketing/contents/${c.id}/decide`, { body: { version: c.current_version, decision, comment: decision === 'changes' ? memo.trim() : undefined } }); toast.ok(decision === 'approve' ? '승인했습니다' : '수정을 요청했습니다'); onDone(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <li className="py-2 text-sm" data-testid="mkt-home-row">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link href={`/s/marketing/approvals?c=${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{c.title}</Link>
        {c.deadline && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-800" data-testid="mkt-home-deadline">{whenLabel(c.deadline)}까지</span>}
      </div>
      <p className="text-xs text-ink-2">{[c.brand, channelLabel(c.channel, c.kind)].filter(Boolean).join(' · ')} · {whenLabel(c.scheduled_at)} 게시{c.current_version > 1 ? ` · 수정본 v${c.current_version}` : ''}</p>
      {/* #516 (c): 시안 없는 글(홈은 첫 시안 id 만 받음)은 [승인] 대신 승인함 [지금 만들기]로 */}
      {!canDecide ? null : mode === 'idle' ? <div className="mt-1 flex flex-wrap items-center gap-1.5">{'media' in c && !(c as { media?: string | null }).media && c.channel !== 'threads'
        ? <Link href={`/s/marketing/approvals?c=${c.id}`} className="text-xs font-semibold text-red-700 underline" data-testid="home-no-visual">시안 없음 — 승인함에서 [지금 만들기]</Link>
        : <Button size="sm" disabled={busy} onClick={() => decide('approve')} data-testid="home-approve">승인</Button>}<Button size="sm" variant="secondary" onClick={() => setMode('changes')} data-testid="home-changes">수정 요청</Button></div>
        : <div className="mt-1 flex flex-wrap gap-1.5"><input className={cx(inputCls, 'min-w-0 flex-1')} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="무엇을 고칠지(두 글자 이상)" aria-label="수정 요청 메모" data-testid="home-changes-memo" />
          <Button size="sm" disabled={busy || memo.trim().length < 2} onClick={() => decide('changes')} data-testid="home-changes-send">보내기</Button><Button size="sm" variant="secondary" onClick={() => setMode('idle')}>취소</Button></div>}
    </li>
  );
}

/** ⑥(대표 승인 10/20 오후): 마케팅 홈은 ./Home.tsx (MarketingHome) — 채널 연결 3단계·끊김 띠 부품은 여기 것을 그대로 씀 */

function NewContent({ onClose, onDone, date }: { onClose: () => void; onDone: () => void; date?: string }) {
  const brands = useApi<{ brands: { id: string; name: string }[] }>('/api/marketing/brands');
  const [f, setF] = useState({ title: '', channel: 'instagram', brandId: '', date: date ?? '', time: '10:00', body: '', cross: [] as string[], purpose: '', metric: '', message: '', why: '', mode: 'content' as Mode }); // cross: 대표 10/20 '페이스북에도'·'스레드에도'(승인 1건) · purpose~why: 근거(대표 18:00 ①) · mode: #499-1 용도
  const [media, setMedia] = useState<{ id: string; title: string }[]>([]);
  const [ai, setAi] = useState<{ captions: string[]; hashtags: string[] } | null>(null); const [aiBusy, setAiBusy] = useState(false);
  async function draft() {
    const topic = [f.title, f.body].filter(Boolean).join('\n');
    if (topic.trim().length < 2) return toast.error('제목이나 본문에 알릴 것을 먼저 적어 주세요');
    setAiBusy(true);
    try { setAi(await api('/api/marketing/assist', { body: { channel: f.channel, topic, brandId: f.brandId || null } })); } catch (er: any) { toast.error(er.message); } finally { setAiBusy(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api('/api/marketing/contents', { body: { title: f.title, channel: f.channel, brandId: f.brandId || null, scheduledAt: f.date ? `${f.date}T${f.time}:00+09:00` : null, body: f.body, mediaIds: media.map((m) => m.id), crossChannels: f.cross, mode: f.mode,
        rationale: { purpose: f.purpose || undefined, metric: f.metric || undefined, message: f.message || undefined, why: f.why || undefined } } });
      toast.ok('승인 대기에 올렸습니다'); onDone(); onClose();
    } catch (er: any) { toast.error(er.message); }
  }
  return (
    <Modal open onClose={onClose} title="새 콘텐츠" wide>
      <form onSubmit={save} className="grid gap-3" data-testid="mkt-new">
        <Field label="제목"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} data-testid="mkt-title" /></Field>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="채널"><select className={inputCls} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value, cross: [] })} data-testid="mkt-channel">{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {/* 대표 10/20 11:40 ②: 인스타 게시물에서 '페이스북에도'·'스레드에도' 체크 = 같은 승인 1건(M1 게시 실행기가 채널마다 올림) */}
            {['instagram', 'facebook', 'threads'].includes(f.channel) && <span className="mt-1 flex flex-wrap gap-3 text-xs" data-testid="mkt-cross">{(['facebook', 'threads', 'instagram'] as const).filter((k) => k !== f.channel).map((k) => (
              <label key={k} className="inline-flex items-center gap-1"><input type="checkbox" checked={f.cross.includes(k)} onChange={(e) => setF({ ...f, cross: e.target.checked ? [...f.cross, k] : f.cross.filter((x) => x !== k) })} data-testid={`mkt-cross-${k}`} />{CHANNELS[k]}에도</label>))}</span>}</Field>
          <Field label="브랜드"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">(없음)</option>{(brands.data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="게시일"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="mkt-date" /></Field>
          <Field label="시각"><input type="time" className={inputCls} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        </div>
        {/* #499-1 용도: 콘텐츠형(참여)·광고형(전환) — 첫 줄 훅 채점 기준이 다름 */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2" data-testid="mkt-mode"><span className="font-medium text-ink">용도</span><ModeToggle value={f.mode} onChange={(m) => setF({ ...f, mode: m })} testId="mkt-mode-toggle" /><span className="text-ink-3">{MODE_HINT[f.mode]}</span></div>
        <Field label="본문·캡션"><textarea className={inputCls} rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} data-testid="mkt-body" />
          {/* #95 스레드 500자 한도 — 스레드 채널이거나 '스레드에도' 체크면 글자 수 표시 */}
          {(f.channel === 'threads' || f.cross.includes('threads')) && <span className={cx('mt-1 block text-right text-[11px] tabular-nums', [...f.body].length > 500 ? 'font-semibold text-red-600' : 'text-ink-3')} data-testid="mkt-threads-count">스레드 {[...f.body].length}/500자{[...f.body].length > 500 ? ' — 넘침' : ''}</span>}</Field>
        <div className="space-y-1.5" data-testid="mkt-ai">
          <Button type="button" size="sm" variant="secondary" onClick={draft} disabled={aiBusy} data-testid="mkt-ai-draft">{aiBusy ? 'AI 가 쓰는 중…' : 'AI 로 캡션 초안 3개'}</Button>
          {ai && <ul className="space-y-1.5">{ai.captions.map((c, n) => (
            <li key={n}><button type="button" className="w-full whitespace-pre-wrap rounded-input border border-violet-200 bg-violet-50/40 p-2 text-left text-xs hover:border-violet-400" data-testid="mkt-ai-pick"
              onClick={() => { setF({ ...f, body: ai.hashtags.length ? `${c}\n\n${ai.hashtags.map((h) => `#${h}`).join(' ')}` : c }); setAi(null); }}>{c}</button></li>))}
            <li className="text-[11px] text-ink-3">초안을 누르면 본문에 넣습니다(해시태그 포함). 사실·가격은 꼭 확인하세요.</li></ul>}
        </div>
        <Field label="시안(승인하려면 1개 이상)"><MediaPick value={media} onChange={setMedia} /></Field>
        {/* 대표 10/20 18:00 ①: 근거 칸 — 승인함 카드·상세 '왜 이 글인가'에 보임 */}
        <details className="rounded-input border border-line p-2" data-testid="mkt-new-why"><summary className="cursor-pointer text-xs text-ink-2">근거 — 목적·목표 지표·핵심 메시지·왜 이 글인가(선택)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="목적"><input className={inputCls} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} maxLength={200} placeholder="예: 신규 회원 문의" data-testid="mkt-why-purpose" /></Field>
            <Field label="목표 지표"><input className={inputCls} value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })} maxLength={200} placeholder="예: 전화 문의 5건" /></Field>
            <Field label="핵심 메시지"><input className={inputCls} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} maxLength={200} placeholder="예: 가을 이벤트 30% 할인" /></Field>
          </div>
          <Field label="왜 이 글인가" className="mt-2"><input className={inputCls} value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} maxLength={300} placeholder="예: 이달 목표 신규 문의 — 2주 주제 이벤트 안내" data-testid="mkt-why-why" /></Field></details>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" data-testid="mkt-save">승인 요청</Button></div>
      </form>
    </Modal>
  );
}

/** 콘텐츠 상세: 버전·시안·결정 기록 + (관리자) 승인·수정 요청·보류 + 수정본 올리기 + 게시 확인 */
function ContentDetail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { data, error, reload } = useApi<any>(`/api/marketing/contents/${id}`);
  const [comment, setComment] = useState(''); const [ver, setVer] = useState<{ body: string; media: { id: string; title: string }[]; note: string } | null>(null); const [url, setUrl] = useState(''); const [pubBusy, setPubBusy] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({}); const [fixOpen, setFixOpen] = useState(false); const [fixBrand, setFixBrand] = useState(''); const [fixAt, setFixAt] = useState('');
  const [qBusy, setQBusy] = useState(false);
  const brandsQ = useApi<{ brands: { id: string; name: string }[] }>(fixOpen ? '/api/marketing/brands' : null, [fixOpen]);
  // #535(대표 10/24 08:05 '승인 대기 상세 → 뒤로가기 → 마케팅 홈'): 열 때 ?c=<id> 를 방문 기록에 남김 — 뒤로가기(휴대폰·앱 버튼)는 이 창만 닫고 승인함·캘린더(탭·필터·스크롤)는 그대로
  useBackClose(true, onClose, ['c', id]);
  if (error) return <Modal open onClose={onClose} title="콘텐츠"><ErrorBox error={error} retry={reload} /></Modal>;
  if (!data) return <Modal open onClose={onClose} title="콘텐츠"><Skeleton rows={4} /></Modal>;
  const c = data.content, v = data.versions[0];
  const titleOf = (mid: string) => data.media.find((m: any) => m.id === mid)?.title ?? '자료';
  const targetAccs: { id: string; label: string; channel: string; brand: string | null; shared: boolean }[] = (data.publish?.targets ?? []).flatMap((t: any) => t.accounts.map((a: any) => ({ ...a, channel: t.label })));
  const pickedIds = targetAccs.filter((a) => !(a.id in picked) || picked[a.id]).map((a) => a.id);
  async function fix(body: { brandId?: string | null; scheduledAt?: string | null; mode?: Mode }) {
    try { await api(`/api/marketing/contents/${id}`, { method: 'PATCH', body }); toast.ok(body.mode ? `${MODE_LABEL[body.mode]} 기준으로 다시 채점했습니다` : '바로잡았습니다'); setFixOpen(false); reload(); onChange(); } catch (e: any) { toast.error(e.message); }
  }
  async function act(decision: 'approve' | 'changes' | 'hold') {
    try { await api(`/api/marketing/contents/${id}/decide`, { body: { version: c.current_version, decision, comment: comment || undefined } }); toast.ok({ approve: '승인했습니다', changes: '수정을 요청했습니다', hold: '보류했습니다' }[decision]); setComment(''); reload(); onChange(); } catch (e: any) { toast.error(e.message); reload(); }
  }
  async function newVersion() {
    try { await api(`/api/marketing/contents/${id}/versions`, { body: { body: ver!.body, mediaIds: ver!.media.map((m) => m.id), note: ver!.note || undefined } }); toast.ok('수정본을 올렸습니다 — 다시 승인 대기'); setVer(null); reload(); onChange(); } catch (e: any) { toast.error(e.message); }
  }
  async function auto(action: 'regen' | 'archive') {
    if (action === 'archive' && !confirm('이 콘텐츠를 보관할까요? 목록에서 숨겨지고 열린 제작 요청은 취소됩니다(지우지는 않음).')) return;
    try { const r = await api<any>(`/api/marketing/auto/contents/${id}`, { body: { action } });
      toast.ok(action === 'archive' ? '보관했습니다' : r.needsTopic ? '재료가 없어 주제 질문 카드를 만들었습니다' : r.passed ? '새 시안을 만들었습니다 — 다시 승인 대기' : `새 시안 품질 검사 미통과: ${r.issues.join(' · ')}`);
      if (action === 'archive') { onChange(); onClose(); } else { reload(); onChange(); } } catch (e: any) { toast.error(e.message); }
  }
  // #426 [AI로 다듬기]: 상투어·과한 느낌표/이모지·약한 훅을 AI 가 고친 새 버전(같은 사진, 0크레딧) — 다시 승인 대기
  async function polish() {
    setQBusy(true);
    try { const r = await api<{ version: number }>(`/api/marketing/auto/contents/${id}`, { body: { action: 'polish' } }); toast.ok(`다듬은 수정본(v${r.version})을 만들었습니다 — 다시 승인 대기`); reload(); onChange(); }
    catch (e: any) { toast.error(e.message); } finally { setQBusy(false); }
  }
  /** 훅 후보로 바꾸기: 지금 훅 줄만 바꾼 수정본(같은 사진) */
  async function pickHook(text: string) {
    const cur: string | undefined = data.qualityReport?.hook?.text;
    if (!v || !cur || !v.body.includes(cur)) { toast.error('본문에서 지금 훅 줄을 찾지 못했습니다 — 수정본으로 직접 고쳐 주세요'); return; }
    setQBusy(true);
    try { await api(`/api/marketing/contents/${id}/versions`, { body: { body: v.body.replace(cur, () => text), mediaIds: v.media_ids, note: `훅 바꾸기: ${text.slice(0, 80)}` } }); toast.ok('훅을 바꾼 수정본을 올렸습니다 — 다시 승인 대기'); reload(); onChange(); }
    catch (e: any) { toast.error(e.message); } finally { setQBusy(false); }
  }
  async function publish() { try { await api(`/api/marketing/contents/${id}/publish`, { body: { url } }); toast.ok('게시 확인했습니다'); reload(); onChange(); } catch (e: any) { toast.error(e.message); } }
  // 대표 10/20 22:30 ② M1: [서버로 게시] — 연결 계정으로 워크인 서버가 올림(승인된 최신 버전, 시험 제외). 결과는 게시 기록 줄에
  async function serverPublish(atSchedule = false) {
    const chosen = targetAccs.filter((a) => pickedIds.includes(a.id));
    if (!chosen.length) { toast.error('게시할 계정을 하나 이상 고르세요'); return; }
    const names = chosen.map((a) => `${a.channel} ${a.label}`).join(' · ');
    if (!confirm(`${names} 에 ${atSchedule ? '예정 시각에' : '지금'} 게시할까요? 게시 뒤에는 워크인에서 지울 수 없습니다.`)) return;
    setPubBusy(true);
    try { const r = await api<any>(`/api/marketing/contents/${id}/publish/server`, { body: { atSchedule, accountIds: pickedIds } });
      const done = (r.ran ?? []).filter((x: any) => x.status === 'done').length, bad = (r.ran ?? []).filter((x: any) => ['failed', 'error'].includes(x.status));
      toast.ok(atSchedule ? `예정 시각에 게시합니다(${r.jobs.length}건)` : bad.length ? `게시 실패 ${bad.length}건: ${bad[0].error ?? ''}` : done ? `게시했습니다(${done}건)` : `게시 작업 ${r.jobs.length}건 — 처리 중`);
      reload(); onChange(); } catch (e: any) { toast.error(e.message); } finally { setPubBusy(false); }
  }
  async function retryJob(jobId: string) { try { await api(`/api/marketing/publish/jobs/${jobId}/retry`, { body: {} }); toast.ok('다시 시도했습니다'); reload(); onChange(); } catch (e: any) { toast.error(e.message); } }
  return (
    <Modal open onClose={onClose} title={c.title} wide>
      <div className="space-y-3 text-sm" data-testid="mkt-detail">
        <AiAsk space="marketing" examples={AI_ASK_EXAMPLES.mktContent} subject={`시안 ${String(c.title).slice(0, 40)}`} compact testId="ai-ask-content" />
        <p className="text-xs text-ink-2">{CHANNELS[c.channel]} · {c.brand ?? '브랜드 없음'} · {c.scheduled_at ? `게시 ${fmtDateTime(c.scheduled_at)}` : '게시일 미정'}{c.deadline && ` · 승인 마감 ${fmtDateTime(c.deadline)}`} · <b data-testid="mkt-status">{STATUS[c.status]}</b>{c.mode === 'ad' && <> · <ModeChip mode="ad" /></>} · v{c.current_version}{c.approved_version && c.approved_version !== c.current_version ? ` (v${c.approved_version} 승인은 무효)` : ''}</p>
        {data.canDecide && c.status !== 'published' && (fixOpen ? (
          <div className="flex flex-wrap items-end gap-2 rounded-input border border-line p-2 text-xs" data-testid="mkt-fix">
            <label className="grid gap-0.5">브랜드<select className={cx(inputCls, 'h-8 py-0 text-xs')} value={fixBrand} onChange={(e) => setFixBrand(e.target.value)} data-testid="mkt-fix-brand"><option value="">(없음)</option>{(brandsQ.data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label className="grid gap-0.5">게시 예정<input type="datetime-local" className={cx(inputCls, 'h-8 py-0 text-xs')} value={fixAt} onChange={(e) => setFixAt(e.target.value)} data-testid="mkt-fix-at" /></label>
            <Button size="sm" onClick={() => fix({ brandId: fixBrand || null, scheduledAt: fixAt ? new Date(fixAt).toISOString() : null })} data-testid="mkt-fix-save">저장</Button><Button size="sm" variant="secondary" onClick={() => setFixOpen(false)}>취소</Button>
            <span className="text-ink-3">승인 상태는 그대로 — 브랜드가 틀렸거나 마감이 지난 건을 바로잡을 때</span>
          </div>
        ) : <button type="button" className="text-xs underline text-ink-2" onClick={() => { setFixBrand(c.brand_id ?? ''); setFixAt(c.scheduled_at ? new Date(new Date(c.scheduled_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''); setFixOpen(true); }} data-testid="mkt-fix-open">브랜드·게시 예정 바로잡기</button>)}
        {c.quality?.passed === false && c.quality?.issues?.length > 0 && <p className="rounded-input bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="mkt-quality">{c.auto ? '품질 검사: ' : ''}{c.quality.issues.join(' · ')}</p>}
        {data.qualityReport && <QualityPanel r={data.qualityReport as QReport} channel={c.channel} busy={qBusy}
          onMode={data.canDecide && c.status !== 'published' ? (m) => fix({ mode: m }) : undefined}
          onPolish={data.canDecide && !['published', 'canceled', 'approved'].includes(c.status) && v?.body ? polish : undefined}
          onPickHook={data.canDecide && !['published', 'canceled'].includes(c.status) && c.kind !== 'blog' && v ? pickHook : undefined} />}
        <WhyBox r={c.rationale} />
        {v && <ChannelPreview channel={c.channel} kind={c.kind} brand={c.brand} handle={c.handle} logo={c.brand_logo} color={c.brand_color} title={c.title} body={v.body} media={v.media_ids} info={(data.media ?? []).map((m: any) => ({ id: m.id, mime: m.mime_type }))} />}
        {!v ? <p className="rounded-input bg-slate-50 p-3 text-xs text-ink-3">아직 만든 시안이 없습니다{c.auto && c.produce_at ? ` — 제작 예정 ${fmtDateTime(c.produce_at)}` : ''}</p> : <>
        <div className="rounded-input bg-slate-50 p-3"><p className="mb-1 text-xs text-ink-3">v{v.version} · {v.created_by_name}{v.note ? ` · ${v.note}` : ''}</p><p className="whitespace-pre-wrap">{v.body || '(본문 없음)'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{v.media_ids.length ? v.media_ids.map((m: string) => <a key={m} href={`/api/library/${m}/download?inline=1`} target="_blank" rel="noopener" className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-800 underline">{titleOf(m)}</a>) : <span className="text-xs text-amber-700">{c.channel === 'blog' || c.channel === 'threads' ? `사진 없음 — ${c.channel === 'blog' ? '블로그' : '스레드'}는 글만으로도 승인됩니다` : '시안 없음 — 승인 불가'}</span>}</div></div>
        {data.canDecide && !['published', 'canceled'].includes(c.status) && (
          <div className="space-y-2 rounded-input border border-violet-200 p-3" data-testid="mkt-decide">
            <input className={inputCls} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="수정 요청·보류는 이유를 적어 주세요" aria-label="결정 메모" />
            <div className="flex flex-wrap gap-2"><Button onClick={() => act('approve')} data-testid="mkt-approve">승인</Button><Button variant="secondary" onClick={() => act('changes')} data-testid="mkt-changes">수정 요청</Button><Button variant="secondary" onClick={() => act('hold')} data-testid="mkt-hold">보류</Button></div>
          </div>
        )}
        {data.canDecide && !['published', 'canceled'].includes(c.status) && (
          <div className="flex flex-wrap gap-2 text-xs">
            {c.auto && c.status !== 'approved' && <Button size="sm" variant="secondary" onClick={() => auto('regen')} data-testid="mkt-regen">AI 다시 만들기</Button>}
            <Button size="sm" variant="secondary" onClick={() => auto('archive')} data-testid="mkt-archive">보관(숨기기)</Button>
          </div>
        )}
        {c.status !== 'published' && (ver ? (
          <div className="space-y-2 rounded-input border border-line p-3">
            <textarea className={inputCls} rows={4} value={ver.body} onChange={(e) => setVer({ ...ver, body: e.target.value })} aria-label="수정본 본문" />
            <MediaPick value={ver.media} onChange={(m) => setVer({ ...ver, media: m })} />
            <input className={inputCls} value={ver.note} onChange={(e) => setVer({ ...ver, note: e.target.value })} placeholder="무엇을 고쳤나요" aria-label="수정 메모" />
            <div className="flex gap-2"><Button onClick={newVersion} data-testid="mkt-version-save">수정본 올리기</Button><Button variant="secondary" onClick={() => setVer(null)}>취소</Button></div>
          </div>
        ) : <Button variant="secondary" onClick={() => setVer({ body: v.body, media: v.media_ids.map((m: string) => ({ id: m, title: titleOf(m) })), note: '' })} data-testid="mkt-version-open">수정본 올리기</Button>)}
        {((c.status === 'approved' && c.approved_version === c.current_version) || c.status === 'published') && <PublishHelper published={c.status === 'published'} channel={c.channel} title={c.title} body={v.body} media={v.media_ids.map((m: string) => ({ id: m, title: titleOf(m) }))} />}
        {((c.status === 'approved') || (c.status === 'published' && c.published_deleted_at)) && c.approved_version === c.current_version && data.publish?.canServer && (
          <div className="rounded-input border border-violet-200 bg-violet-50/40 p-3" data-testid="mkt-server-publish">
            <p className="text-xs text-ink-2">연결된 계정으로 워크인 서버가 올립니다 — 대상 계정(기본: 이 브랜드 계정 + 공용){data.publish.targets.some((t: any) => !t.accounts.length) && <span className="ml-1 text-amber-800">· {data.publish.targets.filter((t: any) => !t.accounts.length).map((t: any) => t.label).join('·')}은 계정 없음</span>}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid="mkt-publish-targets">{targetAccs.map((a) => <label key={a.id} className={cx('inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs', pickedIds.includes(a.id) ? 'border-violet-400 bg-white font-medium' : 'border-line bg-white text-ink-3')}>
              <input type="checkbox" className="size-4 accent-violet-600" checked={pickedIds.includes(a.id)} onChange={(e) => setPicked({ ...picked, [a.id]: e.target.checked })} data-testid="mkt-publish-target" />{a.channel} {a.label}{a.shared ? ' · 공용' : a.brand ? ` · ${a.brand}` : ''}</label>)}</div>
            <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" onClick={() => serverPublish(false)} disabled={pubBusy} data-testid="mkt-server-publish-now">지금 게시</Button>
              {c.scheduled_at && new Date(c.scheduled_at) > new Date() && <Button size="sm" variant="secondary" onClick={() => serverPublish(true)} disabled={pubBusy} data-testid="mkt-server-publish-at">예정 시각에 게시</Button>}
              {data.publish.autoPublish && <span className="self-center text-[11px] text-emerald-800">자동 게시 켜짐 — 예정 시각이 되면 올라갑니다</span>}</div>
          </div>
        )}
        {c.status === 'approved' && c.approved_version === c.current_version && data.canDecide && !c.is_test && !data.publish?.canServer && (data.publish?.targets ?? []).some((t: any) => t.reason && t.reason !== 'none') && (
          <p className="rounded-input bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="mkt-publish-blocked">
            {(data.publish.targets as any[]).some((t) => t.reason === 'unassigned') ? `계정에 브랜드를 지정하세요 — ${(data.publish.targets as any[]).flatMap((t) => t.unassigned).join('·')} 은 브랜드 미지정이라 게시 대상에서 빠져 있습니다.` : `이 브랜드(${c.brand ?? '브랜드 없음'})에 지정된 계정이 없습니다 — 다른 브랜드 계정으로는 나가지 않습니다.`}
            <Link href="/s/marketing/connections" className="ml-1 font-medium underline">연결 계정에서 지정 →</Link></p>
        )}
        {c.status === 'approved' && (
          <div className="flex gap-2"><input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="직접 올렸다면 게시한 글 주소(https://…)" aria-label="게시 주소" /><Button onClick={publish} disabled={!url} data-testid="mkt-publish">게시 확인</Button></div>
        )}
        </>}
        {c.published_deleted_at && <p className="rounded-input bg-red-50 px-2 py-1 text-xs text-red-800" data-testid="mkt-published-deleted">매체에서 게시물이 삭제된 것으로 확인됐습니다({fmtDateTime(c.published_deleted_at)}). 다시 올리려면 아래 [서버로 게시]를 누르세요.</p>}
        {c.published_url && <p className="text-xs">게시됨: <a className="underline" href={c.published_url} target="_blank" rel="noopener">{c.published_url}</a></p>}
        {!!data.publishJobs?.length && <ul className="space-y-0.5 border-t border-line pt-2 text-xs text-ink-2" data-testid="mkt-publish-jobs">{data.publishJobs.map((j: any, i: number) => <li key={i} data-testid="mkt-publish-job" data-status={j.deleted_at ? 'deleted' : j.status}>게시 기록{j.is_test ? ' [시험]' : ''} v{j.version} · {({ naver_blog: '네이버 블로그(도우미)', manual: '직접 게시', meta_ig: '인스타그램', meta_fb: '페이스북 페이지', meta_threads: '스레드', youtube: '유튜브' } as any)[j.provider] ?? j.provider}{j.account ? ` ${j.account}` : ''} · <b className={j.deleted_at || j.status === 'failed' ? 'text-red-700' : j.status === 'done' ? 'text-emerald-800' : ''}>{j.deleted_at ? '게시 삭제됨' : ({ done: '완료', queued: '대기', running: '진행 중', verify: '확인 중', failed: '실패', canceled: '취소' } as any)[j.status]}</b>{j.deleted_at ? <span className="text-ink-3"> ({fmtDateTime(j.deleted_at)} 확인)</span> : null}{j.permalink && j.provider !== 'manual' && <> · <a className="underline" href={j.permalink} target="_blank" rel="noopener">열기</a></>}{j.last_error && <span className="text-red-700"> · {j.last_error}</span>} · {j.requested_by_name ?? '자동'} · {fmtDateTime(j.created_at)}
          {data.canDecide && j.status === 'failed' && j.id && <button type="button" className="ml-1 underline" onClick={() => retryJob(j.id)} data-testid="mkt-publish-retry">다시 시도</button>}</li>)}</ul>}
        {!!data.decisions.length && <ul className="space-y-0.5 border-t border-line pt-2 text-xs text-ink-2">{data.decisions.map((d: any, i: number) => <li key={i}>v{d.version} {({ approve: '승인', changes: '수정 요청', hold: '보류' } as any)[d.decision]} · {d.decided_by_name} · {fmtDateTime(d.decided_at)}{d.comment ? ` — ${d.comment}` : ''}</li>)}</ul>}
      </div>
    </Modal>
  );
}

/**
 * 승인함(대표 02:30 ①): 콘텐츠 시안 + 운영실 승인 요청(운영 제안·광고 예산·월 목표·제작 의뢰)을 종류별 탭으로 한곳에. 탭마다 건수, 카드에서 바로 승인·반려.
 * 반려 사유를 적으면 AI 가 사유를 반영한 v2 를 다시 올림(최대 3회). 콘텐츠 탭은 기존 승인함 그대로(승인 대기·수정 요청·보류).
 */
type Inbox = { counts: { contents: number; proposals: number; budget: number; goals: number; briefs: number; ads: number; concepts: number }; total: number; proposals: any[]; budgets: any[]; goals: Goal[]; briefs: InboxBrief[]; ads: MetaPlanRow[]; concepts: ConceptSet[]; kinds: Record<string, string>; canEdit: boolean; today: string; maxRevisions: number; userId: string };
type InboxBrief = { id: string; kind: string; channel: string; purpose: string; message: string; status: string; quantity: number; due_date: string | null; created_at: string; brand: string | null; created_by_name: string | null; summary_ko: string | null; model: string | null };
const INBOX_TABS: [string, string][] = [['contents', '콘텐츠'], ['proposals', '운영 제안'], ['budget', '광고 예산'], ['concepts', '광고 컨셉'], ['ads', '광고 초안'], ['goals', '월 목표'], ['briefs', '제작 의뢰']];
export function Approvals() {
  const sp = useSearchParams();
  const [open, setOpen] = useState<string | null>(sp.get('c'));
  const [nw, setNw] = useState(sp.get('new') === '1'); // 앱 더보기 › 만들기 › 새 콘텐츠
  const day = sp.get('day') ?? ''; // 현황 '오늘' 카드: produced·soon·today·published
  const [tab, setTab] = useState(() => (INBOX_TABS.some(([k]) => k === sp.get('tab')) ? String(sp.get('tab')) : 'contents'));
  const DAY_LABEL: Record<string, string> = { produced: '오늘 제작된 시안', soon: '오늘 승인할 것(내일까지 게시 예정)', today: '오늘 게시 예정', published: '오늘 게시됨' };
  const { data, error, reload } = useApi<{ contents: Content[] }>(`/api/marketing/contents?view=approvals${DAY_LABEL[day] ? `&day=${day}` : ''}`);
  const inbox = useApi<Inbox>('/api/marketing/inbox');
  const reloadAll = () => { reload(); inbox.reload(); };
  const counts = inbox.data?.counts;
  return (
    <div className="space-y-3" data-testid="mkt-approvals">
      <div className="flex items-center gap-2"><h1 className="text-xl font-bold" style={{ color: C }}>{DAY_LABEL[day] ?? '승인함'}</h1>{DAY_LABEL[day] && <Link href="/s/marketing/approvals" className="text-xs underline" data-testid="mkt-day-clear">승인함 전체</Link>}
        <span className="ml-auto flex flex-wrap items-center gap-2">{inbox.data && <span className="text-xs text-ink-2" data-testid="mkt-inbox-total">승인할 것 <b className="text-orange-700">{inbox.data.total}건</b></span>}<AiAsk space="marketing" examples={AI_ASK_EXAMPLES.mktContents} compact /><Button onClick={() => setNw(true)} data-testid="mkt-new-open">새 콘텐츠</Button></span></div>
      {!DAY_LABEL[day] && <div className="flex gap-1 overflow-x-auto pb-0.5" role="tablist" data-testid="mkt-inbox-tabs">{INBOX_TABS.map(([k, l]) => { const n = counts ? counts[k as keyof Inbox['counts']] : 0; return (
        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`mkt-inbox-tab-${k}`} data-count={n}
          className={cx('shrink-0 rounded-full border px-3 py-1 text-xs', tab === k ? 'border-violet-600 bg-violet-50 font-semibold text-violet-800' : 'border-line bg-white text-ink-2')}>{l}{n ? <span className={cx('ml-1 rounded-full px-1.5 text-[10px] font-semibold', tab === k ? 'bg-violet-600 text-white' : 'bg-orange-100 text-orange-800')} data-testid={`mkt-inbox-count-${k}`}>{n}</span> : null}</button>); })}</div>}
      {(tab === 'contents' || DAY_LABEL[day]) && <>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={4} /> : <ApprovalList contents={data.contents as unknown as CardContent[]} canDecide={!!(data as any).canDecide} plain={!!DAY_LABEL[day]} onOpen={setOpen} onDone={reloadAll} />}
        <OpsRequests />
      </>}
      {!DAY_LABEL[day] && tab !== 'contents' && (inbox.error ? <ErrorBox error={inbox.error} retry={inbox.reload} /> : !inbox.data ? <Skeleton rows={4} /> : <InboxTab tab={tab} d={inbox.data} onChange={reloadAll} />)}
      {open && <ContentDetail id={open} onClose={() => setOpen(null)} onChange={reloadAll} />}
      {nw && <NewContent onClose={() => setNw(false)} onDone={reloadAll} />}
    </div>
  );
}
function InboxTab({ tab, d, onChange }: { tab: string; d: Inbox; onChange: () => void }) {
  const empty = (t: string, href: string, label: string) => <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-ink-3" data-testid="mkt-inbox-empty">{t} <Link href={href} className="underline">{label}</Link></p>;
  if (tab === 'proposals') return d.proposals.length ? <div className="grid gap-3 md:grid-cols-2" data-testid="mkt-inbox-proposals">{d.proposals.map((p) => <ProposalCard key={p.id} p={p} kinds={d.kinds} canEdit={d.canEdit} onChange={onChange} />)}</div>
    : empty('대기 중인 운영 제안 카드가 없습니다.', '/s/marketing/ops', '운영실에서 [AI 마케터 제안 받기] →');
  if (tab === 'budget') return d.budgets.length ? <div className="space-y-3" data-testid="mkt-inbox-budget">{d.budgets.map((b) => <BudgetCard key={b.id} b={b} month={b.month} canEdit={d.canEdit} busy={false} onDraft={() => {}} onChange={onChange} compact />)}</div>
    : empty('승인 대기 중인 광고 예산 계획이 없습니다.', '/s/marketing/ops', '운영실에서 계획 만들기 →');
  // #494 메타 광고 초안(Meta 에 꺼진 채로 만든 것) — 승인하면 서버가 상한을 다시 확인하고 켬
  if (tab === 'ads') return d.ads.length ? <div className="grid gap-3 xl:grid-cols-2" data-testid="mkt-inbox-ads">{d.ads.map((r) => <MetaDraftCard key={r.id} r={r} canEdit={d.canEdit} onChange={onChange} />)}</div>
    : empty('승인 대기 중인 광고 초안이 없습니다.', '/s/marketing/ad-ops', '광고 운영에서 메타 광고 세팅 →');
  // #499-4 상황 매트릭스: 1~4개 채택 → 광고형 제작 의뢰 · 반려 사유 → AI 고친 안
  if (tab === 'concepts') return d.concepts.length ? <div className="space-y-3" data-testid="mkt-inbox-concepts">{d.concepts.map((s) => <ConceptSetCard key={s.id} s={s} canDecide={d.canEdit} userId={d.userId} maxRevisions={d.maxRevisions} onChange={onChange} />)}</div>
    : empty('채택을 기다리는 광고 컨셉이 없습니다.', '/s/marketing/ops#concepts', '운영실에서 상황 매트릭스 만들기 →');
  if (tab === 'goals') return d.goals.length ? <div className="space-y-3" data-testid="mkt-inbox-goals">{d.goals.map((g) => <GoalCard key={g.id} g={g} canEdit={d.canEdit} today={d.today} onChange={onChange} />)}</div>
    : empty('승인 대기 중인 월 운영 목표 초안이 없습니다.', '/s/marketing/goals', '월 운영 목표 →');
  return d.briefs.length ? <div className="grid gap-3 md:grid-cols-2" data-testid="mkt-inbox-briefs">{d.briefs.map((b) => <BriefDecisionCard key={b.id} b={b} canEdit={d.canEdit} onChange={onChange} />)}</div>
    : empty('생성 결정을 기다리는 제작 의뢰가 없습니다.', '/s/marketing/automation?tab=studio', '제작의뢰실 →');
}
/** 제작 의뢰(프롬프트 준비됨): 관리자가 [생성](크레딧) 또는 [취소]. 프롬프트 수정은 제작의뢰실에서 */
function BriefDecisionCard({ b, canEdit, onChange }: { b: InboxBrief; canEdit: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  async function act(action: 'generate' | 'cancel', msg: string) {
    setBusy(true);
    try { await api(`/api/marketing/studio/${b.id}`, { method: 'PATCH', body: { action } }); toast.ok(msg); onChange(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <article className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="inbox-brief" data-status={b.status}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]"><span className="rounded-full bg-violet-50 px-2 py-0.5 font-semibold text-violet-800">{b.status === 'failed' ? '생성 실패 — 다시' : '프롬프트 준비'}</span>{b.brand && <span className="text-ink-2">{b.brand}</span>}<span className="text-ink-3">{channelLabel(b.channel)} · {b.kind} · {b.quantity}건{b.due_date ? ` · 마감 ${b.due_date}` : ''} · {b.created_by_name ?? ''} {fmtDateTime(b.created_at)}</span></div>
      <h3 className="mt-1.5 text-sm font-bold">{b.message}</h3>
      {b.summary_ko && <p className="mt-1 whitespace-pre-wrap text-xs text-ink-2">{b.summary_ko.slice(0, 300)}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Link href={`/s/marketing/automation?tab=studio&brief=${b.id}`} className="text-xs underline">프롬프트 보기·고치기 →</Link>
        {canEdit && <span className="ml-auto flex gap-1.5"><Button size="sm" onClick={() => act('generate', '생성을 시작했습니다 — 시안이 나오면 승인 대기로 올라옵니다')} disabled={busy} data-testid="inbox-brief-generate">생성</Button>
          <Button size="sm" variant="secondary" onClick={() => { if (confirm('이 의뢰를 취소할까요?')) void act('cancel', '취소했습니다'); }} disabled={busy} data-testid="inbox-brief-cancel">취소</Button></span>}
      </div>
    </article>
  );
}

/**
 * 승인함(운영실 명세 2-2): 게시 시각순 한 목록 · 처음 3장 펼침 + 'N건 더 보기' · 브랜드 탭 · 마감 지난 것은 숫자에서 빼고 접힌 '일정 재배치 필요'로.
 * 승인 가능 = 승인 대기·마감 안 지남. 수정 요청·보류는 아래 '수정·보류' 묶음(새 버전 기다림)
 */
function ApprovalList({ contents, canDecide, plain, onOpen, onDone }: { contents: CardContent[]; canDecide: boolean; plain: boolean; onOpen: (id: string) => void; onDone: () => void }) {
  const [brand, setBrand] = useState(''); const [more, setMore] = useState(false);
  // 대표 10/20 14:10 ②: 브랜드 탭은 회사 브랜드 전체(콘텐츠가 없는 브랜드도) · 예정(초안) 묶음 · 제작 예정이 없는 브랜드 안내
  const allBrands = useApi<{ brands: { id: string; name: string }[] }>('/api/marketing/brands');
  const brands = [...new Set([...(allBrands.data?.brands ?? []).map((b) => b.name), ...contents.map((c) => c.brand).filter(Boolean) as string[]])];
  const list = contents.filter((c) => !brand || c.brand === brand);
  const drafts = plain ? [] : list.filter((c) => c.status === 'draft').sort((a, b) => String(a.scheduled_at ?? '9999').localeCompare(String(b.scheduled_at ?? '9999')));
  const emptyBrands = plain ? [] : (allBrands.data?.brands ?? []).map((b) => b.name).filter((n) => !contents.some((c) => c.brand === n && ['draft', 'pending', 'changes', 'hold', 'approved'].includes(c.status)));
  // #516·#455: 시안 없이는 승인할 수 없는 글은 '승인할 시안' 수에서 빼고 따로(빨간 칸 — [지금 만들기])
  const ready = plain ? list : list.filter((c) => c.status === 'pending' && !c.late && !needsVisual(c));
  const noVisual = plain ? [] : list.filter((c) => c.status === 'pending' && !c.late && needsVisual(c));
  const postponed = plain ? [] : list.filter((c) => c.status === 'hold' && c.quality?.postponed); // 로컬 10/24 09:00: 옮길 날짜가 없어 멈춘 글(취소 아님)
  const waiting = plain ? [] : list.filter((c) => (c.status === 'changes' || (c.status === 'hold' && !c.quality?.postponed)) && !c.late);
  const late = plain ? [] : list.filter((c) => c.late);
  // 로컬 10/21 08:10·09:20: 승인됐지만 아직 게시 전 — 예정 시각 임박·미래 순, 지난 건은 '예정 지남' 접힘, 기본 10건 + 더보기(브랜드 필터 적용)
  const nowMs = Date.now(); const [moreApproved, setMoreApproved] = useState(false);
  const approvedAll = plain ? [] : list.filter((c) => c.status === 'approved').sort((a, b) => String(a.scheduled_at ?? '9999').localeCompare(String(b.scheduled_at ?? '9999')));
  const approvedWait = approvedAll.filter((c) => !c.scheduled_at || new Date(c.scheduled_at).getTime() >= nowMs - 864e5);
  const approvedPast = approvedAll.filter((c) => c.scheduled_at && new Date(c.scheduled_at).getTime() < nowMs - 864e5);
  const shown = more ? ready : ready.slice(0, 3);
  return (
    <div className="space-y-3">
      {brands.length > 1 && <div className="flex flex-wrap gap-1.5" data-testid="mkt-brand-tabs">{['', ...brands].map((b) => (
        <button key={b || 'all'} type="button" onClick={() => setBrand(b)} className={cx('rounded-full border px-3 py-1 text-xs', brand === b ? 'border-violet-600 bg-violet-50 font-semibold text-violet-800' : 'border-line bg-white')}>
          {b || '전체'} {contents.filter((c) => (!b || c.brand === b) && c.status === 'pending' && !c.late && !needsVisual(c)).length}</button>))}</div>}
      {!plain && <p className="text-sm" data-testid="mkt-approvable-count">승인할 시안 <b className="text-orange-700">{ready.length}건</b></p>}
      {!ready.length ? <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-ink-3">{plain ? '해당 콘텐츠가 없습니다' : '지금 승인할 최종 시안이 없습니다.'}</p> : (
        <div className="space-y-2">{shown.map((c) => <ApprovalCard key={c.id} c={c} canDecide={canDecide} onDone={onDone} onOpen={() => onOpen(c.id)} />)}
          {!more && ready.length > 3 && <Button variant="secondary" className="w-full" onClick={() => setMore(true)} data-testid="mkt-more">{ready.length - 3}건 더 보기</Button>}</div>
      )}
      {noVisual.length > 0 && <details open className="rounded-card border border-red-300 bg-red-50/40 p-3 text-sm" data-testid="mkt-no-visual"><summary className="cursor-pointer font-medium text-red-800">시안 없음 — 시안을 붙여야 승인할 수 있습니다 {noVisual.length}건 (승인 숫자에서 뺌)</summary>
        <div className="mt-2 space-y-2">{noVisual.map((c) => <ApprovalCard key={c.id} c={c} canDecide={canDecide} onDone={onDone} onOpen={() => onOpen(c.id)} />)}</div></details>}
      {approvedWait.length > 0 && <details open className="rounded-card border border-emerald-200 bg-emerald-50/30 p-3 text-sm" data-testid="mkt-approved-wait"><summary className="cursor-pointer font-medium text-emerald-900">승인됨 · 게시 전 {approvedWait.length}건 — 열어서 [지금 게시] 또는 예정 시각에 자동</summary>
        <div className="mt-2 space-y-2">{(moreApproved ? approvedWait : approvedWait.slice(0, 10)).map((c) => <div key={c.id} className="space-y-1"><ApprovalCard c={c} canDecide={canDecide} onDone={onDone} onOpen={() => onOpen(c.id)} />
          {canDecide && <Button size="sm" variant="secondary" onClick={() => onOpen(c.id)} data-testid="mkt-approved-publish">열어서 게시 →</Button>}</div>)}
          {!moreApproved && approvedWait.length > 10 && <Button variant="secondary" className="w-full" onClick={() => setMoreApproved(true)} data-testid="mkt-approved-more">{approvedWait.length - 10}건 더 보기</Button>}</div></details>}
      {approvedPast.length > 0 && <details className="rounded-card border border-line bg-white p-3 text-sm" data-testid="mkt-approved-past"><summary className="cursor-pointer font-medium text-ink-2">승인됨 · 예정 지남 {approvedPast.length}건 — 열어서 “브랜드·게시 예정 바로잡기”로 재배치</summary>
        <div className="mt-2 space-y-2">{approvedPast.slice(0, 30).map((c) => <ApprovalCard key={c.id} c={c} canDecide={canDecide} onDone={onDone} onOpen={() => onOpen(c.id)} />)}</div></details>}
      {drafts.length > 0 && <details className="rounded-card border border-line bg-white p-3 text-sm" data-testid="mkt-drafts"><summary className="cursor-pointer font-medium text-ink-2">예정(초안) {drafts.length}건 — 제작 예정, 시안이 오면 승인 대기로</summary>
        <ul className="mt-2 divide-y divide-line text-xs">{drafts.slice(0, 30).map((c) => <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="mkt-draft"><button type="button" className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => onOpen(c.id)}>{c.title}</button><span className="text-ink-3">{[c.brand, channelLabel(c.channel, c.kind), whenLabel(c.scheduled_at), c.auto ? '자동 제작' : null].filter(Boolean).join(' · ')}</span></li>)}</ul></details>}
      {emptyBrands.length > 0 && <p className="rounded-card border border-dashed border-amber-300 bg-amber-50/40 px-3 py-2 text-xs text-amber-900" data-testid="mkt-brand-empty">제작 예정 없음: <b>{emptyBrands.join(' · ')}</b> — <Link href="/s/marketing/automation" className="font-medium underline">자동 제작 규칙</Link>을 켜거나 <Link href="/s/marketing/ops" className="font-medium underline">운영실</Link>에서 제작을 의뢰하세요.</p>}
      {postponed.length > 0 && <details open className="rounded-card border border-amber-300 bg-amber-50/60 p-3 text-sm" data-testid="mkt-postponed"><summary className="cursor-pointer font-medium text-amber-900">미뤄진 글 — 옮길 날짜가 없어 멈춘 글 {postponed.length}건(취소 아님)</summary>
        <p className="mt-1 text-xs text-amber-900">날짜를 골라 다시 올리면 승인 대기로 돌아가고, 버리면 취소됩니다.</p>
        <ul className="mt-2 space-y-2">{postponed.map((c) => <PostponedRow key={c.id} c={c} canDecide={canDecide} onOpen={() => onOpen(c.id)} onDone={onDone} />)}</ul></details>}
      {waiting.length > 0 && <details className="rounded-card border border-line bg-white p-3 text-sm" data-testid="mkt-waiting"><summary className="cursor-pointer font-medium">수정 요청·보류 — 새 버전 기다림 {waiting.length}건</summary>
        <div className="mt-2 space-y-2">{waiting.map((c) => <ApprovalCard key={c.id} c={c} canDecide={canDecide} onDone={onDone} onOpen={() => onOpen(c.id)} />)}</div></details>}
      {late.length > 0 && <details className="rounded-card border border-red-200 bg-red-50/40 p-3 text-sm" data-testid="mkt-late"><summary className="cursor-pointer font-medium text-red-800">승인 마감 지남 — 일정 재배치 필요 {late.length}건 (승인 숫자에서 뺌)</summary>
        <div className="mt-2 space-y-2">{late.map((c) => <ApprovalCard key={c.id} c={c} canDecide={canDecide} onDone={onDone} onOpen={() => onOpen(c.id)} />)}</div></details>}
    </div>
  );
}

/** 로컬 10/24 09:00 '미뤄진 글' 한 줄: 원래 게시 시각 · [날짜 골라 다시 올리기](승인 대기로) · [버리기](취소) */
function PostponedRow({ c, canDecide, onOpen, onDone }: { c: CardContent; canDecide: boolean; onOpen: () => void; onDone: () => void }) {
  const from = c.quality?.postponed?.from ?? null;
  const [date, setDate] = useState(() => ymdK(new Date(Date.now() + 864e5)));
  const [time, setTime] = useState(() => (from ? hmK(from) : '10:00'));
  const [busy, setBusy] = useState(false);
  async function act(action: 'reschedule' | 'discard') {
    if (action === 'discard' && !confirm(`'${c.title}' 글을 버릴까요? 버린 글은 승인함에서 사라집니다.`)) return;
    setBusy(true);
    try {
      const r = await api<{ sameDay?: number }>(`/api/marketing/contents/${c.id}/postponed`, { body: action === 'discard' ? { action } : { action, date, time } });
      toast.ok(action === 'discard' ? '버렸습니다' : `${Number(date.slice(5, 7))}/${Number(date.slice(8))} ${time} 게시로 승인 대기에 다시 올렸습니다${r.sameDay ? ` — 그날 같은 브랜드·채널 글이 ${r.sameDay}건 더 있습니다` : ''}`);
      onDone();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <li className="rounded-input border border-line bg-white p-2.5" data-testid="mkt-postponed-row" data-id={c.id}>
      <button type="button" className="block text-left font-medium hover:underline" onClick={onOpen}>{c.title}</button>
      <p className="text-xs text-ink-3">{[c.brand, channelLabel(c.channel, c.kind), from ? `원래 ${whenLabel(from)} 게시` : null].filter(Boolean).join(' · ')}</p>
      {canDecide && <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <input type="date" className={cx(inputCls, 'h-8 w-36 py-0 text-xs')} value={date} min={ymdK(new Date())} onChange={(e) => setDate(e.target.value)} aria-label="다시 올릴 날짜" data-testid="mkt-postponed-date" />
        <input type="time" className={cx(inputCls, 'h-8 w-28 py-0 text-xs')} value={time} onChange={(e) => setTime(e.target.value)} aria-label="게시 시각" data-testid="mkt-postponed-time" />
        <Button size="sm" onClick={() => act('reschedule')} disabled={busy || !date || !time} data-testid="mkt-postponed-reschedule">날짜 골라 다시 올리기</Button>
        <Button size="sm" variant="secondary" onClick={() => act('discard')} disabled={busy} data-testid="mkt-postponed-discard">버리기</Button>
      </div>}
    </li>
  );
}

/** 운영실에서 옮겨 온 이전 요청 기록(대표 요청 문장·처리 상태·결과) — 있을 때만, 접어서 */
function OpsRequests() {
  const { data } = useApi<{ requests: { id: string; text: string; route: string | null; status: string; status_note: string | null; result_summary: string | null; created_at: string | null; delivered_at: string | null }[] }>('/api/marketing/ops-requests');
  if (!data?.requests.length) return null;
  return (
    <details className="rounded-card border border-line bg-white p-3 text-sm shadow-card" data-testid="ops-requests"><summary className="cursor-pointer font-medium">이전 요청 기록(운영실) · {data.requests.length}건</summary>
      <ul className="mt-2 divide-y divide-line text-xs">{data.requests.map((r) => (
        <li key={r.id} className="space-y-0.5 py-1.5" data-testid="ops-request"><p className="whitespace-pre-wrap break-words text-ink">{r.text}</p>
          <p className="text-ink-3">{r.created_at ? fmtDateTime(r.created_at) : ''} · <b>{r.status}</b>{r.route ? ` · ${r.route}` : ''}{r.delivered_at ? ` · 전달 ${fmtDateTime(r.delivered_at)}` : ''}</p>
          {(r.status_note || r.result_summary) && <p className="break-words text-ink-2">{[r.status_note, r.result_summary].filter(Boolean).join(' — ')}</p>}</li>))}</ul>
    </details>
  );
}

/** 콘텐츠 캘린더 — 대표 10/20 16:10 (#105): 주 보기(기본) = 요일 7열 × 브랜드(또는 채널) 행, 칸에 썸네일·상태·게시 시각, 끌어서 날짜 이동·[옮기기] 상자(날짜·시각), 오늘 열 강조, 브랜드 필터, 휴대폰은 가로 스크롤. 월 보기는 전과 같음 */
type CalContent = Content & { kind?: string | null; brand_color?: string | null; media_info?: { id: string; mime: string }[] | null; is_test?: boolean };
const KST = 'Asia/Seoul';
const ymdK = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: KST }).format(d);
const hmK = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: KST, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const addDaysYmd = (ymd: string, n: number) => ymdK(new Date(Date.parse(`${ymd}T12:00:00+09:00`) + n * 864e5));
/** 그 주(일요일 시작)의 7일 */
const weekOf = (ymd: string) => { const dow = new Date(`${ymd}T12:00:00+09:00`).getUTCDay(); /* KST 정오 = UTC 03시, 같은 날 */ const start = addDaysYmd(ymd, -dow); return Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i)); };
const STATUS_TONE: Record<string, string> = { pending: 'bg-orange-50 text-orange-800', approved: 'bg-emerald-50 text-emerald-800', changes: 'bg-red-50 text-red-700', hold: 'bg-slate-100 text-ink-2', published: 'bg-blue-50 text-blue-800', draft: 'bg-slate-50 text-ink-3' };
export function ContentCalendar() {
  const today = ymdK(new Date());
  const [view, setView] = useState<'week' | 'month'>(() => { try { return localStorage.getItem('mkt-cal-view') === 'month' ? 'month' : 'week'; } catch { return 'week'; } });
  const [axis, setAxis] = useState<'brand' | 'channel'>(() => { try { return localStorage.getItem('mkt-cal-axis') === 'channel' ? 'channel' : 'brand'; } catch { return 'brand'; } });
  const [anchor, setAnchor] = useState(today); // 주 보기 기준 날짜
  const [month, setMonth] = useState(today.slice(0, 7));
  const [brand, setBrand] = useState('');
  const [open, setOpen] = useState<string | null>(null); const [nw, setNw] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; date: string; time: string } | null>(null); const [dragOver, setDragOver] = useState<string | null>(null);
  useEffect(() => { try { localStorage.setItem('mkt-cal-view', view); localStorage.setItem('mkt-cal-axis', axis); } catch { /* 저장 못 해도 됨 */ } }, [view, axis]);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const week = weekOf(anchor);
  const range = view === 'week' ? [week[0], week[6]] : [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
  const { data, error, reload } = useApi<{ contents: CalContent[] }>(`/api/marketing/contents?from=${range[0]}&to=${range[1]}`, [range[0], range[1]]);
  const brands = useApi<{ brands: { id: string; name: string; color: string }[] }>('/api/marketing/brands');
  const sess = useSession(); const canEdit = sess.user.role === 'owner' || sess.user.role === 'admin';
  const all = (data?.contents ?? []).filter((c) => c.scheduled_at && (!brand || (brand === 'none' ? !c.brand : c.brand === brand)));
  const dayOf = (c: CalContent) => ymdK(new Date(c.scheduled_at!));
  const shift = (d: number) => { if (view === 'week') setAnchor(addDaysYmd(anchor, 7 * d)); else { const t = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(t.toISOString().slice(0, 7)); } };
  const goToday = () => { setAnchor(today); setMonth(today.slice(0, 7)); };
  async function move(id: string, date: string, time?: string) {
    const c = all.find((x) => x.id === id) ?? (data?.contents ?? []).find((x) => x.id === id); if (!c?.scheduled_at) return;
    if (c.status === 'published') return toast.error('게시된 콘텐츠는 옮길 수 없습니다');
    const hm = time ?? hmK(c.scheduled_at);
    try { await api(`/api/marketing/contents/${id}`, { method: 'PATCH', body: { scheduledAt: new Date(`${date}T${hm}:00+09:00`).toISOString() } }); toast.ok(`${date.slice(5).replace('-', '/')} ${hm} 로 옮겼습니다`); setMoving(null); reload(); }
    catch (e: any) { toast.error(e.message); }
  }
  // 행: 브랜드(등록된 브랜드 전부 + '브랜드 없음'이 있으면) 또는 채널(있는 채널만)
  const rows: { key: string; label: string; color: string }[] = axis === 'brand'
    ? [...(brands.data?.brands ?? []).filter((b) => !brand || b.name === brand).map((b) => ({ key: b.name, label: b.name, color: b.color })), ...(all.some((c) => !c.brand) && (!brand || brand === 'none') ? [{ key: '', label: '브랜드 없음', color: '#94A3B8' }] : [])]
    : Object.keys(CHANNELS).filter((k) => all.some((c) => c.channel === k)).map((k) => ({ key: k, label: CHANNELS[k], color: CH_COLOR[k] }));
  const inCell = (rk: string, d: string) => all.filter((c) => (axis === 'brand' ? (c.brand ?? '') === rk : c.channel === rk) && dayOf(c) === d).sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const brandOptions = [...new Set(all.map((c) => c.brand).filter(Boolean) as string[]), ...(brands.data?.brands ?? []).map((b) => b.name)].filter((v, i, a) => a.indexOf(v) === i);
  const byDay = (d: number) => all.filter((c) => dayOf(c) === `${month}-${String(d).padStart(2, '0')}`);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const label = view === 'week' ? `${week[0].slice(5).replace('-', '/')} ~ ${week[6].slice(5).replace('-', '/')}` : `${y}.${String(m).padStart(2, '0')}`;
  return (
    <div className="space-y-3" data-testid="mkt-calendar" data-view={view}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>콘텐츠 캘린더</h1>
        <span className="inline-flex overflow-hidden rounded-input border border-line text-xs">{(['week', 'month'] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={cx('px-2.5 py-1', view === v ? 'bg-violet-600 font-semibold text-white' : 'bg-white text-ink-2')} data-testid={`mkt-cal-view-${v}`}>{v === 'week' ? '주' : '월'}</button>)}</span>
        {view === 'week' && <span className="inline-flex overflow-hidden rounded-input border border-line text-xs">{(['brand', 'channel'] as const).map((v) => <button key={v} type="button" onClick={() => setAxis(v)} className={cx('px-2.5 py-1', axis === v ? 'bg-slate-700 font-semibold text-white' : 'bg-white text-ink-2')} data-testid={`mkt-cal-axis-${v}`}>{v === 'brand' ? '브랜드 행' : '채널 행'}</button>)}</span>}
        <select className={cx(inputCls, 'h-8 w-auto py-0 text-xs')} value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="브랜드" data-testid="mkt-cal-brand"><option value="">브랜드 전체</option>{brandOptions.map((b) => <option key={b} value={b}>{b}</option>)}<option value="none">브랜드 없음</option></select>
        <span className="ml-auto flex items-center gap-1"><Button size="sm" variant="secondary" onClick={() => shift(-1)} aria-label={view === 'week' ? '이전 주' : '이전 달'}>‹</Button><button type="button" onClick={goToday} className="min-w-24 text-center text-sm font-medium tabular-nums hover:underline" data-testid="mkt-cal-label" title="오늘로">{label}</button><Button size="sm" variant="secondary" onClick={() => shift(1)} aria-label={view === 'week' ? '다음 주' : '다음 달'}>›</Button></span>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : view === 'week' ? (
        <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card" data-testid="mkt-week">
          <div className="grid min-w-[880px] text-xs" style={{ gridTemplateColumns: '7rem repeat(7, minmax(0, 1fr))' }}>
            <div className="sticky left-0 z-10 border-b border-r border-line bg-slate-50 p-1.5 text-[11px] text-ink-3">{axis === 'brand' ? '브랜드' : '채널'}</div>
            {week.map((d, i) => <div key={d} className={cx('border-b border-line p-1.5 text-center', d === today ? 'bg-violet-50 font-semibold text-violet-800' : 'bg-slate-50 text-ink-2')} data-testid={`mkt-week-col-${d}`} data-today={d === today ? '1' : undefined}>{'일월화수목금토'[i]} <span className="tabular-nums">{Number(d.slice(8))}</span>{d === today && <span className="ml-1 rounded bg-violet-600 px-1 text-[10px] text-white">오늘</span>}</div>)}
            {rows.map((r) => (
              <Fragment key={r.key || '__none'}>
                <div className="sticky left-0 z-10 flex items-start gap-1.5 border-b border-r border-line bg-white p-1.5 font-medium" data-testid={`mkt-week-row-${r.key || 'none'}`}><i className="mt-1 inline-block size-2 shrink-0 rounded-full" style={{ background: r.color }} /><span className="truncate">{r.label}</span></div>
                {week.map((d) => { const items = inCell(r.key, d); const cell = `${r.key || 'none'}|${d}`;
                  return (
                    <div key={d} className={cx('min-h-16 border-b border-line p-1', d === today && 'bg-violet-50/40', dragOver === cell && 'bg-violet-100 ring-2 ring-inset ring-violet-400')} data-testid={`mkt-week-cell-${r.key || 'none'}-${d}`}
                      onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(cell); } }} onDragLeave={() => setDragOver((v) => (v === cell ? null : v))}
                      onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, d); }}
                      onDoubleClick={(e) => { if (e.target === e.currentTarget) setNw(d); }} title={canEdit ? '빈 곳 두 번 클릭 = 새 콘텐츠 · 카드를 끌어다 놓으면 날짜 이동' : undefined}>
                      {items.map((c) => { const thumb = (c.media_info ?? [])[0]; const mv = moving?.id === c.id;
                        return (
                          <div key={c.id} className={cx('relative mb-1 rounded-input border border-line bg-white p-1 shadow-sm', c.status === 'published' && 'opacity-70', canEdit && c.status !== 'published' && 'cursor-grab')} draggable={canEdit && c.status !== 'published'}
                            onDragStart={(e) => { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; }} data-testid="mkt-week-card" data-id={c.id} data-status={c.status}>
                            <button type="button" onClick={() => setOpen(c.id)} className="flex w-full items-start gap-1.5 text-left">
                              {thumb ? <MediaThumb src={`/api/library/${thumb.id}/download?inline=1`} mime={thumb.mime} className="size-10 shrink-0 rounded object-cover" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] text-ink-3">{c.media_count ? '시안' : '없음'}</span>}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-medium" title={c.title}>{c.is_test ? '[시험] ' : ''}{c.title}</span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px]"><span className="inline-block size-1.5 rounded-full" style={{ background: CH_COLOR[c.channel] }} /><span className={cx('rounded px-1', STATUS_TONE[c.status] ?? 'bg-slate-100')}>{STATUS[c.status] ?? c.status}</span></span>
                              </span>
                            </button>
                            {canEdit && c.status !== 'published'
                              ? <button type="button" onClick={() => setMoving(mv ? null : { id: c.id, date: dayOf(c), time: hmK(c.scheduled_at!) })} className="mt-0.5 text-[10px] tabular-nums text-violet-700 hover:underline" data-testid="mkt-card-move" title="날짜·시각 옮기기">{hmK(c.scheduled_at!)} ✎</button>
                              : <span className="mt-0.5 block text-[10px] tabular-nums text-ink-3">{hmK(c.scheduled_at!)}</span>}
                            {mv && moving && <div className="absolute left-0 top-full z-20 mt-0.5 flex w-56 flex-wrap items-center gap-1 rounded-input border border-line bg-white p-1.5 shadow-card" data-testid="mkt-move-box" onClick={(e) => e.stopPropagation()}>
                              <input type="date" className={cx(inputCls, 'h-7 flex-1 px-1 py-0 text-[11px]')} value={moving.date} onChange={(e) => setMoving({ ...moving, date: e.target.value })} aria-label="게시 날짜" data-testid="mkt-move-date" />
                              <input type="time" className={cx(inputCls, 'h-7 w-20 px-1 py-0 text-[11px]')} value={moving.time} onChange={(e) => setMoving({ ...moving, time: e.target.value })} aria-label="게시 시각" data-testid="mkt-move-time" />
                              <Button size="sm" onClick={() => move(c.id, moving.date, moving.time)} data-testid="mkt-move-save">옮기기</Button><Button size="sm" variant="secondary" onClick={() => setMoving(null)}>취소</Button>
                            </div>}
                          </div>);
                      })}
                    </div>);
                })}
              </Fragment>))}
            {!rows.length && <div className="col-span-8 p-6 text-center text-ink-3">이 주에 예정된 콘텐츠가 없습니다{canEdit ? ' — 빈 칸을 두 번 클릭하면 새 콘텐츠' : ''}</div>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-card border border-line bg-line text-xs">
          {'일월화수목금토'.split('').map((d) => <div key={d} className="bg-slate-50 py-1 text-center font-medium text-ink-2">{d}</div>)}
          {Array.from({ length: first }, (_, i) => <div key={`b${i}`} className="min-h-20 bg-white" />)}
          {Array.from({ length: last }, (_, i) => i + 1).map((d) => (
            <div key={d} className={cx('min-h-20 bg-white p-1', `${month}-${String(d).padStart(2, '0')}` === today && 'bg-violet-50/40')} data-testid={`mkt-day-${d}`}>
              <button type="button" className="text-[11px] text-ink-3 hover:underline" onClick={() => setNw(`${month}-${String(d).padStart(2, '0')}`)} aria-label={`${m}월 ${d}일 새 콘텐츠`}>{d}</button>
              {byDay(d).map((c) => <button key={c.id} type="button" onClick={() => setOpen(c.id)} className={cx('mt-0.5 block w-full truncate rounded px-1 text-left text-[11px] text-white', c.status === 'published' && 'opacity-60')} style={{ background: CH_COLOR[c.channel] }} title={`${c.title} · ${STATUS[c.status]}`}>{c.status === 'approved' ? '✓ ' : c.status === 'pending' ? '… ' : ''}{c.title}</button>)}
            </div>))}
        </div>
      )}
      <p className="flex flex-wrap gap-2 text-[11px] text-ink-2">{Object.entries(CHANNELS).map(([k, l]) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: CH_COLOR[k] }} />{l}</span>)}{view === 'week' ? <span>· 카드를 끌어다 놓으면 날짜 이동(관리자) · 시각 ✎ 로 날짜·시각 옮기기 · 게시된 글은 못 옮김</span> : <span>· ✓ 승인 · … 승인 대기</span>}</p>
      {open && <ContentDetail id={open} onClose={() => setOpen(null)} onChange={reload} />}
      {nw && <NewContent date={nw} onClose={() => setNw(null)} onDone={reload} />}
    </div>
  );
}

/** 전화 문의: 입력·제외·[영업 리드로](영업 담당 업무 카드) */
export function Calls() {
  const { data, error, reload } = useApi<{ adKeywords?: string[]; calls: { id: string; phone: string; called_at: string; source: string | null; status: string; memo: string | null; task_id: string | null; brand: string | null; ad_keyword?: string | null }[] }>('/api/marketing/calls');
  const [f, setF] = useState({ phone: '', source: '', memo: '', adKeyword: '' });
  async function add(e: React.FormEvent) { e.preventDefault(); try { await api('/api/marketing/calls', { body: { phone: f.phone, source: f.source || undefined, memo: f.memo || undefined, adKeyword: f.adKeyword.trim() || undefined } }); setF({ phone: '', source: '', memo: '', adKeyword: '' }); reload(); } catch (er: any) { toast.error(er.message); } }
  async function convert(id: string) { try { const r = await api<{ taskId: string }>(`/api/marketing/calls/${id}/convert`, { body: {} }); toast.ok('영업 업무로 만들었습니다'); reload(); return r; } catch (e: any) { toast.error(e.message); } }
  async function exclude(id: string, status: string) { try { await api(`/api/marketing/calls/${id}`, { method: 'PATCH', body: { status } }); reload(); } catch (e: any) { toast.error(e.message); } }
  return (
    <div className="space-y-3" data-testid="mkt-calls">
      <h1 className="text-xl font-bold" style={{ color: C }}>전화 문의</h1>
      <form onSubmit={add} className="grid gap-2 rounded-card border border-line bg-white p-3 shadow-card sm:grid-cols-[10rem_1fr_1fr_1fr_auto]">
        <input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="전화번호" required aria-label="전화번호" inputMode="tel" data-testid="call-phone" />
        <input className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="들어온 곳(광고·페이지)" aria-label="들어온 곳" />
        {/* 광고 최적화 1차 ③ "어떻게 알고 전화하셨어요?" → 광고 키워드별 전환당 비용에 들어감 */}
        <input className={inputCls} value={f.adKeyword} onChange={(e) => setF({ ...f, adKeyword: e.target.value })} placeholder="광고 키워드(알면)" aria-label="광고 키워드" list="call-ad-keywords" maxLength={60} data-testid="call-ad-keyword" />
        <datalist id="call-ad-keywords">{(data?.adKeywords ?? []).map((k) => <option key={k} value={k} />)}</datalist>
        <input className={inputCls} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" aria-label="메모" />
        <Button type="submit" data-testid="call-add">추가</Button>
      </form>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={3} /> : (
        <ul className="space-y-1.5">{data.calls.map((c) => (
          <li key={c.id} className={cx('flex flex-wrap items-center gap-2 rounded-card border border-line bg-white p-3 text-sm', c.status === 'excluded' && 'opacity-60')} data-testid="call-row">
            <span className="font-medium tabular-nums">{c.phone}</span><span className="text-xs text-ink-2">{fmtDateTime(c.called_at)}{c.source ? ` · ${c.source}` : ''}{c.ad_keyword ? ` · 광고: ${c.ad_keyword}` : ''}{c.memo ? ` · ${c.memo}` : ''}</span>
            <span className="ml-auto flex gap-1.5">
              {c.task_id ? <Link href={`/tasks/${c.task_id}`} className="text-xs underline" style={{ color: '#2563EB' }}>영업 업무 보기</Link>
                : c.status === 'excluded' ? <Button size="sm" variant="secondary" onClick={() => exclude(c.id, 'new')}>되살리기</Button>
                : <><Button size="sm" onClick={() => convert(c.id)} data-testid="call-convert">영업 리드로</Button><Button size="sm" variant="secondary" onClick={() => exclude(c.id, 'excluded')}>제외</Button></>}
            </span>
          </li>))}{!data.calls.length && <li className="text-sm text-ink-3">아직 전화 문의가 없습니다</li>}</ul>
      )}
    </div>
  );
}
