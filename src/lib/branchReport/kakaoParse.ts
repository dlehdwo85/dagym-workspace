import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

/**
 * #1096 지점 주간보고(다짐 전용) 1단계 — 카카오톡 대화 내보내기 파일 해석(docs/branch-report-design.md 2절).
 * 카카오에는 단체방을 읽는 공식 API 가 없어 담당자가 내보내기 파일을 올린다. 기기·버전마다 모양이 달라 여러 모양을 받는다:
 *  - PC(Windows) txt: 날짜 줄 "--------------- 2026년 11월 21일 금요일 ---------------" + "[이름] [오후 2:05] 내용"
 *  - 모바일 txt: "2026년 11월 21일 오후 2:05, 이름 : 내용" · "2026. 11. 21. 오후 2:05, 이름 : 내용" · "2026. 11. 21. 14:05, 이름 : 내용"
 *  - macOS·iOS csv: "Date,User,Message" + "2026-11-21 14:05:00,"이름","내용""(따옴표 안 줄바꿈 가능)
 *  - zip: 안의 txt·csv 를 모두 읽음
 * 형식에 안 맞는 줄은 앞 메시지의 이어진 줄. 사진·동영상·이모티콘·입퇴장 같은 시스템 줄은 뺀다. 같은 메시지(시각·보낸 사람·내용)는 한 번만.
 * 이 파일은 Node 기본 모듈만 쓴다(시험이 Node 로 바로 불러 확인).
 */
export type ChatMessage = { at: string; sender: string; text: string; key: string };
export type ParseResult = { messages: ChatMessage[]; from: string | null; to: string | null; skipped: number; duplicates: number; formats: string[] };

const pad = (n: number) => String(n).padStart(2, '0');
/** 오전/오후·AM/PM·24시 → "HH:mm" */
function hhmm(ampm: string | undefined, h: string, m: string) {
  let H = Number(h);
  const a = (ampm ?? '').toUpperCase();
  if ((a === '오후' || a === 'PM') && H < 12) H += 12;
  if ((a === '오전' || a === 'AM') && H === 12) H = 0;
  return `${pad(H)}:${pad(Number(m))}`;
}
const ymd = (y: string | number, mo: string | number, d: string | number) => `${y}-${pad(Number(mo))}-${pad(Number(d))}`;
const keyOf = (at: string, sender: string, text: string) => createHash('sha256').update(`${at}\u0001${sender}\u0001${text}`).digest('hex').slice(0, 32);

/** 대화로 치지 않는 줄(사진·동영상·이모티콘·삭제됨·입퇴장·초대) */
const SYSTEM_TEXT = /^(사진|사진 \d+장|동영상|이모티콘|파일: .+|음성메시지|삭제된 메시지입니다\.?|샵검색: .+|보이스톡 .+|페이스톡 .+)$/;
const SYSTEM_LINE = /(님이 들어왔습니다|님이 나갔습니다|님을 내보냈습니다|님을 초대했습니다|님이 .*님을 초대했습니다|채팅방 관리자가 메시지를 가렸습니다)\.?$/;

const RE = {
  pcDate: /^-{3,}\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*?-{3,}\s*$/,
  pcMsg: /^\[(.+?)\]\s*\[(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})\]\s?(.*)$/,
  mobileKo: /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)?\s*(\d{1,2}):(\d{2}),\s*(.+?)\s:\s?(.*)$/,
  mobileDot: /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2}),\s*(.+?)\s:\s?(.*)$/,
  dateOnly: /^(\d{4})(?:년\s*|\.\s*)(\d{1,2})(?:월\s*|\.\s*)(\d{1,2})(?:일|\.)?\s*(?:[월화수목금토일]요일)?\s*$/,
  header: /^(.+ 님과 카카오톡 대화|저장한 날짜\s*:.*|Talk_\d.*|.*카카오톡 대화\s*$)$/,
};

/** 한 덩어리 글(txt) 해석 */
function parseText(src: string, out: ChatMessage[], fmts: Set<string>) {
  let day: string | null = null;
  let last: ChatMessage | null = null;
  let skipped = 0;
  for (const raw of src.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(RE.pcDate))) { day = ymd(m[1], m[2], m[3]); last = null; fmts.add('pc-txt'); continue; }
    if ((m = line.match(RE.pcMsg)) && day) { last = push(out, `${day}T${hhmm(m[2], m[3], m[4])}`, m[1], m[5]); continue; }
    if ((m = line.match(RE.mobileKo))) { fmts.add('mobile-txt'); last = push(out, `${ymd(m[1], m[2], m[3])}T${hhmm(m[4], m[5], m[6])}`, m[7], m[8]); continue; }
    if ((m = line.match(RE.mobileDot))) { fmts.add('mobile-txt'); last = push(out, `${ymd(m[1], m[2], m[3])}T${hhmm(m[4], m[5], m[6])}`, m[7], m[8]); continue; }
    if (line.match(RE.dateOnly) || line.match(RE.header)) { last = null; continue; }
    if (SYSTEM_LINE.test(line.trim()) || /^\d{4}[.년].*(님이 들어왔습니다|님이 나갔습니다|초대했습니다)/.test(line)) { skipped++; continue; }
    if (last) { last.text = `${last.text}\n${line}`; continue; } // 여러 줄 메시지
    skipped++;
  }
  return skipped;
}
function push(out: ChatMessage[], at: string, sender: string, text: string): ChatMessage {
  const msg = { at, sender: sender.trim().slice(0, 60), text: text.trim(), key: '' };
  out.push(msg);
  return msg;
}

/** csv(macOS·iOS) — 따옴표 안의 쉼표·줄바꿈·"" 처리 */
function csvRows(src: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  const s = src.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') { q = true; continue; }
    if (c === ',') { row.push(cur); cur = ''; continue; }
    if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; continue; }
    cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function parseCsv(src: string, out: ChatMessage[], fmts: Set<string>) {
  const rows = csvRows(src);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const di = head.indexOf('date'), ui = head.indexOf('user'), mi = head.indexOf('message');
  if (di < 0 || ui < 0 || mi < 0) return parseText(src, out, fmts);
  fmts.add('csv');
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const d = (r[di] ?? '').trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[ T](\d{1,2}):(\d{2})/);
    if (!d || !r[ui]) { skipped++; continue; }
    push(out, `${ymd(d[1], d[2], d[3])}T${pad(Number(d[4]))}:${d[5]}`, r[ui], r[mi] ?? '');
  }
  return skipped;
}

/** zip 안의 txt·csv(저장·deflate 만 — 카카오 내보내기 zip 은 이 둘) */
export function unzipTexts(buf: Buffer): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip 파일이 아닙니다');
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (!/\.(txt|csv)$/i.test(name) || /(^|\/)__MACOSX\//.test(name)) continue;
    if (csize > 50 * 1024 * 1024) throw new Error('zip 안의 파일이 너무 큽니다(50MB)');
    const ln = buf.readUInt16LE(lho + 26), lx = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + ln + lx, lho + 30 + ln + lx + csize);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 100 * 1024 * 1024 }) : null;
    if (raw) out.push({ name, text: raw.toString('utf8') });
  }
  return out;
}

/** 파일 하나(이름으로 txt·csv·zip 구분) → 메시지들. 같은 메시지 중복 제거, 시각 순 */
export function parseKakaoExport(files: { name: string; data: Buffer | string }[]): ParseResult {
  const all: ChatMessage[] = []; const fmts = new Set<string>(); let skipped = 0;
  for (const f of files) {
    const parts = /\.zip$/i.test(f.name) ? unzipTexts(Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data)) : [{ name: f.name, text: Buffer.isBuffer(f.data) ? f.data.toString('utf8') : f.data }];
    if (/\.zip$/i.test(f.name)) fmts.add('zip');
    for (const p of parts) skipped += /\.csv$/i.test(p.name) ? parseCsv(p.text, all, fmts) : parseText(p.text, all, fmts);
  }
  const seen = new Set<string>(); const messages: ChatMessage[] = []; let duplicates = 0;
  for (const m of all) {
    if (!m.text || SYSTEM_TEXT.test(m.text) || SYSTEM_LINE.test(m.text)) { skipped++; continue; }
    m.key = keyOf(m.at, m.sender, m.text);
    if (seen.has(m.key)) { duplicates++; continue; }
    seen.add(m.key); messages.push(m);
  }
  messages.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { messages, from: messages[0]?.at.slice(0, 10) ?? null, to: messages.at(-1)?.at.slice(0, 10) ?? null, skipped, duplicates, formats: [...fmts].sort() };
}
