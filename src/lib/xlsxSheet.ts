/**
 * #1125 2단계(대표 위임 11/23 — ② 브라우저 안 변환): 엑셀(.xlsx) 표를 그리기 위한 가벼운 읽기.
 * 서버·외부로 보내지 않고 브라우저(또는 Node 18+)에서 zip 을 풀어 값·병합·열 너비·행 높이·굵게·정렬·채움·테두리만 읽는다.
 * 수식은 저장된 값(캐시)만, 테마 색·조건부 서식·그림은 읽지 않음(모양이 다르면 엑셀에서 PDF 로 저장해 올리도록 안내).
 * 다른 파일을 가져오지 않는 순수 모듈(시험에서 Node 로 바로 읽음).
 */
export type XStyle = { b?: boolean; i?: boolean; u?: boolean; sz?: number; color?: string; fill?: string; ha?: string; va?: string; wrap?: boolean; bt?: string; bb?: string; bl?: string; br?: string; fmt?: string; fmtId?: number };
export type XCell = { v: string; s: XStyle | null; rs: number; cs: number; covered?: boolean };
export type XSheet = { name: string; rows: number; cols: number; colW: number[]; rowH: number[]; cells: (XCell | null)[][]; landscape: boolean; margins: { l: number; r: number; t: number; b: number } };

const MAX_ROWS = 400, MAX_COLS = 60;
const dec = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e: string) => e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" : e[1] === 'x' || e[1] === 'X' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(Number(e.slice(1))));
const attrs = (s: string) => { const o: Record<string, string> = {}; for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) o[m[1].replace(/^\w+:/, (p) => (p === 'r:' ? 'r:' : ''))] = dec(m[2]); return o; };
const each = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, 'g'))].map((m) => ({ a: attrs(m[1]), body: m[2] ?? '' }));
const block = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] ?? '';
const texts = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => dec(m[1])).join('');

/** 'B12' → [11, 1] (0부터) */
export function cellRef(ref: string): [number, number] {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.replace(/\$/g, '')); if (!m) return [-1, -1];
  let c = 0; for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return [Number(m[2]) - 1, c - 1];
}

/** zip(중앙 디렉터리) 읽기 — 펼치기는 DecompressionStream('deflate-raw') */
async function unzip(buf: ArrayBuffer) {
  const u8 = new Uint8Array(buf); const d = new DataView(buf);
  let e = u8.length - 22; while (e >= 0 && d.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다');
  const n = d.getUint16(e + 10, true); let p = d.getUint32(e + 16, true);
  const files = new Map<string, { method: number; raw: Uint8Array }>();
  for (let i = 0; i < n && d.getUint32(p, true) === 0x02014b50; i++) {
    const method = d.getUint16(p + 10, true), size = d.getUint32(p + 20, true), nl = d.getUint16(p + 28, true), xl = d.getUint16(p + 30, true), cl = d.getUint16(p + 32, true), lho = d.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    const start = lho + 30 + d.getUint16(lho + 26, true) + d.getUint16(lho + 28, true);
    files.set(name, { method, raw: u8.subarray(start, start + size) });
    p += 46 + nl + xl + cl;
  }
  return async (name: string): Promise<string | null> => {
    const f = files.get(name.replace(/^\//, '')); if (!f) return null;
    if (f.method === 0) return new TextDecoder().decode(f.raw);
    const s = new Blob([f.raw as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(s).arrayBuffer());
  };
}

const BORDER: Record<string, string> = { thin: '1px solid', hair: '1px solid', medium: '2px solid', thick: '3px solid', double: '3px double', dashed: '1px dashed', dotted: '1px dotted', mediumDashed: '2px dashed', dashDot: '1px dashed', mediumDashDot: '2px dashed', dashDotDot: '1px dotted', slantDashDot: '2px dashed' };
const rgb = (a?: string) => (a && /^[0-9a-f]{8}$/i.test(a) ? `#${a.slice(2)}` : a && /^[0-9a-f]{6}$/i.test(a) ? `#${a}` : undefined);

function readStyles(xml: string): XStyle[] {
  const fmts = new Map(each(block(xml, 'numFmts'), 'numFmt').map((f) => [Number(f.a.numFmtId), f.a.formatCode]));
  const fonts = each(block(xml, 'fonts'), 'font').map(({ body }) => ({
    b: /<b(\s+val="(1|true)")?\s*\/>/.test(body), i: /<i(\s+val="(1|true)")?\s*\/>/.test(body), u: /<u\b/.test(body),
    sz: Number(body.match(/<sz val="([\d.]+)"/)?.[1]) || undefined, color: rgb(body.match(/<color rgb="(\w+)"/)?.[1]) }));
  const fills = each(block(xml, 'fills'), 'fill').map(({ body }) => (/patternType="solid"/.test(body) ? rgb(body.match(/<fgColor rgb="(\w+)"/)?.[1]) : undefined));
  const borders = each(block(xml, 'borders'), 'border').map(({ body }) => {
    const side = (k: string) => { const m = body.match(new RegExp(`<${k}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${k}>)`)); const st = m && attrs(m[1]).style; if (!st || !BORDER[st]) return undefined; return `${BORDER[st]} ${rgb(m![2]?.match(/<color rgb="(\w+)"/)?.[1]) ?? '#000'}`; };
    return { bt: side('top'), bb: side('bottom'), bl: side('left'), br: side('right') };
  });
  return each(block(xml, 'cellXfs'), 'xf').map(({ a, body }) => {
    const al = body.match(/<alignment\b([^>]*)\/?>/); const aa = al ? attrs(al[1]) : {};
    const fmtId = Number(a.numFmtId) || 0;
    return { ...fonts[Number(a.fontId) || 0], fill: fills[Number(a.fillId) || 0], ...borders[Number(a.borderId) || 0], ha: aa.horizontal, va: aa.vertical, wrap: aa.wrapText === '1' || aa.wrapText === 'true', fmtId, fmt: fmts.get(fmtId) };
  });
}

/** 숫자 표시: 날짜 서식은 날짜로, 천 단위 서식은 쉼표, 그 밖은 저장된 값 그대로 */
export function showNumber(v: string, s: XStyle | null): string {
  const n = Number(v); if (!Number.isFinite(n) || !s) return v;
  const f = s.fmt ?? ''; const id = s.fmtId ?? 0;
  if ((id >= 14 && id <= 22) || (id >= 176 && /[yd]/i.test(f) && !/\[h\]|h:mm/i.test(f) && /y|d/i.test(f))) {
    const t = new Date(Math.round((n - 25569) * 864e5)); if (Number.isNaN(t.getTime())) return v;
    return t.toISOString().slice(0, 10);
  }
  if (id === 3 || id === 4 || /#,##0/.test(f)) return n.toLocaleString('ko-KR', { maximumFractionDigits: id === 4 || /0\.0/.test(f) ? 2 : 0 });
  if (id === 9 || id === 10 || /%$/.test(f)) return `${Math.round(n * (id === 10 ? 10000 : 100)) / (id === 10 ? 100 : 1)}%`;
  return v;
}

export async function readXlsx(buf: ArrayBuffer): Promise<XSheet[]> {
  const get = await unzip(buf);
  const wb = await get('xl/workbook.xml'); if (!wb) throw new Error('엑셀(.xlsx) 파일이 아닙니다');
  const rels = new Map(each((await get('xl/_rels/workbook.xml.rels')) ?? '', 'Relationship').map((r) => [r.a.Id, r.a.Target]));
  const ss = each((await get('xl/sharedStrings.xml')) ?? '', 'si').map((x) => texts(x.body));
  const styles = readStyles((await get('xl/styles.xml')) ?? '');
  const out: XSheet[] = [];
  for (const sh of each(block(wb, 'sheets'), 'sheet')) {
    if (sh.a.state === 'hidden' || sh.a.state === 'veryHidden') continue;
    const target = rels.get(sh.a['r:id'] ?? sh.a.id ?? ''); if (!target) continue;
    const xml = await get(target.startsWith('/') ? target : `xl/${target.replace(/^\.\//, '')}`); if (!xml) continue;
    const fmtPr = attrs(xml.match(/<sheetFormatPr\b([^>]*)\/?>/)?.[1] ?? '');
    const defW = Number(fmtPr.defaultColWidth) || (Number(fmtPr.baseColWidth) ? Number(fmtPr.baseColWidth) + 0.71 : 8.43);
    const defH = Number(fmtPr.defaultRowHeight) || 15;
    const colW: number[] = []; const hiddenCol = new Set<number>();
    for (const c of each(block(xml, 'cols'), 'col')) for (let k = Number(c.a.min); k <= Math.min(Number(c.a.max), MAX_COLS); k++) { colW[k - 1] = Number(c.a.width) || defW; if (c.a.hidden === '1') hiddenCol.add(k - 1); }
    const grid = new Map<string, XCell>(); const rowH: number[] = []; let maxR = -1, maxC = -1;
    for (const row of each(block(xml, 'sheetData'), 'row')) {
      const r = Number(row.a.r) - 1; if (r < 0 || r >= MAX_ROWS) continue;
      rowH[r] = row.a.hidden === '1' ? 0 : Number(row.a.ht) || defH;
      for (const c of each(row.body, 'c')) {
        const [cr, cc] = cellRef(c.a.r ?? ''); if (cr < 0 || cc < 0 || cc >= MAX_COLS) continue;
        const s = c.a.s !== undefined ? styles[Number(c.a.s)] ?? null : null;
        const raw = c.body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
        let v = c.a.t === 's' ? ss[Number(raw)] ?? '' : c.a.t === 'inlineStr' ? texts(c.body) : c.a.t === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw !== undefined ? dec(raw) : '';
        if (!c.a.t || c.a.t === 'n') v = showNumber(v, s);
        const visible = v !== '' || !!(s && (s.fill || s.bt || s.bb || s.bl || s.br));
        if (!visible) continue;
        grid.set(`${cr}:${cc}`, { v, s, rs: 1, cs: 1 });
        maxR = Math.max(maxR, cr); maxC = Math.max(maxC, cc);
      }
    }
    for (const m of each(block(xml, 'mergeCells'), 'mergeCell')) {
      const [a, b] = (m.a.ref ?? '').split(':'); if (!a || !b) continue;
      const [r1, c1] = cellRef(a), [r2, c2] = cellRef(b); if (r1 < 0 || r2 >= MAX_ROWS || c2 >= MAX_COLS) continue;
      const head = grid.get(`${r1}:${c1}`) ?? { v: '', s: null, rs: 1, cs: 1 };
      head.rs = r2 - r1 + 1; head.cs = c2 - c1 + 1; grid.set(`${r1}:${c1}`, head);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) {
        const x = grid.get(`${r}:${c}`); // 병합 안쪽 칸의 테두리는 머리 칸에 모음
        if (x?.s && head.s !== x.s) head.s = { ...(head.s ?? {}), ...(r === r2 && x.s.bb ? { bb: x.s.bb } : {}), ...(c === c2 && x.s.br ? { br: x.s.br } : {}) };
        grid.set(`${r}:${c}`, { v: '', s: null, rs: 1, cs: 1, covered: true });
      }
      maxR = Math.max(maxR, r2); maxC = Math.max(maxC, c2);
    }
    if (maxR < 0) continue;
    const rows = maxR + 1, cols = maxC + 1;
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid.get(`${r}:${c}`) ?? null));
    const ps = attrs(xml.match(/<pageSetup\b([^>]*)\/?>/)?.[1] ?? ''); const pm = attrs(xml.match(/<pageMargins\b([^>]*)\/?>/)?.[1] ?? '');
    out.push({ name: sh.a.name ?? '', rows, cols, colW: Array.from({ length: cols }, (_, c) => (hiddenCol.has(c) ? 0 : colW[c] ?? defW)), rowH: Array.from({ length: rows }, (_, r) => rowH[r] ?? defH), cells,
      landscape: ps.orientation === 'landscape', margins: { l: Number(pm.left) || 0.7, r: Number(pm.right) || 0.7, t: Number(pm.top) || 0.75, b: Number(pm.bottom) || 0.75 } });
  }
  return out;
}
