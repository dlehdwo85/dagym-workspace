'use client';
import { useState } from 'react';
import { useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, toast } from '@/components/ui';

const C = '#7C3AED';
type W = { from: string; to: string; visits: number | null; cta: number | null; posts: number; adCost: number; clicks: number; inquiries: number };
type Row = { brandId: string | null; name: string; color: string; sites: string[]; connected: boolean; weeks: W[] };
type Data = { weeks: { from: string; to: string }[]; rows: Row[]; summary: string[]; thisWeek: { from: string; to: string }; sites: string[]; beaconUrl: string; beaconKeys?: { site: string; name: string; key: string }[] };
/** 브라우저 쪽 한 줄: 방문 1번 + 전화 링크·data-cta 클릭. landing = 이 방문자가 처음 들어온 주소(광고 키워드별 전화 집계용, 서버는 키워드만 저장). text/plain 이라 다른 출처여도 사전 요청 없음 */
const browserCode = (url: string) => `<script>(function(){var u='${url}';var L;try{L=sessionStorage.getItem('wk_landing');if(!L){L=location.href;sessionStorage.setItem('wk_landing',L)}}catch(_){L=location.href}var s=function(e,l){try{navigator.sendBeacon(u,new Blob([JSON.stringify({event:e,label:l||'',path:location.pathname,landing:L})],{type:'text/plain'}))}catch(_){}};s('visit');document.addEventListener('click',function(ev){var a=ev.target.closest&&ev.target.closest('a[href^="tel:"],a[data-cta],button[data-cta]');if(a)s('cta',a.getAttribute('data-cta')||'전화')});})();</script>`;
/** 사이트 서버 쪽(Next.js 예시): 연동 토큰은 서버 환경변수에만 — 브라우저 코드에 넣지 않음 */
const serverCode = (beaconUrl: string) => `// app/api/workin-event/route.ts (브랜드 사이트 서버) — 토큰은 환경변수 WORKIN_INQUIRY_TOKEN 에만
export async function POST(req: Request) {
  const r = await fetch('${beaconUrl}', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: \`Bearer \${process.env.WORKIN_INQUIRY_TOKEN}\` },
    body: (await req.text()).slice(0, 4000) });
  return new Response(null, { status: r.ok ? 204 : 502 });
}`;
async function copy(text: string) { try { await navigator.clipboard.writeText(text); toast.ok('복사했습니다'); } catch { toast.error('복사하지 못했습니다'); } }
const won = (v: number) => (v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원` : `${v.toLocaleString('ko-KR')}원`);
const md = (d: string) => d.slice(5).replace('-', '/');

/** 대표 10/20 14:10 ①: 사이트별 운영 집계 — 브랜드(사이트) × 주: 방문·CTA·게시·광고·문의, 이번 주 요약(주간 보고에 붙여 넣기) */
export function Sites() {
  const [weeks, setWeeks] = useState(4);
  const { data, error, reload } = useApi<Data>(`/api/marketing/sites?weeks=${weeks}`, [weeks]);
  const [snippet, setSnippet] = useState(false);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={4} />;
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
        <summary className="cursor-pointer font-medium">방문·CTA 집계 심기(브랜드 사이트)</summary>
        <p className="mt-1 text-xs text-red-700" data-testid="sites-token-warn"><b>연동 토큰은 브라우저 코드(스크립트·HTML)에 넣지 마세요</b> — 문의 등록도 되는 비밀값이라, 공개 페이지에 있으면 누구나 그 사이트 이름으로 가짜 문의를 넣을 수 있습니다. 이미 넣었다면 플랫폼 운영 › 문의 연동에서 토큰을 새로 발급해 바꿔 주세요.</p>
        <p className="mt-1 text-xs text-ink-2">전화 링크(<code>tel:</code>)와 <code>data-cta=&quot;문의폼&quot;</code> 를 붙인 버튼 클릭이 CTA 로 잡힙니다. 보내는 것은 경로·종류와 처음 들어온 주소(광고 키워드별 전화 집계용 — 워크인은 키워드만 저장)뿐이고 개인정보는 보내지 않습니다.</p>
        <h3 className="mt-3 text-xs font-semibold">① 권장 — 사이트 서버를 거쳐 보내기(토큰은 서버 환경변수에만)</h3>
        <pre className="mt-1 overflow-x-auto rounded-input bg-slate-50 p-2 text-[11px]" data-testid="sites-server-code">{serverCode(data.beaconUrl)}</pre>
        <p className="mt-1 text-xs text-ink-2">브라우저(공통 템플릿·푸터)에는 자기 사이트 주소로 보내는 한 줄만 넣습니다:</p>
        <pre className="mt-1 overflow-x-auto rounded-input bg-slate-50 p-2 text-[11px]" data-testid="sites-relay-code">{browserCode('/api/workin-event')}</pre>
        <div className="mt-1 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => copy(serverCode(data.beaconUrl))}>서버 코드 복사</Button><Button size="sm" variant="secondary" onClick={() => copy(browserCode('/api/workin-event'))}>브라우저 한 줄 복사</Button></div>
        <h3 className="mt-3 text-xs font-semibold">② 서버가 없는 사이트 — 공개 키(방문·CTA 만 셈, 문의 등록은 안 됨)</h3>
        {(data.beaconKeys ?? []).length ? <ul className="mt-1 space-y-2" data-testid="sites-public-keys">{(data.beaconKeys ?? []).map((k) => (
          <li key={k.key}><p className="text-xs text-ink-2">{k.site}{k.name ? ` · ${k.name}` : ''}</p>
            <pre className="mt-0.5 overflow-x-auto rounded-input bg-slate-50 p-2 text-[11px]" data-testid="sites-public-code">{browserCode(`${data.beaconUrl}?pk=${k.key}`)}</pre>
            <Button size="sm" variant="secondary" className="mt-1" onClick={() => copy(browserCode(`${data.beaconUrl}?pk=${k.key}`))}>이 사이트 한 줄 복사</Button></li>))}</ul>
          : <p className="mt-1 text-xs text-ink-3">문의 연동 토큰이 아직 없습니다 — 플랫폼 운영 › 문의 연동에서 사이트별로 발급하면 공개 키가 여기에 나옵니다.</p>}
      </details>
    </div>
  );
}
