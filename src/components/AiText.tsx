'use client';
import { Fragment, type ReactNode } from 'react';
import { cx } from './ui';

/**
 * #497 R44 AI 답 서식(ChatGPT 처럼) — 제목(#)·굵게(**)·목록(- · 1.)·표(| |)·인용(>)·코드(``` · `)·링크([글](주소)·맨 주소)·구분선.
 * HTML 을 끼워 넣지 않고 글자를 React 요소로만 바꾼다. 링크는 http(s) 와 앱 안 주소(/…)만. 쓰는 중(스트리밍)에 덜 닫힌 표시는 글자 그대로.
 */
type Item = { text: string; depth: number; mark: string };
type Block = { k: 'h'; level: number; text: string } | { k: 'p'; lines: string[] } | { k: 'list'; ordered: boolean; items: Item[] }
  | { k: 'table'; head: string[]; rows: string[][] } | { k: 'quote'; lines: string[] } | { k: 'code'; text: string } | { k: 'hr' };

const LI = /^(\s*)([-*•]|\d{1,3}[.)])\s+(.*)$/;
const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const special = (l: string) => /^\s*(```|#{1,6}\s|>|\|)/.test(l) || LI.test(l);

function blocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*```/.test(l)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      i++; out.push({ k: 'code', text: body.join('\n') }); continue;
    }
    const h = l.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) { out.push({ k: 'h', level: h[1].length, text: h[2].replace(/\s+#+\s*$/, '') }); i++; continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push({ k: 'hr' }); i++; continue; }
    if (l.trim().startsWith('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(l); const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      out.push({ k: 'table', head, rows }); continue;
    }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) q.push(lines[i].replace(/^\s*>\s?/, ''));
      out.push({ k: 'quote', lines: q }); continue;
    }
    const li = l.match(LI);
    if (li) {
      const ordered = /\d/.test(li[2]); const items: Item[] = [];
      for (let m = li; i < lines.length && (m = lines[i].match(LI) as RegExpMatchArray) && (m[1].length > 0 || /\d/.test(m[2]) === ordered); i++)
        items.push({ text: m[3], depth: Math.min(3, Math.floor(m[1].length / 2)), mark: /\d/.test(m[2]) ? m[2].replace(')', '.') : '•' });
      out.push({ k: 'list', ordered, items }); continue;
    }
    const p: string[] = [l];
    for (i++; i < lines.length && lines[i].trim() && !special(lines[i]); i++) p.push(lines[i]);
    out.push({ k: 'p', lines: p });
  }
  return out;
}

const SAFE = (u: string) => /^https?:\/\//.test(u) || /^\/(?!\/)/.test(u);
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]*[^\s<>().,!?;:'"’”])/g;
function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0; let n = 0;
  for (const m of s.matchAll(INLINE)) {
    const t = m[0]; const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    if (m[1]) out.push(<code key={n++} className="rounded bg-slate-200/70 px-1 font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={n++} className="font-semibold">{inline(t.slice(2, -2))}</strong>);
    else if (m[3]) {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/) ?? [];
      out.push(href && SAFE(href) ? <a key={n++} href={href} className="text-brand-700 underline" {...(href.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}>{label}</a> : label ?? t);
    } else out.push(<a key={n++} href={t} target="_blank" rel="noopener noreferrer" className="break-all text-brand-700 underline">{t}</a>);
    last = at + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** tail: 마지막 문단 끝에 붙일 것(쓰는 중 커서) */
export function AiText({ text, tail, className }: { text: string; tail?: ReactNode; className?: string }) {
  const bs = blocks(text);
  const lastP = bs.length && bs[bs.length - 1].k === 'p' ? bs.length - 1 : -1;
  return (
    <div className={cx('space-y-1.5 whitespace-normal break-words', className)} data-testid="ai-text">
      {bs.map((b, i) => {
        switch (b.k) {
          case 'h': return b.level <= 2 ? <h3 key={i} className="pt-0.5 text-[15px] font-bold">{inline(b.text)}</h3> : <h4 key={i} className="pt-0.5 font-semibold">{inline(b.text)}</h4>;
          case 'p': return <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}{i === lastP && tail}</p>;
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul';
            return <L key={i} className="space-y-0.5">{b.items.map((it, j) => (
              <li key={j} className="flex gap-1.5" style={it.depth ? { paddingLeft: it.depth * 14 } : undefined}><span className={cx('shrink-0', it.mark === '•' ? 'text-ink-3' : 'tabular-nums text-ink-2')}>{it.mark}</span><span className="min-w-0">{inline(it.text)}</span></li>))}</L>;
          }
          case 'table': {
            const w = Math.max(b.head.length, ...b.rows.map((r) => r.length));
            const pad = (r: string[]) => [...r, ...Array(Math.max(0, w - r.length)).fill('')];
            return (
              <div key={i} className="overflow-x-auto"><table className="min-w-full border-collapse text-xs">
                <thead><tr>{pad(b.head).map((c, j) => <th key={j} className="border border-slate-300 bg-white/70 px-2 py-1 text-left font-semibold">{inline(c)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, j) => <tr key={j}>{pad(r).map((c, k) => <td key={k} className="border border-slate-300 px-2 py-1 align-top">{inline(c)}</td>)}</tr>)}</tbody>
              </table></div>);
          }
          case 'quote': return <blockquote key={i} className="border-l-2 border-slate-300 pl-2 text-ink-2">{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l)}</Fragment>)}</blockquote>;
          case 'code': return <pre key={i} className="overflow-x-auto rounded-input bg-slate-800 p-2 font-mono text-xs text-slate-100"><code>{b.text}</code></pre>;
          case 'hr': return <hr key={i} className="border-slate-300" />;
        }
      })}
      {lastP < 0 && tail}
    </div>
  );
}
