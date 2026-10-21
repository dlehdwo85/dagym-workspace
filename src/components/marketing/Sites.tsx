'use client';
import { useState } from 'react';
import { useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, toast } from '@/components/ui';

const C = '#7C3AED';
type W = { from: string; to: string; visits: number | null; cta: number | null; posts: number; adCost: number; clicks: number; inquiries: number };
type Row = { brandId: string | null; name: string; color: string; sites: string[]; connected: boolean; weeks: W[] };
type Data = { weeks: { from: string; to: string }[]; rows: Row[]; summary: string[]; thisWeek: { from: string; to: string }; sites: string[]; beaconUrl: string };
const won = (v: number) => (v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원` : `${v.toLocaleString('ko-KR')}원`);
const md = (d: string) => d.slice(5).replace('-', '/');

/** 대표 10/20 14:10 ①: 사이트별 운영 집계 — 브랜드(사이트) × 주: 방문·CTA·게시·광고·문의, 이번 주 요약(주간 보고에 붙여 넣기) */
export function Sites() {
  const [weeks, setWeeks] = useState(4);
  const { data, error, reload } = useApi<Data>(`/api/marketing/sites?weeks=${weeks}`, [weeks]);
  const [snippet, setSnippet] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
  const code = `<script>(function(){var u='${data.beaconUrl}?k=연동토큰';var s=function(e,l){try{navigator.sendBeacon(u,new Blob([JSON.stringify({event:e,label:l||'',path:location.pathname})],{type:'application/json'}))}catch(_){}};s('visit');document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('a[href^="tel:"],a[data-cta],button[data-cta]');if(a)s('cta',a.getAttribute('data-cta')||'전화')});})();</script>`;
  return (
    <div className="space-y-4" data-testid="mkt-sites">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>사이트별 집계</h1>
        <span className="text-xs text-ink-2">브랜드(사이트)마다 주 단위 — 이번 주 {md(data.thisWeek.from)}~{md(data.thisWeek.to)}</span>
        <span className="ml-auto flex gap-1">{[4, 8, 12].map((w) => <Button key={w} size="sm" variant={weeks === w ? 'primary' : 'secondary'} onClick={() => setWeeks(w)}>{w}주</Button>)}</span>
      </div>
      <section className="rounded-card border border-violet-200 bg-violet-50/40 p-3 shadow-card" data-testid="sites-summary">
        <div className="mb-1 flex items-center gap-2"><h2 className="text-sm font-semibold">이번 주 요약 <span className="text-xs font-normal text-ink-3">(주간 보고용)</span></h2>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={async () => { try { await navigator.clipboard.writeText(data.summary.join('\n')); toast.ok('복사했습니다'); } catch { toast.error('복사하지 못했습니다'); } }} data-testid="sites-copy">복사</Button></div>
        <ul className="space-y-0.5 text-sm">{data.summary.map((s, i) => <li key={i}>{s}</li>)}{!data.summary.length && <li className="text-ink-3">브랜드가 없습니다 — 마케팅 설정에서 브랜드를 만들어 주세요.</li>}</ul>
      </section>
      <section className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
        <table className="w-full min-w-[760px] text-sm" data-testid="sites-table"><thead className="bg-slate-50 text-xs text-ink-2"><tr><th className="p-2 text-left">브랜드 · 주</th><th className="p-2 text-right">방문</th><th className="p-2 text-right">CTA</th><th className="p-2 text-right">게시</th><th className="p-2 text-right">광고비</th><th className="p-2 text-right">광고 클릭</th><th className="p-2 text-right">문의</th></tr></thead>
          <tbody>{data.rows.map((r) => (<>
            <tr key={r.name} className="border-t border-line bg-slate-50/60" data-testid="sites-brand"><td className="p-2 font-semibold" colSpan={7}><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: r.color }} />{r.name}
              <span className="ml-2 text-xs font-normal text-ink-3">{r.sites.length ? `사이트 ${r.sites.join(', ')}` : '사이트 없음'}{!r.connected && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-amber-800">방문·CTA 미연결</span>}</span></td></tr>
            {r.weeks.map((w, i) => (
              <tr key={`${r.name}-${w.from}`} className={cx('border-t border-line', i === 0 && 'font-medium')} data-testid="sites-week"><td className="p-2 pl-6 text-xs text-ink-2">{md(w.from)}~{md(w.to)}{i === 0 ? ' (이번 주)' : ''}</td>
                <td className="p-2 text-right tabular-nums">{w.visits ?? '—'}</td><td className="p-2 text-right tabular-nums">{w.cta ?? '—'}</td><td className="p-2 text-right tabular-nums">{w.posts}</td>
                <td className="p-2 text-right tabular-nums">{won(w.adCost)}</td><td className="p-2 text-right tabular-nums">{w.clicks}</td><td className="p-2 text-right tabular-nums">{w.inquiries}</td></tr>))}
          </>))}
            {!data.rows.length && <tr><td colSpan={7} className="p-6 text-center text-ink-3">브랜드가 없습니다</td></tr>}</tbody></table>
      </section>
      <details className="rounded-card border border-line bg-white p-3 text-sm shadow-card" open={snippet} onToggle={(e) => setSnippet((e.target as HTMLDetailsElement).open)} data-testid="sites-snippet">
        <summary className="cursor-pointer font-medium">방문·CTA 집계 심기(브랜드 사이트에 한 줄)</summary>
        <p className="mt-1 text-xs text-ink-2">사이트의 공통 템플릿(푸터)에 아래 한 줄을 넣습니다. <b>연동토큰</b> 자리에는 플랫폼 운영 › 문의 연동에서 발급한 그 사이트의 토큰을 넣습니다(문의 연동과 같은 토큰). 전화 링크(<code>tel:</code>)와 <code>data-cta=&quot;문의폼&quot;</code> 를 붙인 버튼 클릭이 CTA 로 잡힙니다. 개인정보는 보내지 않습니다(경로·종류만).</p>
        <pre className="mt-2 overflow-x-auto rounded-input bg-slate-50 p-2 text-[11px]">{code}</pre>
        <Button size="sm" variant="secondary" className="mt-2" onClick={async () => { try { await navigator.clipboard.writeText(code); toast.ok('복사했습니다'); } catch { toast.error('복사하지 못했습니다'); } }}>스크립트 복사</Button>
      </details>
    </div>
  );
}
