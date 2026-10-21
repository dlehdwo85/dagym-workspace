// 의존성 없는 최소 XLSX 리더 — 영업관리 원본 lib/collectors/xlsx-lite.ts 이식(10/21)
// 의존성 없는 최소 XLSX 리더 (값만 읽음 — 서식·수식 계산 없음).
//
// 공공기관 배포 XLSX(문체부 공공체육시설 현황 등)를 Vercel 함수에서 읽기 위함.
// ZIP 중앙 디렉터리 → (stored | deflate) 해제 → workbook/rels/sharedStrings/sheet XML 을 정규식으로 파싱.
// 신뢰할 수 없는 입력: 크기 상한을 두고, 실행 가능한 내용은 다루지 않는다(텍스트·숫자 값만).

import { inflateRawSync } from 'node:zlib';

const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** 공공기관 현황표 기준 넉넉한 상한 (실제: 시트당 ~2,100행·~60열) */
const MAX_ROWS = 200_000;
const MAX_COLS = 1_000;

type ZipEntry = { name: string; method: number; compSize: number; size: number; localOffset: number };

function readZipEntries(buf: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx: ZIP 끝 레코드를 찾지 못함 (XLSX 아님)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("xlsx: 중앙 디렉터리 손상");
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { name, method, compSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Uint8Array, e: ZipEntry): string {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(e.localOffset, true) !== 0x04034b50) throw new Error(`xlsx: 로컬 헤더 손상 ${e.name}`);
  if (e.size > MAX_ENTRY_BYTES || e.compSize > MAX_ENTRY_BYTES) throw new Error(`xlsx: 항목이 너무 큼 ${e.name}`);
  if (e.method === 0 && e.compSize !== e.size) throw new Error(`xlsx: 비압축 항목 크기 불일치 ${e.name}`);
  const start = e.localOffset + 30 + dv.getUint16(e.localOffset + 26, true) + dv.getUint16(e.localOffset + 28, true);
  const raw = buf.subarray(start, start + e.compSize);
  const data = e.method === 0 ? raw : e.method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES }) : null;
  if (!data) throw new Error(`xlsx: 지원하지 않는 압축 방식 ${e.method}`);
  return new TextDecoder("utf-8").decode(data);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type Workbook = { sheetNames: string[]; rows(sheetName: string): string[][] };

export function readXlsx(input: Uint8Array): Workbook {
  const entries = readZipEntries(input);
  const get = (name: string) => {
    const e = entries.get(name);
    return e ? readEntry(input, e) : null;
  };
  const workbook = get("xl/workbook.xml");
  const rels = get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("xlsx: workbook.xml 없음");

  const relTarget = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1];
    const target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relTarget.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = unescapeXml(m[0].match(/\bname="([^"]*)"/)?.[1] ?? "");
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1] ?? "";
    const target = relTarget.get(rid);
    if (target) sheets.push({ name, path: "xl/" + target });
  }

  const sstXml = get("xl/sharedStrings.xml") ?? "";
  const shared = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  return {
    sheetNames: sheets.map((s) => s.name),
    rows(sheetName: string): string[][] {
      const sheet = sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new Error(`xlsx: 시트 없음 ${sheetName}`);
      const xml = get(sheet.path);
      if (!xml) throw new Error(`xlsx: 시트 파일 없음 ${sheet.path}`);
      const out: string[][] = [];
      for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
        const rowNo = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? out.length + 1);
        // 비신뢰 입력: 작은 XML 의 거대 좌표(r="99999999")로 배열 채우기 루프를 유발하지 못하게 상한
        if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > MAX_ROWS) throw new Error(`xlsx: 행 번호 범위 초과 ${rowNo}`);
        const row: string[] = [];
        for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = cm[1];
          const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
          const t = attrs.match(/\bt="([^"]+)"/)?.[1];
          const inner = cm[2] ?? "";
          const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          let val = "";
          if (t === "s" && v != null) val = shared[Number(v)] ?? "";
          else if (t === "inlineStr") val = textOf(inner);
          else if (v != null) val = unescapeXml(v);
          const idx = ref ? colIndex(ref) : row.length;
          // 상한 밖 열은 무시한다(배열 채우기 루프 방지). 실제 공공 현황표도 서식만 있는 빈 셀이 ~1,000열까지 있어
          // 예외로 파일 전체를 실패시키면 안 된다 (2026-10-12 운영 실행: ALN268 에서 실패 → 수정).
          if (idx > MAX_COLS) continue;
          while (row.length < idx) row.push("");
          row[idx] = val;
        }
        while (out.length < rowNo - 1) out.push([]);
        out[rowNo - 1] = row;
      }
      return out;
    },
  };
}
