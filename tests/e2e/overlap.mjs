// 대표 11/26 상시 규칙 '겹침 금지'(docs/DESIGN_SYSTEM.md): 글자·칩·단추·아이콘이 서로 겹쳐 그려지거나 칸 밖으로 넘쳐 그려지면 안 된다.
// findOverlaps(page) — 지금 화면에서 ① 글자끼리·글자와 아이콘/입력칸이 1px 넘게 겹침 ② 글자가 담긴 칸(조상 상자) 밖으로 가로로 넘침 을 찾는다.
// - 글자는 요소 상자가 아니라 실제 글자 상자(Range.getClientRects)로 본다 — 말줄임·스크롤로 잘린 부분은 잘린 만큼만(overflow 조상으로 자름)
// - 같은 층끼리만 비교: 떠 있는 것(fixed·sticky·absolute — 하단 탭·머리줄·배지·메뉴·창)은 자기 층 안에서만 · 의도된 겹침은 data-overlap-ok 안쪽을 뺌
// - 화면 밖(가로)·숨김(투명·visibility·sr-only·clip)·화면 읽기 전용 글자는 뺌
export async function findOverlaps(page, { maxReport = 30 } = {}) {
  return page.evaluate((maxReport) => {
    const vw = window.innerWidth;
    const csCache = new Map(); const cs = (el) => { let c = csCache.get(el); if (!c) { c = getComputedStyle(el); csCache.set(el, c); } return c; };
    const hidden = (el) => {
      // 닫힌 <details> 안·content-visibility 로 안 그려진 것·투명·visibility 숨김은 브라우저 판정 그대로(Chrome checkVisibility)
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return true;
      const d = el.closest('details:not([open])'); if (d && !el.closest('summary')) return true;
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
        const c = cs(a);
        if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.05) return true;
        if ((c.clip && c.clip !== 'auto') || (c.clipPath && c.clipPath !== 'none')) return true; // sr-only 등
        if (a.hasAttribute('data-overlap-ok') || a.getAttribute('aria-hidden') === 'true' && a.closest('[role="presentation"]')) return true;
      }
      return false;
    };
    const alpha = (col) => { const m = col && col.match(/rgba?\(([^)]+)\)/); if (!m) return col && col !== 'transparent' ? 1 : 0; const v = m[1].split(/[ ,/]+/).filter(Boolean); return v.length > 3 ? Number(v[3]) : 1; };
    const boxed = (c) => alpha(c.backgroundColor) > 0.05 || (c.backgroundImage && c.backgroundImage !== 'none') || (c.boxShadow && c.boxShadow !== 'none')
      || ['Top', 'Right', 'Bottom', 'Left'].some((k) => parseFloat(c[`border${k}Width`]) > 0 && c[`border${k}Style`] !== 'none' && alpha(c[`border${k}Color`]) > 0.05);
    const boxedX = (c) => alpha(c.backgroundColor) > 0.05 || (c.backgroundImage && c.backgroundImage !== 'none') || (c.boxShadow && c.boxShadow !== 'none')
      || ['Right', 'Left'].some((k) => parseFloat(c[`border${k}Width`]) > 0 && c[`border${k}Style`] !== 'none' && alpha(c[`border${k}Color`]) > 0.05);
    const layerOf = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const p = cs(a).position; if (p === 'fixed' || p === 'sticky' || p === 'absolute') return a; } return document.body; };
    /** overflow 가 visible 이 아닌 조상으로 잘라 실제로 보이는 부분(없으면 null) — 층(떠 있는 요소)까지만 */
    const clipped = (r, el, layer) => {
      let { left: x1, top: y1, right: x2, bottom: y2 } = r;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const c = cs(a);
        if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
          const b = a.getBoundingClientRect();
          if (c.overflowX !== 'visible') { x1 = Math.max(x1, b.left); x2 = Math.min(x2, b.right); }
          if (c.overflowY !== 'visible') { y1 = Math.max(y1, b.top); y2 = Math.min(y2, b.bottom); }
        }
        if (a === layer) break;
      }
      if (x2 - x1 < 0.5 || y2 - y1 < 0.5 || x2 < 0 || x1 > vw) return null;
      return { left: x1, top: y1, right: x2, bottom: y2 };
    };
    const label = (el) => {
      const tid = el.closest('[data-testid]')?.getAttribute('data-testid');
      const txt = (el.innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40);
      return `${tid ? `[${tid}] ` : ''}${txt}`;
    };
    const items = [];
    // ① 글자 상자
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|TITLE)$/.test(el.tagName) || hidden(el)) continue;
      const layer = layerOf(el); const range = document.createRange(); range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        const c = clipped(r, el, layer); if (!c) continue;
        items.push({ el, kind: 'text', r: c, layer });
      }
    }
    // ② 아이콘·그림·입력칸(글자와 겹치면 안 됨)
    for (const el of document.querySelectorAll('svg, img, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea')) {
      if (el.closest('svg') !== el && el.tagName.toLowerCase() !== 'svg' && el.closest('svg')) continue;
      if (hidden(el)) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      const layer = layerOf(el); const c = clipped(r, el.parentElement ?? el, layer); if (!c) continue;
      items.push({ el, kind: el.tagName.toLowerCase(), r: c, layer });
    }
    // ③ 작은 보이는 상자(칩·배지·알약·단추 — 배경·테두리가 있고 높이 64px 이하, 블록이면 폭 60% 미만): 남의 글자·아이콘 위로 덮으면 겹침
    for (const el of document.body.querySelectorAll('*')) {
      if (/^(svg|path|g|img|input|select|textarea|option|script|style|br|html|body)$/i.test(el.tagName) || el.closest('svg')) continue;
      const c = cs(el); if (c.display === 'none' || c.display === 'contents' || !boxed(c)) continue;
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.height > 64 || (r.width > vw * 0.6 && !c.display.startsWith('inline'))) continue; // 칩(inline 류)은 폭 제한 없이
      if (hidden(el)) continue;
      const layer = layerOf(el); const cr = clipped(r, el.parentElement ?? el, layer); if (!cr) continue;
      items.push({ el, kind: 'box', r: cr, layer });
    }
    const issues = []; const seen = new Set();
    const add = (type, a, b, ov) => {
      const key = `${type}|${label(a.el)}|${b ? label(b.el) : ''}`; if (seen.has(key)) return; seen.add(key);
      issues.push({ type, a: label(a.el), b: b ? label(b.el) : null, px: ov, at: [Math.round(a.r.left), Math.round(a.r.top)] });
    };
    // 겹침: 위아래로 정렬해 훑기(같은 층·서로 품지 않는 것끼리)
    const sorted = [...items].sort((p, q) => p.r.top - q.r.top);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]; if (b.r.top >= a.r.bottom - 1) break;
        if (a.layer !== b.layer) continue;
        // 비교하는 짝: 글자↔글자·아이콘·입력칸·상자 / 상자↔아이콘·그림(상자끼리·아이콘끼리는 안 봄 — 나란한 단추·아이콘 묶음)
        const kinds = [a.kind, b.kind].sort().join('+'); if (!(a.kind === 'text' || b.kind === 'text' || kinds === 'box+svg' || kinds === 'box+img')) continue;
        if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left); const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 1 && h > 1) add('겹침', a, b, [Math.round(w), Math.round(h)]);
      }
    }
    // 칸 밖 넘침: 글자가 층 안의 조상 상자 밖으로 가로 1px 넘게(inline 조상은 빼고, 스크롤 칸 안은 이미 잘림)
    for (const a of items) {
      if (a.kind !== 'text') continue;
      // 같은 층 안의 조상만(떠 있는 말풍선·메뉴는 자기 상자까지) — 글자를 직접 담은 요소부터
      for (let p = a.el; p && p !== document.body && a.layer.contains(p); p = p.parentElement) {
        const c = cs(p); if (c.display === 'inline' || c.display === 'contents' || !boxedX(c)) continue; // 좌우가 눈에 보이는 상자(배경·그림자·좌우 테두리)만 — 휴대폰 꽉 찬 폭(-mx)·윗줄 테두리만 있는 줄은 뺌
        const b = p.getBoundingClientRect(); if (b.width < 1) continue;
        const out = Math.max(b.left - a.r.left, a.r.right - b.right);
        if (out > 1) { add('칸 밖 넘침', a, { el: p }, [Math.round(out), 0]); break; }
      }
    }
    return { count: issues.length, issues: issues.slice(0, maxReport) };
  }, maxReport);
}

/** 사람이 읽을 한 줄 요약 */
export const overlapText = (res) => res.issues.map((x) => `${x.type}: ${x.a}${x.b ? ` ↔ ${x.b}` : ''} (${x.px.join('×')}px @${x.at.join(',')})`).join('\n');

// 대표 11/26 상시 규칙 '낱말 중간 줄바꿈 금지'(docs/DESIGN_SYSTEM.md): 여러 줄로 감긴 글자에서 줄이 낱말 가운데(앞뒤 모두 글자·숫자)에서 바뀌면 찾는다
// 예: 인사말 '오늘도 수고 많으셨습니다, 이동 / 재님' — 줄은 띄어쓰기·문장 부호에서만 바뀌어야 함. 칸보다 긴 한 낱말(주소 등)은 data-break-ok 로 뺀다
export async function findWordBreaks(page, { maxReport = 20 } = {}) {
  return page.evaluate((maxReport) => {
    const issues = []; const seen = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      const t = n.nodeValue; if (!t || t.trim().length < 2 || t.length > 400) continue;
      const el = n.parentElement; if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|TITLE|TEXTAREA)$/.test(el.tagName) || el.closest('[data-break-ok],[data-overlap-ok],svg')) continue;
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue;
      if (el.closest('details:not([open])') && !el.closest('summary')) continue;
      const all = document.createRange(); all.selectNodeContents(n);
      const lines = [...all.getClientRects()].filter((r) => r.width > 0.5);
      if (lines.length < 2 || new Set(lines.map((r) => Math.round(r.top))).size < 2) continue; // 한 줄이면 볼 것 없음
      let prev = null;
      for (let i = 0; i < t.length; i++) {
        if (/\s/.test(t[i])) { prev = null; continue; }
        const cr = document.createRange(); cr.setStart(n, i); cr.setEnd(n, i + 1); const b = cr.getBoundingClientRect();
        if (b.width < 0.5) continue;
        if (prev && b.top > prev.top + prev.height * 0.5 && /[\p{L}\p{N}]/u.test(t[i - 1] ?? '') && /[\p{L}\p{N}]/u.test(t[i])) {
          const tid = el.closest('[data-testid]')?.getAttribute('data-testid');
          const where = `${t.slice(Math.max(0, i - 8), i)} / ${t.slice(i, i + 8)}`.replace(/\s+/g, ' ');
          const key = `${tid}|${where}`; if (!seen.has(key)) { seen.add(key); issues.push({ type: '낱말 중간 줄바꿈', a: `${tid ? `[${tid}] ` : ''}${where}`, b: null, px: [0, 0], at: [Math.round(b.left), Math.round(b.top)] }); }
          break;
        }
        prev = b;
      }
    }
    return { count: issues.length, issues: issues.slice(0, maxReport) };
  }, maxReport);
}
