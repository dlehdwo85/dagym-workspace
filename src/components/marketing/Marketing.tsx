'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { PublishHelper } from './PublishHelper';
import { MediaPick } from './MediaPick';

const C = '#7C3AED';
export const CHANNELS: Record<string, string> = { instagram: '인스타그램', facebook: '페이스북', threads: '스레드', blog: '블로그', youtube: '유튜브', naver_place: '네이버 플레이스', other: '기타' };
const CH_COLOR: Record<string, string> = { instagram: '#DB2777', facebook: '#2563EB', threads: '#111827', blog: '#16A34A', youtube: '#DC2626', naver_place: '#059669', other: '#64748B' };
const STATUS: Record<string, string> = { pending: '승인 대기', approved: '승인됨', changes: '수정 요청', hold: '보류', published: '게시됨', draft: '초안' };
type Content = { id: string; title: string; channel: string; status: string; scheduled_at: string | null; current_version: number; approved_version: number | null; brand: string | null; body: string; media_count: number; created_by_name: string; deadline: string | null; published_url: string | null };

/** V41 4-2 마케팅 개요: 숫자 카드 4개 + 운영실(SSO) */
export function MarketingHome({ ssoHref }: { ssoHref: string }) {
  const { data } = useApi<{ pending: number; today: number; week: number; changes: number; calls: number }>('/api/marketing/overview');
  const cards: [string, number | undefined, string][] = [['승인 대기', data?.pending, '/s/marketing/approvals'], ['오늘 게시', data?.today, '/s/marketing/calendar'], ['이번 주 예약', data?.week, '/s/marketing/calendar'], ['새 전화 문의', data?.calls, '/s/marketing/calls']];
  return (
    <div className="mx-auto max-w-4xl space-y-4" data-testid="space-home-marketing">
      <h1 className="text-xl font-bold" style={{ color: C }}>워크인 · 마케팅</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{cards.map(([l, n, h]) => (
        <Link key={l} href={h} className="rounded-card border border-line bg-white p-4 shadow-card hover:border-violet-300" data-testid="mkt-card"><div className="text-xs text-ink-2">{l}</div><div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: C }}>{n ?? '—'}</div></Link>))}</div>
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <p className="text-sm text-ink-2">게시 실행(예약 업로드)은 아직 마케팅 운영실에서 합니다. 승인·캘린더·자동 제작·광고 성과·전화 문의는 워크인에서 바로 쓰세요.</p>
        <a href={ssoHref} target="_blank" rel="noopener" data-testid="marketing-open" className="mt-3 inline-block rounded-input px-4 py-2 text-sm font-medium text-white" style={{ background: C }}>마케팅 운영실 열기</a>
      </section>
    </div>
  );
}

function NewContent({ onClose, onDone, date }: { onClose: () => void; onDone: () => void; date?: string }) {
  const brands = useApi<{ brands: { id: string; name: string }[] }>('/api/marketing/brands');
  const [f, setF] = useState({ title: '', channel: 'instagram', brandId: '', date: date ?? '', time: '10:00', body: '' });
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
      await api('/api/marketing/contents', { body: { title: f.title, channel: f.channel, brandId: f.brandId || null, scheduledAt: f.date ? `${f.date}T${f.time}:00+09:00` : null, body: f.body, mediaIds: media.map((m) => m.id) } });
      toast.ok('승인 대기에 올렸습니다'); onDone(); onClose();
    } catch (er: any) { toast.error(er.message); }
  }
  return (
    <Modal open onClose={onClose} title="새 콘텐츠" wide>
      <form onSubmit={save} className="grid gap-3" data-testid="mkt-new">
        <Field label="제목"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={200} data-testid="mkt-title" /></Field>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="채널"><select className={inputCls} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} data-testid="mkt-channel">{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="브랜드"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">(없음)</option>{(brands.data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="게시일"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="mkt-date" /></Field>
          <Field label="시각"><input type="time" className={inputCls} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        </div>
        <Field label="본문·캡션"><textarea className={inputCls} rows={5} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} data-testid="mkt-body" /></Field>
        <div className="space-y-1.5" data-testid="mkt-ai">
          <Button type="button" size="sm" variant="secondary" onClick={draft} disabled={aiBusy} data-testid="mkt-ai-draft">{aiBusy ? 'AI 가 쓰는 중…' : 'AI 로 캡션 초안 3개'}</Button>
          {ai && <ul className="space-y-1.5">{ai.captions.map((c, n) => (
            <li key={n}><button type="button" className="w-full whitespace-pre-wrap rounded-input border border-violet-200 bg-violet-50/40 p-2 text-left text-xs hover:border-violet-400" data-testid="mkt-ai-pick"
              onClick={() => { setF({ ...f, body: ai.hashtags.length ? `${c}\n\n${ai.hashtags.map((h) => `#${h}`).join(' ')}` : c }); setAi(null); }}>{c}</button></li>))}
            <li className="text-[11px] text-ink-3">초안을 누르면 본문에 넣습니다(해시태그 포함). 사실·가격은 꼭 확인하세요.</li></ul>}
        </div>
        <Field label="시안(승인하려면 1개 이상)"><MediaPick value={media} onChange={setMedia} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" data-testid="mkt-save">승인 요청</Button></div>
      </form>
    </Modal>
  );
}

/** 콘텐츠 상세: 버전·시안·결정 기록 + (관리자) 승인·수정 요청·보류 + 수정본 올리기 + 게시 확인 */
function ContentDetail({ id, onClose, onChange }: { id: string; onClose: () => void; onChange: () => void }) {
  const { data, error, reload } = useApi<any>(`/api/marketing/contents/${id}`);
  const [comment, setComment] = useState(''); const [ver, setVer] = useState<{ body: string; media: { id: string; title: string }[]; note: string } | null>(null); const [url, setUrl] = useState('');
  if (error) return <Modal open onClose={onClose} title="콘텐츠"><ErrorBox error={error} retry={reload} /></Modal>;
  if (!data) return <Modal open onClose={onClose} title="콘텐츠"><Skeleton rows={4} /></Modal>;
  const c = data.content, v = data.versions[0];
  const titleOf = (mid: string) => data.media.find((m: any) => m.id === mid)?.title ?? '자료';
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
  async function publish() { try { await api(`/api/marketing/contents/${id}/publish`, { body: { url } }); toast.ok('게시 확인했습니다'); reload(); onChange(); } catch (e: any) { toast.error(e.message); } }
  return (
    <Modal open onClose={onClose} title={c.title} wide>
      <div className="space-y-3 text-sm" data-testid="mkt-detail">
        <p className="text-xs text-ink-2">{CHANNELS[c.channel]} · {c.brand ?? '브랜드 없음'} · {c.scheduled_at ? `게시 ${fmtDateTime(c.scheduled_at)}` : '게시일 미정'}{c.deadline && ` · 승인 마감 ${fmtDateTime(c.deadline)}`} · <b data-testid="mkt-status">{STATUS[c.status]}</b> · v{c.current_version}{c.approved_version && c.approved_version !== c.current_version ? ` (v${c.approved_version} 승인은 무효)` : ''}</p>
        {c.auto && c.quality?.issues?.length > 0 && <p className="rounded-input bg-amber-50 px-3 py-2 text-xs text-amber-800" data-testid="mkt-quality">품질 검사: {c.quality.issues.join(' · ')}</p>}
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
        {c.status === 'approved' && (
          <div className="flex gap-2"><input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="게시한 글 주소(https://…)" aria-label="게시 주소" /><Button onClick={publish} disabled={!url} data-testid="mkt-publish">게시 확인</Button></div>
        )}
        </>}
        {c.published_url && <p className="text-xs">게시됨: <a className="underline" href={c.published_url} target="_blank" rel="noopener">{c.published_url}</a></p>}
        {!!data.publishJobs?.length && <ul className="space-y-0.5 border-t border-line pt-2 text-xs text-ink-2" data-testid="mkt-publish-jobs">{data.publishJobs.map((j: any, i: number) => <li key={i}>게시 기록{j.is_test ? ' [시험]' : ''} v{j.version} · {({ naver_blog: '네이버 블로그(도우미)', manual: '직접 게시' } as any)[j.provider] ?? j.provider} · {({ done: '완료', queued: '대기', running: '진행 중', verify: '확인 중', failed: '실패', canceled: '취소' } as any)[j.status]} · {j.requested_by_name ?? ''} · {fmtDateTime(j.created_at)}</li>)}</ul>}
        {!!data.decisions.length && <ul className="space-y-0.5 border-t border-line pt-2 text-xs text-ink-2">{data.decisions.map((d: any, i: number) => <li key={i}>v{d.version} {({ approve: '승인', changes: '수정 요청', hold: '보류' } as any)[d.decision]} · {d.decided_by_name} · {fmtDateTime(d.decided_at)}{d.comment ? ` — ${d.comment}` : ''}</li>)}</ul>}
      </div>
    </Modal>
  );
}

/** 승인 대기(승인 대기·수정 요청·보류) */
export function Approvals() {
  const sp = useSearchParams();
  const [open, setOpen] = useState<string | null>(sp.get('c'));
  const [nw, setNw] = useState(sp.get('new') === '1'); // 앱 더보기 › 만들기 › 새 콘텐츠
  const { data, error, reload } = useApi<{ contents: Content[] }>('/api/marketing/contents?view=approvals');
  return (
    <div className="space-y-3" data-testid="mkt-approvals">
      <div className="flex items-center gap-2"><h1 className="text-xl font-bold" style={{ color: C }}>승인 대기</h1><Button className="ml-auto" onClick={() => setNw(true)} data-testid="mkt-new-open">새 콘텐츠</Button></div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={4} /> : !data.contents.length ? <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-ink-3">승인할 콘텐츠가 없습니다</p> : (
        <ul className="space-y-2">{data.contents.map((c) => (
          <li key={c.id}><button type="button" onClick={() => setOpen(c.id)} className="flex w-full items-center gap-3 rounded-card border border-line bg-white p-3 text-left shadow-card hover:border-violet-300" data-testid="mkt-row">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: CH_COLOR[c.channel] }} />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.title}</span><span className="block truncate text-xs text-ink-2">{CHANNELS[c.channel]} · {c.scheduled_at ? fmtDateTime(c.scheduled_at) : '게시일 미정'} · v{c.current_version}{!c.media_count && ' · 시안 없음'}</span></span>
            <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', c.status === 'pending' ? 'bg-violet-50 text-violet-800' : c.status === 'changes' ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-ink-2')}>{STATUS[c.status]}</span>
          </button></li>))}</ul>
      )}
      <OpsRequests />
      {open && <ContentDetail id={open} onClose={() => setOpen(null)} onChange={reload} />}
      {nw && <NewContent onClose={() => setNw(false)} onDone={reload} />}
    </div>
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

/** 콘텐츠 캘린더: 이번 달(앞뒤 이동) 날짜별, 채널 색 */
export function ContentCalendar() {
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7));
  const [open, setOpen] = useState<string | null>(null); const [nw, setNw] = useState<string | null>(null);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const { data, error, reload } = useApi<{ contents: Content[] }>(`/api/marketing/contents?from=${month}-01&to=${month}-${String(last).padStart(2, '0')}`, [month]);
  const shift = (d: number) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(t.toISOString().slice(0, 7)); };
  const byDay = (d: number) => (data?.contents ?? []).filter((c) => c.scheduled_at && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(c.scheduled_at)) === `${month}-${String(d).padStart(2, '0')}`);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return (
    <div className="space-y-3" data-testid="mkt-calendar">
      <div className="flex items-center gap-2"><h1 className="text-xl font-bold" style={{ color: C }}>콘텐츠 캘린더</h1>
        <span className="ml-auto flex items-center gap-1"><Button size="sm" variant="secondary" onClick={() => shift(-1)} aria-label="이전 달">‹</Button><span className="w-20 text-center text-sm font-medium tabular-nums">{y}.{String(m).padStart(2, '0')}</span><Button size="sm" variant="secondary" onClick={() => shift(1)} aria-label="다음 달">›</Button></span></div>
      {error ? <ErrorBox error={error} retry={reload} /> : (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-card border border-line bg-line text-xs">
          {'일월화수목금토'.split('').map((d) => <div key={d} className="bg-slate-50 py-1 text-center font-medium text-ink-2">{d}</div>)}
          {Array.from({ length: first }, (_, i) => <div key={`b${i}`} className="min-h-20 bg-white" />)}
          {Array.from({ length: last }, (_, i) => i + 1).map((d) => (
            <div key={d} className="min-h-20 bg-white p-1" data-testid={`mkt-day-${d}`}>
              <button type="button" className="text-[11px] text-ink-3 hover:underline" onClick={() => setNw(`${month}-${String(d).padStart(2, '0')}`)} aria-label={`${m}월 ${d}일 새 콘텐츠`}>{d}</button>
              {byDay(d).map((c) => <button key={c.id} type="button" onClick={() => setOpen(c.id)} className={cx('mt-0.5 block w-full truncate rounded px-1 text-left text-[11px] text-white', c.status === 'published' && 'opacity-60')} style={{ background: CH_COLOR[c.channel] }} title={`${c.title} · ${STATUS[c.status]}`}>{c.status === 'approved' ? '✓ ' : c.status === 'pending' ? '… ' : ''}{c.title}</button>)}
            </div>))}
        </div>
      )}
      <p className="flex flex-wrap gap-2 text-[11px] text-ink-2">{Object.entries(CHANNELS).map(([k, l]) => <span key={k} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: CH_COLOR[k] }} />{l}</span>)} · ✓ 승인 · … 승인 대기</p>
      {open && <ContentDetail id={open} onClose={() => setOpen(null)} onChange={reload} />}
      {nw && <NewContent date={nw} onClose={() => setNw(null)} onDone={reload} />}
    </div>
  );
}

/** 전화 문의: 입력·제외·[영업 리드로](영업 담당 업무 카드) */
export function Calls() {
  const { data, error, reload } = useApi<{ calls: { id: string; phone: string; called_at: string; source: string | null; status: string; memo: string | null; task_id: string | null; brand: string | null }[] }>('/api/marketing/calls');
  const [f, setF] = useState({ phone: '', source: '', memo: '' });
  async function add(e: React.FormEvent) { e.preventDefault(); try { await api('/api/marketing/calls', { body: { phone: f.phone, source: f.source || undefined, memo: f.memo || undefined } }); setF({ phone: '', source: '', memo: '' }); reload(); } catch (er: any) { toast.error(er.message); } }
  async function convert(id: string) { try { const r = await api<{ taskId: string }>(`/api/marketing/calls/${id}/convert`, { body: {} }); toast.ok('영업 업무로 만들었습니다'); reload(); return r; } catch (e: any) { toast.error(e.message); } }
  async function exclude(id: string, status: string) { try { await api(`/api/marketing/calls/${id}`, { method: 'PATCH', body: { status } }); reload(); } catch (e: any) { toast.error(e.message); } }
  return (
    <div className="space-y-3" data-testid="mkt-calls">
      <h1 className="text-xl font-bold" style={{ color: C }}>전화 문의</h1>
      <form onSubmit={add} className="grid gap-2 rounded-card border border-line bg-white p-3 shadow-card sm:grid-cols-[10rem_1fr_1fr_auto]">
        <input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="전화번호" required aria-label="전화번호" inputMode="tel" data-testid="call-phone" />
        <input className={inputCls} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="들어온 곳(광고·페이지)" aria-label="들어온 곳" />
        <input className={inputCls} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="메모" aria-label="메모" />
        <Button type="submit" data-testid="call-add">추가</Button>
      </form>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Skeleton rows={3} /> : (
        <ul className="space-y-1.5">{data.calls.map((c) => (
          <li key={c.id} className={cx('flex flex-wrap items-center gap-2 rounded-card border border-line bg-white p-3 text-sm', c.status === 'excluded' && 'opacity-60')} data-testid="call-row">
            <span className="font-medium tabular-nums">{c.phone}</span><span className="text-xs text-ink-2">{fmtDateTime(c.called_at)}{c.source ? ` · ${c.source}` : ''}{c.memo ? ` · ${c.memo}` : ''}</span>
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
