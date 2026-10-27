'use client';
import { useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Globe2, Heart, MessageCircle, MoreHorizontal, Music2, Repeat2, Send, Share2, ThumbsDown, ThumbsUp } from 'lucide-react';
import { MediaFull, isVideoMime, mimeOf, posterFrom, type MediaInfo } from '@/components/MediaView';
import { cx } from '@/components/ui';

/**
 * #497 R06 '실제 게시되는 화면처럼'(대표 10/20 12:59·18:09 — "2장 옆으로 넘겨보려고 할 때 2번째 장 이미지가 안보여요").
 * 채널마다 실제 틀을 따른다(로고·브랜드 색은 쓰지 않고 배치·순서만): 인스타 피드(옆으로 넘기기·점·n/N·♡ 💬 ✈ 저장) · 릴스/쇼츠/스토리(세로 전체·오른쪽 아이콘 줄·아래 글·음악)
 * · 페이스북(글이 위·사진 격자 아래·좋아요/댓글/공유) · 스레드(옆으로 넘기는 사진·♡ 💬 ↻ ✈) · 블로그(제목·작성자·본문 사이 사진) · 유튜브(16:9·제목·채널·구독).
 * 프로필 사진 = 브랜드 키트 로고(없으면 브랜드 색 글자 원), 이름 = 연결한 게시 계정(인스타·스레드 @아이디, 페이스북 페이지 이름 — 없으면 브랜드 이름).
 */
export type PreviewProps = { channel: string; kind?: string | null; brand: string | null; handle?: string | null; logo?: string | null; color?: string | null; title: string; body: string; media: string[]; info?: MediaInfo[] };

const src = (id: string) => `/api/library/${id}/download?inline=1`;
const okColor = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : '#64748B');
/** 연결 계정 이름에서 @아이디만(없으면 그대로), 그것도 없으면 브랜드 이름 */
export const handleOf = (label: string | null | undefined, brand: string | null) => label?.match(/@([\w.]+)/)?.[1] ?? (label?.trim() || brand?.replace(/^\s*\[시험\]\s*/, '') || '브랜드');

function Avatar({ logo, color, name, size = 32, ring = false }: { logo?: string | null; color?: string | null; name: string; size?: number; ring?: boolean }) {
  const inner = logo
    ? <img src={src(logo)} alt="" className="size-full rounded-full bg-white object-contain" />
    : <span className="flex size-full items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: okColor(color) }}>{name.slice(0, 1)}</span>;
  return <span className={cx('inline-block shrink-0 rounded-full', ring && 'bg-gradient-to-tr from-amber-400 via-rose-500 to-fuchsia-600 p-[2px]')} style={{ width: size, height: size }} aria-hidden>{inner}</span>;
}
/** 앞에서 n글자(이모지가 반으로 잘리지 않게) */
const cut = (s: string, n: number) => { const a = Array.from(s); return a.length > n ? a.slice(0, Math.max(0, n)).join('').trimEnd() : s; };
/** 글 안 #해시태그·@멘션 색 + 접힌 글 끝에 '... 더 보기'(실제 앱처럼 글에 붙여서) — 앞 clamp 줄·한 줄 약 28자까지 */
function Rich({ text, clamp, lead, more, onMore, tag = 'text-sky-800' }: { text: string; clamp: number; lead?: string; more: boolean; onMore: () => void; tag?: string }) {
  const full = text.trim();
  const short = cut(full.split('\n').slice(0, clamp).join('\n').trimEnd(), clamp * 28 - (lead ? lead.length + 1 : 0));
  const long = short.length < full.length;
  const parts = (more || !long ? full : short).split(/([#@][^\s#@]+)/g);
  return (
    <div className="text-[13px] leading-snug">
      <p className="whitespace-pre-wrap break-words">
        {lead && <><b>{lead}</b>{' '}</>}{parts.map((p, i) => (/^[#@]/.test(p) ? <span key={i} className={tag}>{p}</span> : p))}
        {long && !more && <>{' '}<button type="button" onClick={onMore} className="text-ink-3" data-testid="mkt-preview-more">... 더 보기</button></>}
      </p>
      {long && more && <button type="button" onClick={onMore} className="text-[12px] text-ink-3" data-testid="mkt-preview-more">접기</button>}
    </div>
  );
}
function Empty({ className }: { className: string }) {
  return <div className={cx(className, 'flex items-center justify-center bg-slate-200 text-xs text-ink-2')}>시안 제작 중</div>;
}
/** 옆으로 넘기기(손가락·화살표) + 점 + n/N — 사진·영상 섞여도 됨.
 *  fit: 인스타처럼 첫 사진 비율을 모든 장에 씀(세로 4:5 ~ 가로 1.91:1 안으로), 재기 전·영상이면 aspect */
export function Slides({ media, info, aspect, fit = false, dots = 'below', counter = true, tid = 'mkt-preview' }: { media: string[]; info?: MediaInfo[]; aspect: string; fit?: boolean; dots?: 'below' | 'over' | 'none'; counter?: boolean; tid?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [ratio, setRatio] = useState<number | null>(null);
  const first = media[0];
  useEffect(() => {
    const img = fit ? ref.current?.children[0]?.querySelector('img') : null;
    if (!img) return;
    const read = () => { if (img.naturalWidth && img.naturalHeight) setRatio(Math.min(1.91, Math.max(0.8, img.naturalWidth / img.naturalHeight))); };
    if (img.complete) read(); else img.addEventListener('load', read, { once: true });
    return () => img.removeEventListener('load', read);
  }, [fit, first]);
  if (!media.length) return <Empty className={cx('w-full', aspect)} />;
  const go = (k: number) => { const el = ref.current; if (!el) return; const n = Math.max(0, Math.min(media.length - 1, k)); el.scrollTo({ left: n * el.clientWidth, behavior: 'smooth' }); setI(n); };
  const Dots = () => <div className={cx('flex justify-center gap-1', dots === 'over' ? 'absolute inset-x-0 bottom-2' : 'py-2')} data-testid={`${tid}-dots`}>
    {media.map((m, k) => <span key={m + k} className={cx('size-1.5 rounded-full', k === i ? (dots === 'over' ? 'bg-white' : 'bg-sky-500') : (dots === 'over' ? 'bg-white/50' : 'bg-slate-300'))} />)}</div>;
  return (
    <div>
      <div className="group relative">
        <div ref={ref} className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid={`${tid}-slides`} data-count={media.length}
          onScroll={(e) => { const el = e.currentTarget; const k = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (k !== i) setI(k); }}>
          {media.map((m, k) => (
            <div key={m + k} className={cx('w-full shrink-0 snap-center bg-black', !ratio && aspect)} style={ratio ? { aspectRatio: String(ratio) } : undefined} data-testid={`${tid}-slide`}>
              <MediaFull src={src(m)} mime={mimeOf(info, m)} poster={posterFrom(info, m) ? src(posterFrom(info, m)!) : null} className="size-full object-cover" alt={`${k + 1}번째`} lazy={!(k === 0 && isVideoMime(mimeOf(info, m)))} />
            </div>))}
        </div>
        {media.length > 1 && <>
          {counter && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white" data-testid={`${tid}-counter`}>{i + 1}/{media.length}</span>}
          {i > 0 && <button type="button" onClick={() => go(i - 1)} aria-label="이전 장" className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1 shadow" data-testid={`${tid}-prev`}><ChevronLeft className="size-4" /></button>}
          {i < media.length - 1 && <button type="button" onClick={() => go(i + 1)} aria-label="다음 장" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/85 p-1 shadow" data-testid={`${tid}-next`}><ChevronRight className="size-4" /></button>}
          {dots === 'over' && <Dots />}
        </>}
      </div>
      {media.length > 1 && dots === 'below' && <Dots />}
    </div>
  );
}

export function ChannelPreview(p: PreviewProps) {
  const [more, setMore] = useState(false);
  const name = handleOf(p.handle, p.brand);
  const vertical = p.kind === 'reels' || p.kind === 'shorts' || p.kind === 'story';
  const toggle = () => setMore(!more);
  const shell = (testKind: string, body: React.ReactNode, dark = false) => (
    <div className={cx('mx-auto w-full max-w-sm overflow-hidden rounded-card border text-sm shadow-card', dark ? 'border-slate-800 bg-black text-white' : 'border-line bg-white')} data-testid="mkt-preview" data-kind={testKind}>{body}</div>);

  // ── 세로(릴스·쇼츠·스토리): 9:16 전체, 오른쪽 아이콘 줄, 아래 아이디·글·음악
  if (vertical) {
    const yt = p.channel === 'youtube'; const story = p.kind === 'story';
    return shell(story ? 'story' : yt ? 'shorts' : 'reels', <div className="relative">
      <Slides media={p.media} info={p.info} aspect="aspect-[9/16] max-h-[560px]" dots="none" counter={false} />
      {story && <div className="pointer-events-none absolute inset-x-2 top-2 flex gap-1">{(p.media.length ? p.media : ['x']).map((m, k) => <span key={m + k} className={cx('h-0.5 flex-1 rounded-full', k === 0 ? 'bg-white' : 'bg-white/40')} />)}</div>}
      {story && <div className="pointer-events-none absolute left-2 top-4 flex items-center gap-1.5 text-xs"><Avatar logo={p.logo} color={p.color} name={name} size={26} /><b>{name}</b><span className="opacity-70">방금</span></div>}
      {!story && <div className="pointer-events-none absolute bottom-16 right-2 flex flex-col items-center gap-4 text-white drop-shadow" data-testid="mkt-preview-side">
        {yt ? <><ThumbsUp className="size-6" /><ThumbsDown className="size-6" /><MessageCircle className="size-6" /><Share2 className="size-6" /></> : <><Heart className="size-6" /><MessageCircle className="size-6" /><Send className="size-6" /><MoreHorizontal className="size-6" /></>}
      </div>}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pb-3 pt-10">
        {story ? <div className="rounded-full border border-white/60 px-3 py-1.5 text-xs opacity-80">메시지 보내기</div> : <>
          <div className="flex items-center gap-2 text-xs"><Avatar logo={p.logo} color={p.color} name={name} size={26} /><b>{name}</b>
            <span className={cx('rounded px-2 py-0.5 text-[11px] font-semibold', yt ? 'bg-white text-black' : 'border border-white/70')}>{yt ? '구독' : '팔로우'}</span></div>
          <div className="mt-1.5 max-w-[85%]"><Rich text={yt ? p.title : p.body} clamp={1} more={more} onMore={toggle} tag="font-semibold text-white" /></div>
          {!yt && <p className="mt-1 flex items-center gap-1 text-[11px] opacity-90"><Music2 className="size-3" />{name} · 오리지널 오디오</p>}
        </>}
      </div>
    </div>, true);
  }
  // ── 블로그: 제목·작성자·날짜 → 표지 → 문단 사이 사진(남은 사진은 끝에)
  if (p.channel === 'blog') {
    const paras = p.body.split(/\n{2,}/).filter(Boolean); const shown = more ? paras : paras.slice(0, 3); const rest = p.media.slice(1);
    return shell('blog', <div>
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] text-ink-3"><span className="font-semibold text-emerald-700">블로그</span><span>{name}의 블로그</span></div>
      <div className="space-y-3 px-4 py-4">
        <p className="text-[11px] text-emerald-700">마케팅</p>
        <h3 className="font-serif text-lg font-bold leading-snug">{p.title}</h3>
        <div className="flex items-center gap-2 border-b border-line pb-3 text-[11px] text-ink-3"><Avatar logo={p.logo} color={p.color} name={name} size={22} /><span className="font-medium text-ink-2">{name}</span><span>· 방금</span></div>
        {p.media[0] ? <MediaFull src={src(p.media[0])} mime={mimeOf(p.info, p.media[0])} className="w-full rounded-input object-cover" alt="표지" /> : <Empty className="aspect-video w-full rounded-input" />}
        {shown.map((t, k) => <div key={k} className="space-y-2"><p className="whitespace-pre-wrap text-[13px] leading-relaxed">{t}</p>
          {rest[k] && <MediaFull src={src(rest[k])} mime={mimeOf(p.info, rest[k])} className="w-full rounded-input object-cover" alt={`본문 사진 ${k + 1}`} lazy />}</div>)}
        {more && rest.slice(shown.length).map((m) => <MediaFull key={m} src={src(m)} mime={mimeOf(p.info, m)} className="w-full rounded-input object-cover" alt="" lazy />)}
        {paras.length > 3 && <button type="button" onClick={toggle} className="text-xs font-medium text-emerald-700" data-testid="mkt-preview-more">{more ? '접기' : `본문 더 보기(${paras.length - 3}문단)`}</button>}
        <div className="flex gap-4 border-t border-line pt-2 text-[11px] text-ink-3"><span className="flex items-center gap-1"><Heart className="size-3.5" />공감</span><span className="flex items-center gap-1"><MessageCircle className="size-3.5" />댓글</span></div>
      </div>
    </div>);
  }
  // ── 유튜브(가로 영상): 16:9 → 제목 → 채널·구독 → 설명
  if (p.channel === 'youtube') {
    return shell('youtube', <div>
      {p.media[0] ? <MediaFull src={src(p.media[0])} mime={mimeOf(p.info, p.media[0])} poster={posterFrom(p.info, p.media[0]) ? src(posterFrom(p.info, p.media[0])!) : null} className="aspect-video w-full bg-black object-cover" alt="영상" /> : <Empty className="aspect-video w-full" />}
      <div className="space-y-2 px-3 py-2.5">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.title}</h3>
        <p className="text-[11px] text-ink-3">조회수 0회 · 방금</p>
        <div className="flex items-center gap-2 text-xs"><Avatar logo={p.logo} color={p.color} name={name} size={28} /><b className="truncate">{name}</b><span className="ml-auto rounded-full bg-black px-3 py-1 text-[11px] font-semibold text-white">구독</span></div>
        <div className="flex gap-2 text-[11px]">{[[ThumbsUp, '좋아요'], [Share2, '공유'], [Bookmark, '저장']].map(([I, t]) => { const Ic = I as typeof ThumbsUp; return <span key={t as string} className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1"><Ic className="size-3.5" />{t as string}</span>; })}</div>
        <div className="rounded-input bg-slate-100 p-2"><Rich text={p.body} clamp={2} more={more} onMore={toggle} /></div>
      </div>
    </div>);
  }
  // ── 페이스북: 페이지 이름·시각·공개 → 글 → 사진(1장 전체 · 2장 나란히 · 3장 이상 큰 1 + 작은 2, +n) → 좋아요·댓글·공유
  if (p.channel === 'facebook') {
    const m = p.media; const extra = m.length - 3;
    const cell = (id: string, cls: string, k: number) => <div key={id + k} className={cx('relative overflow-hidden bg-black', cls)}><MediaFull src={src(id)} mime={mimeOf(p.info, id)} className="size-full object-cover" alt="" />
      {k === 2 && extra > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-2xl font-semibold text-white">+{extra}</span>}</div>;
    return shell('facebook', <div>
      <div className="flex items-center gap-2 px-3 py-2"><Avatar logo={p.logo} color={p.color} name={name} size={36} />
        <div className="min-w-0"><b className="block truncate text-[13px]">{name}</b><span className="flex items-center gap-1 text-[11px] text-ink-3">방금 · <Globe2 className="size-3" /></span></div>
        <MoreHorizontal className="ml-auto size-5 text-ink-3" /></div>
      <div className="px-3 pb-2"><Rich text={p.body} clamp={3} more={more} onMore={toggle} tag="text-sky-700" /></div>
      {!m.length ? <Empty className="aspect-square w-full" /> : m.length === 1 ? cell(m[0], 'max-h-[420px] w-full [&_img]:max-h-[420px]', 0)
        : m.length === 2 ? <div className="grid grid-cols-2 gap-0.5" data-testid="mkt-preview-grid">{m.map((id, k) => cell(id, 'aspect-square', k))}</div>
        : <div className="grid grid-cols-2 gap-0.5" data-testid="mkt-preview-grid">{cell(m[0], 'col-span-2 aspect-video', 0)}{cell(m[1], 'aspect-square', 1)}{cell(m[2], 'aspect-square', 2)}</div>}
      <div className="mx-3 flex justify-around border-t border-line py-1.5 text-[12px] font-medium text-ink-2">
        <span className="flex items-center gap-1"><ThumbsUp className="size-4" />좋아요</span><span className="flex items-center gap-1"><MessageCircle className="size-4" />댓글 달기</span><span className="flex items-center gap-1"><Share2 className="size-4" />공유하기</span></div>
    </div>);
  }
  // ── 스레드: 프로필 줄 → 글 → 옆으로 넘기는 사진 → ♡ 💬 ↻ ✈
  if (p.channel === 'threads') {
    return shell('threads', <div className="flex gap-2.5 px-3 py-3">
      <div className="flex flex-col items-center"><Avatar logo={p.logo} color={p.color} name={name} size={34} /><span className="mt-1 w-0.5 flex-1 rounded bg-slate-200" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px]"><b>{name}</b><span className="text-ink-3">방금</span><MoreHorizontal className="ml-auto size-4 text-ink-3" /></div>
        <div className="mt-0.5"><Rich text={p.body} clamp={6} more={more} onMore={toggle} tag="text-sky-700" /></div>
        {p.media.length > 0 && <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]" data-testid="mkt-preview-slides" data-count={p.media.length}>
          {p.media.map((m, k) => <div key={m + k} className={cx('shrink-0 overflow-hidden rounded-xl bg-black', p.media.length === 1 ? 'w-full' : 'w-[72%]')} data-testid="mkt-preview-slide"><MediaFull src={src(m)} mime={mimeOf(p.info, m)} className="aspect-[4/5] w-full object-cover" alt="" /></div>)}</div>}
        <div className="mt-2 flex gap-4 text-ink-2"><Heart className="size-[18px]" /><MessageCircle className="size-[18px]" /><Repeat2 className="size-[18px]" /><Send className="size-[18px]" /></div>
      </div>
    </div>);
  }
  // ── 인스타 피드(기본): 아이디 줄 → 4:5 사진 옆으로 넘기기·점·n/N → ♡ 💬 ✈ · 저장 → 아이디 + 글(더 보기)
  return shell('instagram', <div>
    <div className="flex items-center gap-2 px-3 py-2"><Avatar logo={p.logo} color={p.color} name={name} size={30} ring /><b className="truncate text-[13px]">{name}</b><MoreHorizontal className="ml-auto size-5" /></div>
    <Slides media={p.media} info={p.info} aspect="aspect-[4/5]" fit />
    <div className={cx('flex items-center gap-3.5 px-3', p.media.length > 1 ? 'pb-1' : 'py-2')} data-testid="mkt-preview-actions"><Heart className="size-6" /><MessageCircle className="size-6" /><Send className="size-6" /><Bookmark className="ml-auto size-6" /></div>
    <div className="px-3 pb-3"><Rich text={p.body} clamp={2} lead={name} more={more} onMore={toggle} tag="text-sky-800" /><p className="mt-1 text-[10px] uppercase text-ink-3">방금</p></div>
  </div>);
}
