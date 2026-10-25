'use client';
import { useState } from 'react';
import { api } from '@/components/client';
import { Button, cx, inputCls, toast } from '@/components/ui';

/** 로컬 QA 10/24 ⑤·③ 브랜드 사실 카드 + 주제 풀.
 *  사실 카드: 원고는 여기 적힌 연락처·운영 시간·요금·숫자만 씀(없는 숫자는 안 씀). 연락처가 있으면 글 끝에 직접 붙고, 빠지거나 '이미지 참조'로 돌리거나 다른 브랜드 이름이 섞이면 올리기 전 검사가 막음.
 *  주제 풀: 한 줄에 하나 — 이 브랜드만의 주제를 돌아가며 씀(같은 날 묶음은 같은 주제, 다른 브랜드가 앞뒤 3일 안에 쓴 주제는 건너뜀). [AI로 주제 20개 제안] = 초안만(고쳐서 [저장]) */
/** #235 ⓐ 이번 달 소식(이벤트·사례·새 소식) — 기간 안에서 주제 풀보다 먼저 씀 */
export type News = { text: string; from?: string; to?: string };
export type Facts = { phone?: string; link?: string; website?: string; address?: string; hours?: string; prices?: string; numbers?: string; avoidNames?: string[]; aliases?: string[]; news?: News[] };
const LINES: ['phone' | 'link' | 'website' | 'address' | 'hours', string, number][] = [
  ['phone', '대표 전화(예: 02-000-0000)', 40], ['link', '상담·예약 링크(카카오 채널·예약 페이지)', 200], ['website', '홈페이지 주소', 200], ['address', '주소', 200], ['hours', '운영 시간', 200],
];
const POOL_MAX = 40;
const NEWS_MAX = 12;
const kstDay = (plus = 0) => new Date(Date.now() + 9 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);
const rows = (s: string) => [...new Set(s.split('\n').map((x) => [...x.trim()].slice(0, 120).join('')).filter(Boolean))];

export function BrandFacts({ brand, onSaved }: { brand: { id: string; name: string; facts?: Facts | null; topic_pool?: string[] | null }; onSaved: () => void }) {
  const init: Facts = brand.facts ?? {};
  const [f, setF] = useState<Facts>(init); const [avoid, setAvoid] = useState((init.avoidNames ?? []).join(', ')); const [aliases, setAliases] = useState((init.aliases ?? []).join(', '));
  const [topics, setTopics] = useState((brand.topic_pool ?? []).join('\n')); const [busy, setBusy] = useState(false);
  const [news, setNews] = useState<News[]>(init.news ?? []);
  const today = kstDay(); const liveNews = (init.news ?? []).filter((x) => !x.to || x.to >= today).length;
  const setRow = (k: number, patch: Partial<News>) => setNews(news.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const n = rows(topics).length; const contact = !!(init.phone || init.link || init.website);
  async function draft() {
    setBusy(true);
    try {
      const r = await api<{ topics: string[] }>(`/api/marketing/auto/brands/${brand.id}/topic-draft`, { body: {} });
      const next = rows([topics, ...r.topics].join('\n'));
      setTopics(next.join('\n')); toast.ok(`주제 ${next.length - n}개를 아래에 더했습니다 — 고치거나 지우고 [저장]을 누르세요`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try {
      const facts: Facts = { ...Object.fromEntries((['phone', 'link', 'website', 'address', 'hours', 'prices', 'numbers'] as const).map((k) => [k, (f[k] ?? '').trim()])), avoidNames: avoid.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20), aliases: aliases.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10),
        news: news.map((x) => ({ text: x.text.trim(), ...(x.from ? { from: x.from } : {}), ...(x.to ? { to: x.to } : {}) })).filter((x) => x.text).slice(0, NEWS_MAX) };
      await api(`/api/marketing/auto/brands/${brand.id}`, { method: 'PATCH', body: { facts, topicPool: rows(topics).slice(0, POOL_MAX) } });
      toast.ok('사실 카드·주제 풀을 저장했습니다(이번 달 소식 포함) — 다음 원고부터 씁니다'); onSaved();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const small = cx(inputCls, 'h-8 py-0 text-xs');
  return (
    <details className="rounded-input border border-line p-2 text-xs sm:col-span-4 sm:ml-[8.5rem]" data-testid={`brand-facts-${brand.name}`}>
      <summary className="cursor-pointer font-medium">사실 카드·소식·주제 풀 <span className="font-normal text-ink-3">· {contact ? '연락처 있음' : '연락처 없음'} · 주제 {brand.topic_pool?.length ?? 0}개 · 이번 달 소식 {liveNews}개</span></summary>
      <p className="mt-1 text-ink-3">원고는 여기 적힌 연락처·운영 시간·요금·숫자만 씁니다(없는 숫자는 쓰지 않음). 연락처가 있으면 글 끝에 직접 붙고, 빠지거나 &lsquo;이미지 참조&rsquo;로 돌리면 승인함에 올리기 전에 막습니다.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {LINES.map(([k, label, max]) => <input key={k} className={small} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={max} placeholder={label} aria-label={label} data-testid={`facts-${k}`} />)}
        <input className={small} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="섞으면 안 되는 이름(쉼표) — 다른 회사·옛 이름" aria-label="섞으면 안 되는 이름" data-testid="facts-avoid" />
        {/* 137차: 이 브랜드의 영문·다른 이름 — 다른 브랜드 글에 섞이면 올리기 전 검사가 막음(피드 머리줄 영문·홈페이지 주소 이름은 자동으로 함께) */}
        <input className={small} value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="이 브랜드의 다른 이름(쉼표) — 영문·약칭" aria-label="이 브랜드의 다른 이름" title="다른 브랜드 글에 이 이름이 섞이면 올리기 전 검사가 막습니다. 피드 머리줄의 영문 이름과 홈페이지 주소 이름은 따로 적지 않아도 함께 거릅니다." data-testid="facts-aliases" />
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <textarea className={cx(inputCls, 'min-h-14 text-xs')} value={f.prices ?? ''} onChange={(e) => setF({ ...f, prices: e.target.value })} maxLength={500} placeholder="요금·혜택 — 원고는 여기 적힌 것만 씀" aria-label="요금·혜택" data-testid="facts-prices" />
        <textarea className={cx(inputCls, 'min-h-14 text-xs')} value={f.numbers ?? ''} onChange={(e) => setF({ ...f, numbers: e.target.value })} maxLength={1000} placeholder="써도 되는 숫자와 근거(어디서 나온 숫자인지 함께)" aria-label="숫자·근거" data-testid="facts-numbers" />
      </div>
      <div className="mt-2" data-testid="facts-news">
        <div className="text-ink-3">이번 달 소식 — 이벤트·실제 사례·새 소식(최대 {NEWS_MAX}개). 기간 안에는 주제 풀보다 먼저 이 소식으로 글을 쓰고(같은 소식은 이틀까지, 같은 날 묶음은 같은 소식), 적힌 날짜·조건 그대로 씁니다. 끝나는 날을 비우면 30일 뒤로 저장합니다.</div>
        {news.map((x, k) => (
          <div key={k} className={cx('mt-1 flex flex-wrap items-center gap-1.5', x.to && x.to < today && 'opacity-50')} data-testid="facts-news-row">
            {/* inputCls 는 w-full 이라 폭은 감싼 칸으로 */}
            <span className="min-w-[12rem] flex-1"><input className={small} value={x.text} maxLength={200} onChange={(e) => setRow(k, { text: e.target.value })} placeholder="예: 할로윈 주간 — 회원과 함께 오는 친구 1회 무료" aria-label={`소식 ${k + 1}`} data-testid="facts-news-text" /></span>
            <span className="w-36 shrink-0"><input type="date" className={small} value={x.from ?? ''} onChange={(e) => setRow(k, { from: e.target.value || undefined })} aria-label={`소식 ${k + 1} 시작`} data-testid="facts-news-from" /></span>
            <span className="text-ink-3">~</span>
            <span className="w-36 shrink-0"><input type="date" className={small} value={x.to ?? ''} onChange={(e) => setRow(k, { to: e.target.value || undefined })} aria-label={`소식 ${k + 1} 끝`} data-testid="facts-news-to" /></span>
            {x.to && x.to < today && <span className="text-ink-3">지남</span>}
            <button type="button" className="text-ink-3 underline" onClick={() => setNews(news.filter((_, i) => i !== k))} data-testid="facts-news-remove">빼기</button>
          </div>))}
        {news.length < NEWS_MAX && <button type="button" className="mt-1 text-brand-700 underline" onClick={() => setNews([...news, { text: '', from: today, to: kstDay(30) }])} data-testid="facts-news-add">+ 소식 추가</button>}
      </div>
      <div className="mt-2">
        <div className="text-ink-3">주제 풀 — 한 줄에 하나(최대 {POOL_MAX}개). 이 브랜드만의 주제를 돌아가며 쓰고, 같은 날 묶음(피드·릴스·블로그…)은 같은 주제로 형식만 바꿉니다. 다른 브랜드가 앞뒤 3일 안에 쓴 주제는 건너뜁니다.</div>
        <textarea className={cx(inputCls, 'mt-1 min-h-28 text-xs')} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="한 줄에 주제 하나 — 누가·어떤 상황에서·무엇을 얻는지 보이게" aria-label="주제 풀" data-testid="facts-topics" />
        <div className={cx('mt-0.5', n > POOL_MAX ? 'text-amber-800' : 'text-ink-3')} data-testid="facts-topic-count">{n}개{n > POOL_MAX ? ` — 앞의 ${POOL_MAX}개만 저장됩니다` : ''}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={draft} disabled={busy} data-testid="facts-topic-draft">{busy ? '만드는 중…' : 'AI로 주제 20개 제안'}</Button><Button size="sm" onClick={save} disabled={busy} data-testid="facts-save">저장</Button></div>
    </details>
  );
}
