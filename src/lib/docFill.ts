import { unzip } from './textExtract';
import { zip } from './xlsx';

/**
 * V22-A 양식 채우기(코드 실행 없음 = 거의 무료): 원본 xlsx/docx 를 그대로 복사하고 바꿀 칸·문장만 수술식으로 고친다.
 * 서식·병합·로고 위치·인쇄 설정은 그대로. AI 는 "요약 지도"(layout)를 보고 값 목록만 낸다.
 * - xlsx: 셀 값 교체(스타일 s= 유지, 수식 셀은 덮지 않음), 열 때 다시 계산(fullCalcOnLoad), 한 페이지 맞춤, 로고 그림 교체(같은 형식일 때)
 * - docx: 단락 단위 문장 바꾸기(그 단락 첫 글자 서식으로)
 */
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colNum = (c: string) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const splitRef = (r: string) => { const m = /^([A-Z]{1,3})(\d{1,7})$/.exec(r.toUpperCase()); if (!m) throw new Error(`칸 주소가 이상합니다: ${r}`); return { col: m[1], row: Number(m[2]) }; };

type Files = Map<string, Buffer>;
const load = (buf: Buffer): Files => { const z = unzip(buf); const out: Files = new Map(); for (const [k, f] of z) out.set(k, f()); if (!out.size) throw new Error('파일을 열 수 없습니다(xlsx/docx 가 아님)'); return out; };
const save = (f: Files) => zip([...f].map(([name, data]) => ({ name, data })));
const txt = (f: Files, n: string) => f.get(n)?.toString('utf8') ?? '';

function sheetPaths(f: Files) {
  const wb = txt(f, 'xl/workbook.xml'), rels = txt(f, 'xl/_rels/workbook.xml.rels');
  return [...wb.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]*)"/g)].map(([, name, rid]) => {
    const target = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] ?? '';
    return { name: unxml(name), path: target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}` };
  });
}
function shared(f: Files) {
  return [...txt(f, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
}

/** 양식 요약 지도(토큰 적게): 시트별 사용 범위·값 있는 칸·수식 칸·병합·인쇄 설정·그림 */
export function templateLayout(buf: Buffer, ext: string, maxCells = 400) {
  const f = load(buf);
  if (ext === 'docx') {
    const doc = txt(f, 'word/document.xml');
    const paras = doc.split(/<\/w:p>/).map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1])).join('')).filter((t) => t.trim());
    return { kind: 'docx', paragraphs: paras.slice(0, 300), images: [...f.keys()].filter((k) => k.startsWith('word/media/')).length };
  }
  const ss = shared(f);
  let budget = maxCells;
  const sheets = sheetPaths(f).map(({ name, path }) => {
    const x = txt(f, path);
    const cells: Record<string, string | number> = {};
    for (const m of x.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (budget <= 0) break;
      const ref = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1]; const t = /\bt="([^"]+)"/.exec(m[1])?.[1]; const body = m[2] ?? '';
      if (!ref || !body) continue;
      const fm = /<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(body);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const isT = /<is>([\s\S]*?)<\/is>/.exec(body);
      let val: string | number | undefined;
      if (fm) val = `=${unxml(fm[1])}`;
      else if (t === 's' && v !== undefined) val = ss[Number(v)];
      else if (t === 'inlineStr' && isT) val = unxml(isT[1].replace(/<[^>]+>/g, ''));
      else if (v !== undefined) val = t === 'str' || t === 'b' ? unxml(v) : Number(v);
      if (val === undefined || val === '') continue;
      cells[ref] = val; budget--;
    }
    return { name, range: /<dimension ref="([^"]+)"/.exec(x)?.[1] ?? '', merges: [...x.matchAll(/<mergeCell ref="([^"]+)"/g)].map((m) => m[1]).slice(0, 80),
      fitToPage: /fitToPage="1"/.test(x), paper: /paperSize="(\d+)"/.exec(x)?.[1] === '9' ? 'A4' : undefined, cells };
  });
  return { kind: 'xlsx', sheets, images: [...f.keys()].filter((k) => k.startsWith('xl/media/')).map((k) => k.split('/').pop()), truncated: budget <= 0 };
}

export type CellEdit = { sheet?: string; cell: string; value: string | number | null };
/** xlsx 칸 값 바꾸기 — 돌려준 warnings 는 화면·AI 에 알림 */
export function fillXlsx(buf: Buffer, edits: CellEdit[], o: { fitOnePage?: boolean; logo?: { data: Buffer; ext: string } | null } = {}) {
  const f = load(buf);
  const sheets = sheetPaths(f);
  const warnings: string[] = [];
  const bySheet = new Map<string, CellEdit[]>();
  for (const e of edits) {
    const sh = e.sheet ? sheets.find((s) => s.name === e.sheet) : sheets[0];
    if (!sh) { warnings.push(`없는 시트: ${e.sheet}`); continue; }
    bySheet.set(sh.path, [...(bySheet.get(sh.path) ?? []), e]);
  }
  for (const [path, es] of bySheet) {
    let x = txt(f, path);
    for (const e of es) {
      const { col, row } = splitRef(e.cell); const ref = `${col}${row}`;
      const val = e.value === null || e.value === undefined ? '' : e.value;
      const isNum = typeof val === 'number' && Number.isFinite(val);
      const cellXml = (attrs: string) => {
        const a = attrs.replace(/\s*\bt="[^"]*"/, '').replace(/\s*\/$/, '');
        if (val === '') return `<c${a}/>`;
        return isNum ? `<c${a}><v>${val}</v></c>` : `<c${a} t="inlineStr"><is><t xml:space="preserve">${esc(String(val))}</t></is></c>`;
      };
      const re = new RegExp(`<c\\b([^>]*?\\br="${ref}"[^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/c>)`);
      const m = re.exec(x);
      if (m) {
        if (/<f[\s>]/.test(m[2] ?? '')) { warnings.push(`${ref} 는 수식 칸이라 그대로 둠`); continue; }
        x = x.slice(0, m.index) + cellXml(m[1]) + x.slice(m.index + m[0].length);
        continue;
      }
      // 칸이 없으면 그 행(없으면 행도) 안 알맞은 자리에 넣는다
      const rowRe = new RegExp(`<row\\b[^>]*\\br="${row}"[^>]*?(?:\\/>|>([\\s\\S]*?)<\\/row>)`);
      const rm = rowRe.exec(x);
      const newCell = cellXml(` r="${ref}"`);
      if (rm) {
        if (rm[0].endsWith('/>')) { x = x.slice(0, rm.index) + rm[0].replace(/\/>$/, `>${newCell}</row>`) + x.slice(rm.index + rm[0].length); continue; }
        const inner = rm[1] ?? '';
        const cells = [...inner.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)];
        const after = cells.find((c) => colNum(c[1]) > colNum(col));
        const at = after ? rm.index + rm[0].indexOf(inner) + (after.index ?? 0) : rm.index + rm[0].lastIndexOf('</row>');
        x = x.slice(0, at) + newCell + x.slice(at);
      } else {
        const rows = [...x.matchAll(/<row\b[^>]*\br="(\d+)"/g)];
        const after = rows.find((r) => Number(r[1]) > row);
        const at = after ? after.index! : x.indexOf('</sheetData>');
        if (at < 0) { warnings.push(`${ref} 를 넣을 수 없음`); continue; }
        x = x.slice(0, at) + `<row r="${row}">${newCell}</row>` + x.slice(at);
      }
    }
    if (o.fitOnePage) {
      // 한 페이지 맞춤 + A4
      if (/<sheetPr\b/.test(x)) x = /<pageSetUpPr\b/.test(x) ? x.replace(/<pageSetUpPr\b([^>]*?)\/>/, (_m, a) => `<pageSetUpPr${a.replace(/\s*fitToPage="[^"]*"/, '')} fitToPage="1"/>`) : x.replace(/<sheetPr\b([^>]*?)(\/>|>)/, (_m, a, end) => (end === '/>' ? `<sheetPr${a}><pageSetUpPr fitToPage="1"/></sheetPr>` : `<sheetPr${a}><pageSetUpPr fitToPage="1"/>`));
      else x = x.replace(/<worksheet\b([^>]*)>/, (m) => `${m}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`);
      if (/<pageSetup\b/.test(x)) x = x.replace(/<pageSetup\b([^>]*?)\/>/, (_m, a) => `<pageSetup${a.replace(/\s*(fitToWidth|fitToHeight|paperSize)="[^"]*"/g, '')} paperSize="9" fitToWidth="1" fitToHeight="1"/>`);
      else x = x.replace(/(<\/sheetData>(?:[\s\S]*?<mergeCells[\s\S]*?<\/mergeCells>)?(?:[\s\S]*?<pageMargins[^>]*\/>)?)/, `$1<pageSetup paperSize="9" fitToWidth="1" fitToHeight="1"/>`);
    }
    f.set(path, Buffer.from(x, 'utf8'));
  }
  // 열 때 수식 다시 계산(합계 등), 계산 순서 캐시는 지움
  const wb = txt(f, 'xl/workbook.xml');
  f.set('xl/workbook.xml', Buffer.from(/<calcPr\b/.test(wb) ? wb.replace(/<calcPr\b([^>]*?)\/>/, (_m, a) => `<calcPr${a.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`) : wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>'), 'utf8'));
  if (f.has('xl/calcChain.xml')) {
    f.delete('xl/calcChain.xml');
    f.set('[Content_Types].xml', Buffer.from(txt(f, '[Content_Types].xml').replace(/<Override\b[^>]*calcChain[^>]*\/>/, ''), 'utf8'));
    f.set('xl/_rels/workbook.xml.rels', Buffer.from(txt(f, 'xl/_rels/workbook.xml.rels').replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, ''), 'utf8'));
  }
  if (o.logo) replaceLogo(f, 'xl/media/', o.logo, warnings);
  return { data: save(f), warnings };
}

export type TextEdit = { from: string; to: string };
/** docx 문장 바꾸기: 단락 글자 전체에서 찾아 바꾸고, 그 단락 첫 글자 서식으로 다시 씀 */
export function fillDocx(buf: Buffer, edits: TextEdit[], o: { logo?: { data: Buffer; ext: string } | null } = {}) {
  const f = load(buf);
  const warnings: string[] = [];
  let doc = txt(f, 'word/document.xml');
  const done = new Set<number>();
  doc = doc.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (p) => {
    const ts = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    if (!ts.length) return p;
    const text = ts.map((m) => unxml(m[1])).join('');
    let next = text;
    edits.forEach((e, i) => { if (e.from && next.includes(e.from)) { next = next.split(e.from).join(e.to); done.add(i); } });
    if (next === text) return p;
    let first = true;
    return p.replace(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g, () => { const r = first ? `<w:t xml:space="preserve">${esc(next)}</w:t>` : '<w:t></w:t>'; first = false; return r; });
  });
  edits.forEach((e, i) => { if (!done.has(i)) warnings.push(`찾지 못한 문장: ${e.from.slice(0, 30)}`); });
  f.set('word/document.xml', Buffer.from(doc, 'utf8'));
  if (o.logo) replaceLogo(f, 'word/media/', o.logo, warnings);
  return { data: save(f), warnings };
}

/** 원본의 그림이 하나이고 형식이 같으면 회사 로고로 바꾼다(크기·위치는 원본 그대로) */
function replaceLogo(f: Files, dir: string, logo: { data: Buffer; ext: string }, warnings: string[]) {
  const imgs = [...f.keys()].filter((k) => k.startsWith(dir));
  if (imgs.length !== 1) { warnings.push(imgs.length ? `그림이 ${imgs.length}개라 로고를 바꾸지 않음` : '원본에 로고 그림이 없음'); return; }
  const ext = imgs[0].split('.').pop()!.toLowerCase().replace('jpeg', 'jpg');
  if (ext !== logo.ext.toLowerCase().replace('jpeg', 'jpg')) { warnings.push(`로고 형식이 달라(${ext}↔${logo.ext}) 바꾸지 않음`); return; }
  f.set(imgs[0], logo.data);
}
