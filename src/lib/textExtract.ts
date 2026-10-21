import { inflateRawSync } from 'node:zlib';

/**
 * V9 자료실 검색·AI 읽기용 글자 추출 (외부 서비스·추가 패키지 없음).
 * 텍스트·CSV·MD·JSON, Word(.docx)·Excel(.xlsx)·PowerPoint(.pptx) 는 동기, 한글(.hwp/.hwpx)·PDF 는 extractTextDeep(비동기). 이미지·스캔 PDF 는 제목·태그 + 정리 때 AI 비전.
 */
export const MAX_EXTRACT_BYTES = 15 * 1024 * 1024;
const MAX_CHARS = 300_000;

export function unzip(buf: Buffer): Map<string, () => Buffer> {
  const out = new Map<string, () => Buffer>();
  // 끝에서 중앙 디렉터리 끝 레코드 찾기
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return out;
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    out.set(name, () => {
      const l = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      const data = buf.subarray(l, l + csize);
      return method === 8 ? inflateRawSync(data) : Buffer.from(data);
    });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const texts = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => unxml(m[1].replace(/<[^>]+>/g, '')));

function docx(z: Map<string, () => Buffer>) {
  const x = z.get('word/document.xml')?.().toString('utf8') ?? '';
  return x.split(/<\/w:p>/).map((p) => texts(p, 'w:t').join('')).filter(Boolean).join('\n');
}
function pptx(z: Map<string, () => Buffer>) {
  const slides = [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return slides.map((k, i) => `[슬라이드 ${i + 1}] ${texts(z.get(k)!().toString('utf8'), 'a:t').join(' ')}`).join('\n');
}
function xlsx(z: Map<string, () => Buffer>) {
  const shared = texts(z.get('xl/sharedStrings.xml')?.().toString('utf8') ?? '', 'si');
  const wb = z.get('xl/workbook.xml')?.().toString('utf8') ?? '';
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unxml(m[1]));
  const sheets = [...z.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return sheets.map((k, i) => {
    const x = z.get(k)!().toString('utf8');
    const rows = [...x.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const t = /t="(\w+)"/.exec(c[1])?.[1];
      if (t === 'inlineStr') return texts(c[2] ?? '', 't').join('');
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1] ?? '';
      return t === 's' ? shared[Number(v)] ?? '' : unxml(v);
    }).join('\t'));
    return `[시트 ${names[i] ?? i + 1}]\n${rows.join('\n')}`;
  }).join('\n\n');
}

/** V14 32: 동기 추출 + HWP·HWPX·PDF(비동기). 스캔 PDF·이미지는 null(정리 때 AI 비전) */
export async function extractTextDeep(buf: Buffer, fileName: string, mime: string): Promise<string | null> { return (await extractTextResult(buf, fileName, mime)).text; }
/** 본문 + 실패 사유(운영에서 왜 안 됐는지 파일 상세에 보이게 — 로컬 10/21 11:05) */
export async function extractTextResult(buf: Buffer, fileName: string, mime: string): Promise<{ text: string | null; error: string | null }> {
  const sync = extractText(buf, fileName, mime);
  if (sync) return { text: sync, error: null };
  if (buf.length > MAX_EXTRACT_BYTES) return { text: null, error: `파일이 커서 건너뜀(${Math.round(buf.length / 1048576)}MB > ${Math.round(MAX_EXTRACT_BYTES / 1048576)}MB)` };
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const kind = ext === 'hwp' || mime === 'application/x-hwp' || mime === 'application/haansofthwp' ? 'hwp' : ext === 'hwpx' || mime === 'application/hwp+zip' || mime === 'application/haansofthwpx' ? 'hwpx' : ext === 'pdf' || mime === 'application/pdf' ? 'pdf' : null;
  if (!kind) return { text: null, error: null };
  try {
    let t: string | null = null;
    if (kind === 'hwp') t = (await import('./hwp')).hwpText(buf);
    else if (kind === 'hwpx') t = (await import('./hwp')).hwpxText(buf);
    else t = await (await import('./pdfText')).pdfText(buf);
    const text = t ? t.replace(/\u0000/g, '').slice(0, MAX_CHARS) : null;
    return { text, error: text ? null : kind === 'pdf' ? '글자가 없는 PDF(스캔본·이미지) — AI 정리 때 비전으로 읽음' : '본문을 찾지 못함' };
  } catch (e) {
    const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { text: null, error: `${kind} 추출 오류: ${m.slice(0, 300)}` };
  }
}

export function extractText(buf: Buffer, fileName: string, mime: string): string | null {
  if (buf.length > MAX_EXTRACT_BYTES) return null;
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  try {
    let t: string | null = null;
    if (/^text\//.test(mime) || ['txt', 'csv', 'md', 'json', 'tsv', 'log'].includes(ext)) t = buf.toString('utf8').replace(/^﻿/, '');
    else if (ext === 'docx') t = docx(unzip(buf));
    else if (ext === 'xlsx') t = xlsx(unzip(buf));
    else if (ext === 'pptx') t = pptx(unzip(buf));
    return t ? t.replace(/\u0000/g, '').slice(0, MAX_CHARS) : null;
  } catch {
    return null;
  }
}
