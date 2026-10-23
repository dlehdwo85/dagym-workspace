'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Star } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { putFile } from '@/components/upload';
import { uploadToLibrary } from '@/components/libraryUpload';
import { extractAudioWav } from '@/components/videoDigest';
import { ScoreChip } from './QualityPanel';

/**
 * #499-6 경쟁 광고 보관함(운영실): 링크 붙이기·영상/이미지 올리기(수집 없음) → 영상 음성 받아쓰기 → 첫 문장 훅 유형
 * → ★ 참고·[AI 분석](한 편 뼈대) → 2~12개 골라 [공통 구조 분석] → 공통점·공통 구조·우리 대본 3안(광고형 점수 → 제작의뢰실로)
 */
type HookType = 'question' | 'price' | 'skit' | 'compare' | 'number' | 'empathy' | 'other';
type Ref = { id: string; brand_id: string | null; brand_name: string | null; advertiser: string; url: string | null; platform: string; format: string; media_id: string | null; media_mime: string | null; media_title: string | null;
  started_on: string | null; days: number | null; variants: number | null; transcript: string | null; hook: string | null; hook_type: HookType | null; note: string | null; starred: boolean; stt_note: string | null;
  analysis: { beats: { part: string; text: string }[]; offer: string; cta: string; angle: string; why: string } | null; analyzed_at: string | null; created_by: string | null; created_by_name: string | null; created_at: string };
type Script = { title: string; hook: string; lines: string[]; cta: string; score: number; pass: boolean };
type Report = { id: string; kind: 'manual' | 'weekly'; week: string | null; brand_id: string | null; brand_name: string | null; product: string | null; source: 'ai' | 'template'; advertisers: string[]; created_at: string; created_by_name: string | null;
  result: { hookTypes: Partial<Record<HookType, number>>; facts: string[]; common: string[]; structure: string[]; scripts: Script[]; note?: string } };
type View = { items: Ref[]; reports: Report[]; brands: { id: string; name: string }[]; hookTypes: Record<HookType, string>; platforms: Record<string, string>; formats: Record<string, string>; longRunDays: number;
  canDecide: boolean; userId: string; aiEnabled: boolean; sttEnabled: boolean };
const HT_CLS: Record<HookType, string> = { question: 'bg-sky-50 text-sky-800', price: 'bg-amber-50 text-amber-800', skit: 'bg-fuchsia-50 text-fuchsia-800', compare: 'bg-violet-50 text-violet-800', number: 'bg-emerald-50 text-emerald-800', empathy: 'bg-rose-50 text-rose-800', other: 'bg-slate-100 text-ink-2' };
const studioHref = (s: Script, brandId: string | null) => `/s/marketing/automation?tab=studio&kind=reels&mode=ad&purpose=inquiry${brandId ? `&brand=${brandId}` : ''}&message=${encodeURIComponent([s.hook, ...s.lines, s.cta].join(' ').slice(0, 300))}`;

export function AdRefBox() {
  const { data, error, reload } = useApi<View>('/api/marketing/adrefs');
  const [form, setForm] = useState(false);
  const [filter, setFilter] = useState<HookType | 'all' | 'star'>('all');
  const [picked, setPicked] = useState<string[]>([]);
  const [rep, setRep] = useState({ brandId: '', product: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <section className="rounded-card border border-line bg-white p-3 shadow-card"><ErrorBox error={error} retry={reload} /></section>;
  const items = data?.items ?? [];
  const shown = items.filter((r) => (filter === 'all' ? true : filter === 'star' ? r.starred : (r.hook_type ?? 'other') === filter));
  const counts = items.reduce<Record<string, number>>((m, r) => ({ ...m, [r.hook_type ?? 'other']: (m[r.hook_type ?? 'other'] ?? 0) + 1 }), {});
  async function act(r: Ref, body: Record<string, unknown>, ok?: string) {
    setBusy(`${r.id}:${body.action}`);
    try { await api(`/api/marketing/adrefs/${r.id}`, { method: 'PATCH', body }); if (ok) toast.ok(ok); await reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function weeklyNow() {
    setBusy('weekly');
    try {
      const r = await api<{ created?: string; skipped?: string; n?: number; week: string }>('/api/marketing/adrefs/weekly', { body: {} });
      if (r.created) toast.ok(`주간 분석(${r.week})을 만들었습니다 — 광고 ${r.n}개`); else toast.ok(r.skipped === 'done' ? `이번 주(${r.week}) 분석은 이미 있습니다` : `지난 7일 새로 넣은 광고가 ${r.n ?? 0}개라 건너뜁니다(3개부터)`);
      await reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  async function report() {
    setBusy('report');
    try {
      const r = await api<{ source: string; result: Report['result'] }>('/api/marketing/adrefs/report', { body: { ids: picked, brandId: rep.brandId || null, product: rep.product.trim() || undefined } });
      toast.ok(r.source === 'ai' ? `공통 구조와 우리 대본 ${r.result.scripts.length}안을 만들었습니다` : 'AI 없이 숫자만 정리했습니다'); setPicked([]); await reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  return (
    <section id="adrefs" className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="adrefs">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">경쟁 광고 보관함 <span className="font-normal text-ink-2">링크·영상 → 대본·첫 문장 → 공통 구조</span></h2>
        {data?.canDecide && <Button size="sm" variant="secondary" className="ml-auto" onClick={weeklyNow} disabled={!!busy} data-testid="adref-weekly">{busy === 'weekly' ? '분석 중…' : '주간 분석 지금'}</Button>}
        <Button size="sm" className={data?.canDecide ? '' : 'ml-auto'} onClick={() => setForm(true)} disabled={!data} data-testid="adref-new">광고 넣기</Button></div>
      <p className="mt-1 text-xs text-ink-2">광고 라이브러리·게시물 링크를 붙이거나 영상을 올리면 대본을 받아 쓰고 첫 문장 유형(질문·가격·상황극·비교…)을 나눕니다. 워크인은 남의 사이트를 긁지 않습니다(링크는 사람이 붙이고 서버는 열어 보지 않음). 오래 돌린 광고·같은 업체가 여러 번 돌린 광고가 “팔리는 광고”일 가능성이 큽니다. 2개 이상 골라 [공통 구조 분석] → 우리 대본 3안. 월요일마다 지난주에 새로 넣은 광고가 3개 이상이면 자동으로 묶어 분석합니다.</p>
      {!data ? <Skeleton rows={2} /> : <>
        {items.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5" role="tablist">{([['all', `전체 ${items.length}`], ['star', `참고 ★ ${items.filter((r) => r.starred).length}`], ...(Object.keys(data.hookTypes) as HookType[]).filter((k) => counts[k]).map((k) => [k, `${data.hookTypes[k]} ${counts[k]}`])] as [string, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k as typeof filter)} className={cx('rounded-full border px-2.5 py-0.5 text-xs', filter === k ? 'border-violet-400 bg-violet-50 font-semibold text-violet-800' : 'border-line text-ink-2')} data-testid="adref-filter" data-type={k}>{l}</button>))}</div>}
        {!items.length && <p className="mt-2 rounded-input border border-dashed border-line p-4 text-center text-xs text-ink-3" data-testid="adref-empty">아직 넣은 광고가 없습니다 — [광고 넣기]로 광고 라이브러리 링크나 영상을 넣어 보세요</p>}
        <ul className="mt-2 divide-y divide-line">{shown.map((r) => {
          const ht = r.hook_type ?? 'other'; const long = (r.days ?? 0) >= data.longRunDays;
          return (
            <li key={r.id} className="py-2" data-testid="adref-item" data-id={r.id} data-hook-type={ht}>
              <div className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={picked.includes(r.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.id].slice(0, 12) : picked.filter((x) => x !== r.id))} aria-label={`${r.advertiser} 고르기`} data-testid="adref-pick" />
                <button type="button" onClick={() => act(r, { action: 'star', starred: !r.starred })} aria-label={r.starred ? '참고 표시 빼기' : '참고 표시'} aria-pressed={r.starred} className={cx('mt-0.5', r.starred ? 'text-amber-500' : 'text-ink-3')} data-testid="adref-star"><Star size={16} fill={r.starred ? 'currentColor' : 'none'} /></button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-sm font-semibold text-ink">{r.advertiser}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-ink-2">{data.platforms[r.platform] ?? r.platform} · {data.formats[r.format] ?? r.format}</span>
                    {r.days !== null && <span className={cx('rounded-full px-2 py-0.5', long ? 'bg-emerald-50 font-semibold text-emerald-800' : 'bg-slate-100 text-ink-2')} data-testid="adref-days">{r.days}일째{long ? ' · 오래 돌림' : ''}</span>}
                    {r.variants ? <span className={cx('rounded-full px-2 py-0.5', r.variants >= 3 ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-2')}>비슷한 소재 {r.variants}개</span> : null}
                    {r.brand_name && <span className="text-ink-3">우리: {r.brand_name}</span>}
                  </div>
                  <p className="mt-1 text-sm"><span className={cx('mr-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold', HT_CLS[ht])} data-testid="adref-hook-type">{data.hookTypes[ht]}</span><span data-testid="adref-hook">{r.hook ?? <span className="text-ink-3">첫 문장 없음 — 대본을 붙이거나 영상을 올려 주세요</span>}</span></p>
                  {r.stt_note && <p className="mt-0.5 text-[11px] text-amber-800" data-testid="adref-stt-note">{r.stt_note}</p>}
                  {r.analysis && <p className="mt-0.5 text-xs text-ink-2" data-testid="adref-beats">{r.analysis.beats.map((b) => `${b.part} ${b.text}`).join(' → ')}</p>}
                </div>
                <Button size="sm" variant="secondary" onClick={() => setOpen(open === r.id ? null : r.id)} data-testid="adref-open">{open === r.id ? '접기' : '자세히'}</Button>
              </div>
              {open === r.id && <div className="ml-8 mt-2 space-y-2 rounded-input bg-slate-50 p-2 text-xs" data-testid="adref-detail">
                {r.url && <p>링크: <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline" data-testid="adref-url">{r.url}</a></p>}
                {r.media_id && (r.media_mime?.startsWith('video/') ? <video src={`/api/library/${r.media_id}/download?inline=1`} controls playsInline preload="metadata" className="max-h-64 rounded-input bg-black" /> : <img src={`/api/library/${r.media_id}/download?inline=1`} alt={r.media_title ?? ''} className="max-h-64 rounded-input" />)}
                {r.started_on && <p>게재 시작 {r.started_on}</p>}
                {r.transcript && <div><div className="font-semibold">대본</div><p className="whitespace-pre-wrap" data-testid="adref-transcript">{r.transcript}</p></div>}
                {r.analysis && <div className="space-y-0.5"><div className="font-semibold">AI 분석</div><ol className="list-decimal pl-4">{r.analysis.beats.map((b, k) => <li key={k}><b>{b.part}</b> {b.text}</li>)}</ol>
                  {r.analysis.offer && <p>제안: {r.analysis.offer}</p>}{r.analysis.cta && <p>행동: {r.analysis.cta}</p>}{r.analysis.angle && <p>노리는 고객: {r.analysis.angle}</p>}{r.analysis.why && <p className="text-ink-2">{r.analysis.why}</p>}</div>}
                {r.note && <p>메모: {r.note}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={!data.aiEnabled || !!busy || !(r.transcript || r.hook || r.note)} onClick={() => act(r, { action: 'analyze' }, 'AI 가 뼈대를 뽑았습니다')} data-testid="adref-analyze">{busy === `${r.id}:analyze` ? '분석 중…' : r.analysis ? 'AI 다시 분석' : 'AI 분석'}</Button>
                  {(r.created_by === data.userId || data.canDecide) && <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => { if (confirm('보관함에서 뺄까요? (자료실에 올린 영상은 남습니다)')) act(r, { action: 'remove' }, '뺐습니다'); }} data-testid="adref-remove">빼기</Button>}
                  <span className="self-center text-ink-3">{r.created_by_name ?? ''} · {fmtDateTime(r.created_at)}</span>
                </div>
              </div>}
            </li>);
        })}</ul>
        {picked.length > 0 && <div className="sticky bottom-2 mt-2 flex flex-wrap items-end gap-2 rounded-input border border-violet-200 bg-violet-50 p-2 shadow-card" data-testid="adref-selected">
          <span className="self-center text-xs font-semibold text-violet-900">고른 광고 {picked.length}개</span>
          <Field label="우리 브랜드" className="min-w-[120px]"><select className={cx(inputCls, 'py-1')} value={rep.brandId} onChange={(e) => setRep({ ...rep, brandId: e.target.value })} data-testid="adref-report-brand"><option value="">브랜드 없음</option>{data.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="광고할 제품·서비스(선택)" className="min-w-0 flex-1"><input className={cx(inputCls, 'py-1')} value={rep.product} maxLength={120} onChange={(e) => setRep({ ...rep, product: e.target.value })} data-testid="adref-report-product" /></Field>
          <Button size="sm" disabled={picked.length < 2 || !!busy} onClick={report} data-testid="adref-report-go">{busy === 'report' ? '분석 중…' : '공통 구조 분석 → 우리 대본 3안'}</Button>
          <Button size="sm" variant="secondary" onClick={() => setPicked([])}>고르기 취소</Button>
        </div>}
        {data.reports.length > 0 && <div className="mt-3 space-y-2" data-testid="adref-reports">{data.reports.map((p, k) => <ReportCard key={p.id} p={p} view={data} open={k === 0} />)}</div>}
      </>}
      {form && data && <AdRefForm view={data} onClose={() => setForm(false)} onDone={() => { setForm(false); reload(); }} />}
    </section>
  );
}

function ReportCard({ p, view, open }: { p: Report; view: View; open: boolean }) {
  const r = p.result;
  return (
    <details open={open} className="rounded-input border border-line p-2" data-testid="adref-report" data-kind={p.kind} data-source={p.source}>
      <summary className="cursor-pointer text-sm font-semibold">{p.kind === 'weekly' ? `주간 분석 ${p.week ?? ''}` : '공통 구조 분석'} <span className="font-normal text-ink-2">· 광고 {p.advertisers.length}개{p.brand_name ? ` · 우리: ${p.brand_name}` : ''} · {fmtDateTime(p.created_at)}</span></summary>
      <div className="mt-2 space-y-2 text-xs">
        <div className="flex flex-wrap gap-1">{(Object.entries(r.hookTypes) as [HookType, number][]).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className={cx('rounded-full px-2 py-0.5', HT_CLS[k])}>{view.hookTypes[k]} {n}</span>)}</div>
        <ul className="list-disc pl-4 text-ink-2" data-testid="adref-report-facts">{r.facts.map((f) => <li key={f}>{f}</li>)}</ul>
        {r.note && <p className="text-amber-800">{r.note}</p>}
        {r.common.length > 0 && <div><div className="font-semibold">공통점</div><ul className="list-disc pl-4" data-testid="adref-report-common">{r.common.map((c) => <li key={c}>{c}</li>)}</ul></div>}
        {r.structure.length > 0 && <div><div className="font-semibold">공통 구조</div><ol className="list-decimal pl-4" data-testid="adref-report-structure">{r.structure.map((c) => <li key={c}>{c}</li>)}</ol></div>}
        {r.scripts.length > 0 && <div className="grid gap-2 md:grid-cols-3">{r.scripts.map((s, k) => (
          <div key={k} className="rounded-input border border-violet-100 bg-violet-50/40 p-2" data-testid="adref-script">
            <div className="flex items-center gap-1.5"><span className="font-semibold">{k + 1}안 {s.title}</span><ScoreChip label="광고형" score={s.score} pass={s.pass} /></div>
            <p className="mt-1 font-semibold text-ink">{s.hook}</p>
            <ul className="mt-0.5 space-y-0.5 text-ink-2">{s.lines.map((l, j) => <li key={j}>{l}</li>)}</ul>
            {s.cta && <p className="mt-0.5">→ {s.cta}</p>}
            <Link href={studioHref(s, p.brand_id)} className="mt-1 inline-block underline" style={{ color: '#7C3AED' }} data-testid="adref-script-studio">제작의뢰실로 →</Link>
          </div>))}</div>}
      </div>
    </details>
  );
}

/** 자료실(마케팅/경쟁 광고)에 올리기 — 자동 정리 생략 */
async function uploadMedia(file: File, onPct: (n: number) => void) {
  const r = await api<{ id: string; upload: any }>('/api/library', { body: { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folder: '마케팅/경쟁 광고', tags: ['경쟁 광고'], purpose: 'ai_attach', space: 'marketing' } });
  const { uploadId } = await putFile(r.upload, file, onPct);
  await api(`/api/library/${r.id}/complete`, { body: uploadId ? { uploadId } : {} });
  return r.id;
}
function AdRefForm({ view, onClose, onDone }: { view: View; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ brandId: view.brands.length === 1 ? view.brands[0].id : '', advertiser: '', url: '', format: 'video', startedOn: '', variants: '', transcript: '', hook: '', note: '' });
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState('');
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.advertiser.trim()) { toast.error('업체·페이지 이름을 적어 주세요'); return; }
    try {
      let mediaId: string | null = null; let audioFileId: string | undefined; let duration: number | undefined;
      if (file) {
        setStatus('파일 올리는 중…'); mediaId = await uploadMedia(file, (n) => setStatus(`파일 올리는 중… ${n}%`));
        if (/^video\//.test(file.type) && !f.transcript.trim() && view.sttEnabled) {
          setStatus('음성 뽑는 중…'); const wav = await extractAudioWav(file).catch(() => null);
          if (wav) { setStatus('음성 올리는 중…'); audioFileId = (await uploadToLibrary(new File([wav], `경쟁 광고 음성.wav`, { type: 'audio/wav' }), 'AI 요청 첨부', undefined, ['경쟁 광고 음성']))?.id; duration = Math.round((wav.size - 44) / 32000); }
        }
      }
      setStatus(audioFileId ? '받아쓰는 중…' : '넣는 중…');
      const r = await api<{ item: Ref; sttNote: string | null }>('/api/marketing/adrefs', { body: { brandId: f.brandId || null, advertiser: f.advertiser.trim(), url: f.url.trim() || undefined, format: f.format, startedOn: f.startedOn || null,
        variants: f.variants ? Number(f.variants) : null, transcript: f.transcript.trim() || undefined, hook: f.hook.trim() || undefined, note: f.note.trim() || undefined, mediaId, ...(audioFileId ? { audioFileId, duration } : {}) } });
      toast.ok(r.sttNote ? `넣었습니다 — ${r.sttNote}` : r.item.hook ? `넣었습니다 — 첫 문장: ${view.hookTypes[r.item.hook_type ?? 'other']}` : '넣었습니다');
      onDone();
    } catch (er: any) { toast.error(er.message); setStatus(''); }
  }
  return (
    <Modal open onClose={onClose} title="경쟁 광고 넣기">
      <form onSubmit={save} className="space-y-2" data-testid="adref-form">
        <p className="text-xs text-ink-2">광고 라이브러리(facebook.com/ads/library)에서 광고를 열고 링크·업체 이름·“게재 시작”을 옮겨 적어 주세요. 영상은 내려받아 올리면 음성을 받아 씁니다{view.sttEnabled ? '' : '(지금은 받아쓰기 미설정 — 대본을 직접 붙여 주세요)'}.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="업체·페이지 이름"><input className={inputCls} value={f.advertiser} maxLength={80} onChange={(e) => set({ advertiser: e.target.value })} data-testid="adref-advertiser" /></Field>
          <Field label="형식"><select className={inputCls} value={f.format} onChange={(e) => set({ format: e.target.value })} data-testid="adref-format">{Object.entries(view.formats).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <Field label="링크(선택)"><input className={inputCls} value={f.url} maxLength={500} onChange={(e) => set({ url: e.target.value })} placeholder="https://www.facebook.com/ads/library/?id=…" data-testid="adref-url-input" /></Field>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="게재 시작(선택)"><input type="date" className={inputCls} value={f.startedOn} onChange={(e) => set({ startedOn: e.target.value })} data-testid="adref-started" /></Field>
          <Field label="비슷한 소재 수(선택)"><input type="number" min={1} max={999} className={inputCls} value={f.variants} onChange={(e) => set({ variants: e.target.value })} data-testid="adref-variants" /></Field>
          <Field label="우리 브랜드(선택)"><select className={inputCls} value={f.brandId} onChange={(e) => set({ brandId: e.target.value })} data-testid="adref-brand"><option value="">브랜드 없음</option>{view.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        </div>
        <Field label="영상·이미지 파일(선택)"><input type="file" accept="video/*,image/*" className="block w-full text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="adref-file" /></Field>
        <Field label="대본(선택 — 붙이면 받아쓰기 없이)"><textarea className={inputCls} rows={3} maxLength={8000} value={f.transcript} onChange={(e) => set({ transcript: e.target.value })} data-testid="adref-transcript-input" /></Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="첫 문장(선택 — 비우면 대본 첫 문장)"><input className={inputCls} value={f.hook} maxLength={200} onChange={(e) => set({ hook: e.target.value })} data-testid="adref-hook-input" /></Field>
          <Field label="메모(선택)"><input className={inputCls} value={f.note} maxLength={500} onChange={(e) => set({ note: e.target.value })} data-testid="adref-note" /></Field>
        </div>
        <div className="flex items-center justify-end gap-2">{status && <span className="text-xs text-ink-2" data-testid="adref-status">{status}</span>}
          <Button type="button" variant="secondary" onClick={onClose}>닫기</Button><Button type="submit" disabled={!!status} data-testid="adref-save">보관함에 넣기</Button></div>
      </form>
    </Modal>
  );
}
