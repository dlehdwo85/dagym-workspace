// V14 32: 한글(HWP 5.0 · HWPX) 본문 글자 추출 — 외부 패키지 없음.
// HWP 5.0 = OLE 복합 문서(CFB): FileHeader(압축·암호 플래그) + BodyText/Section{n}(zlib raw deflate, 레코드 묶음) → HWPTAG_PARA_TEXT(67) 의 UTF-16LE 글자.
// HWPX = zip + Contents/section{n}.xml 의 <hp:t>. 배포용(암호화)·비밀번호 문서는 읽지 않는다(null).
import { inflateRawSync, inflateSync } from 'node:zlib';
import { unzip } from './textExtract';

const ENDOFCHAIN = 0xfffffffe;
type CfbEntry = { path: string; type: number; start: number; size: number };

/** OLE 복합 문서에서 스트림 이름(경로) → 내용. 작은 스트림(4096 미만)은 mini stream 에서 읽는다 */
export function cfbStreams(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (buf.length < 512 || buf.readUInt32LE(0) !== 0xe011cfd0 || buf.readUInt32LE(4) !== 0xe11ab1a1) return out;
  const ss = 1 << buf.readUInt16LE(30), mss = 1 << buf.readUInt16LE(32);
  const nFat = buf.readUInt32LE(44), firstDir = buf.readUInt32LE(48), cutoff = buf.readUInt32LE(56) || 4096;
  const firstMini = buf.readUInt32LE(60), firstDifat = buf.readUInt32LE(68), nDifat = buf.readUInt32LE(72);
  const sec = (n: number) => buf.subarray((n + 1) * ss, (n + 2) * ss);
  // FAT 섹터 목록: 머리의 109개 + DIFAT 체인
  const fatSecs: number[] = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const v = buf.readUInt32LE(76 + i * 4); if (v < 0xfffffffa) fatSecs.push(v); }
  for (let d = firstDifat, k = 0; d < 0xfffffffa && k < nDifat && k < 10_000; k++) {
    const s = sec(d);
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) { const v = s.readUInt32LE(i * 4); if (v < 0xfffffffa) fatSecs.push(v); }
    d = s.readUInt32LE(ss - 4);
  }
  const fat: number[] = [];
  for (const f of fatSecs) { const s = sec(f); for (let i = 0; i < ss / 4; i++) fat.push(s.readUInt32LE(i * 4)); }
  const chain = (start: number, table: number[]) => { const c: number[] = []; for (let n = start, g = 0; n < 0xfffffffa && g < 1_000_000; n = table[n] ?? ENDOFCHAIN, g++) c.push(n); return c; };
  const readChain = (start: number, size: number) => {
    const parts = chain(start, fat).map(sec);
    return Buffer.concat(parts).subarray(0, size);
  };
  // 디렉터리
  const dirBuf = Buffer.concat(chain(firstDir, fat).map(sec));
  const entries: (CfbEntry & { left: number; right: number; child: number; name: string })[] = [];
  for (let p = 0; p + 128 <= dirBuf.length; p += 128) {
    const nlen = dirBuf.readUInt16LE(p + 64); const type = dirBuf[p + 66];
    const name = nlen > 2 ? dirBuf.subarray(p, p + nlen - 2).toString('utf16le') : '';
    entries.push({ path: '', name, type, left: dirBuf.readInt32LE(p + 68), right: dirBuf.readInt32LE(p + 72), child: dirBuf.readInt32LE(p + 76), start: dirBuf.readUInt32LE(p + 116), size: dirBuf.readUInt32LE(p + 120) });
  }
  if (!entries.length) return out;
  const root = entries[0];
  // mini stream(루트 엔트리 내용) + miniFAT
  const miniStream = root.start < 0xfffffffa ? readChain(root.start, root.size) : Buffer.alloc(0);
  const miniFat: number[] = [];
  for (const f of chain(firstMini, fat)) { const s = sec(f); for (let i = 0; i < ss / 4; i++) miniFat.push(s.readUInt32LE(i * 4)); }
  const readMini = (start: number, size: number) => Buffer.concat(chain(start, miniFat).map((n) => miniStream.subarray(n * mss, (n + 1) * mss))).subarray(0, size);
  // 트리 걷기(좌·우 형제 + 자식)
  const seen = new Set<number>();
  const walk = (idx: number, prefix: string) => {
    if (idx < 0 || idx >= entries.length || seen.has(idx)) return;
    seen.add(idx);
    const e = entries[idx];
    walk(e.left, prefix); walk(e.right, prefix);
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === 2 && e.size > 0) out.set(path, e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start, e.size));
    if (e.type === 1 || e.type === 5) walk(e.child, e.type === 5 ? '' : path);
  };
  walk(root.child, '');
  return out;
}

const HWPTAG_PARA_TEXT = 0x10 + 51;
/** 레코드 묶음에서 문단 글자만 모은다 */
function paraTexts(data: Buffer): string[] {
  const out: string[] = [];
  let p = 0;
  while (p + 4 <= data.length) {
    const h = data.readUInt32LE(p); p += 4;
    const tag = h & 0x3ff; let size = h >>> 20;
    if (size === 0xfff) { if (p + 4 > data.length) break; size = data.readUInt32LE(p); p += 4; }
    if (p + size > data.length) size = data.length - p;
    if (tag === HWPTAG_PARA_TEXT) {
      let s = '';
      for (let i = 0; i + 2 <= size; i += 2) {
        const c = data.readUInt16LE(p + i);
        if (c >= 32) { s += String.fromCharCode(c); continue; }
        if (c === 9) { s += '\t'; i += 14; continue; } // 탭(인라인 컨트롤 8 WCHAR)
        if (c === 10 || c === 13) { s += '\n'; continue; }
        if (c === 0 || c >= 24) continue; // 1 WCHAR 문자 컨트롤
        i += 14; // 인라인·확장 컨트롤 = 8 WCHAR
      }
      if (s.trim()) out.push(s.replace(/\n+$/, ''));
    }
    p += size;
  }
  return out;
}

/** HWP 5.0 본문 글자. 읽을 수 없으면(암호·배포용·다른 형식) null */
export function hwpText(buf: Buffer): string | null {
  const streams = cfbStreams(buf);
  const header = streams.get('FileHeader');
  if (!header || !header.subarray(0, 17).toString('latin1').startsWith('HWP Document File')) return null;
  const flags = header.readUInt32LE(36);
  if (flags & 0b10 || flags & 0b100) return null; // 비밀번호·배포용 문서는 읽지 않는다
  const compressed = !!(flags & 1);
  const names = [...streams.keys()].filter((k) => /^BodyText\/Section\d+$/.test(k)).sort((a, b) => Number(a.match(/\d+$/)![0]) - Number(b.match(/\d+$/)![0]));
  const paras: string[] = [];
  for (const n of names) {
    let data = streams.get(n)!;
    if (compressed) { try { data = inflateRawSync(data); } catch { try { data = inflateSync(data); } catch { continue; } } }
    paras.push(...paraTexts(data));
  }
  const text = paras.join('\n').trim();
  return text || null;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
/** HWPX(zip) 본문 글자: Contents/section*.xml 의 <hp:t> */
export function hwpxText(buf: Buffer): string | null {
  const z = unzip(buf);
  const names = [...z.keys()].filter((k) => /^Contents\/section\d+\.xml$/i.test(k)).sort();
  if (!names.length) return null;
  const out: string[] = [];
  for (const n of names) {
    const xml = z.get(n)!().toString('utf8');
    for (const para of xml.matchAll(/<hp:p\b[\s\S]*?<\/hp:p>/g)) {
      const t = [...para[0].matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)].map((m) => unxml(m[1].replace(/<[^>]+>/g, ''))).join('');
      if (t.trim()) out.push(t);
    }
  }
  const text = out.join('\n').trim();
  return text || null;
}
