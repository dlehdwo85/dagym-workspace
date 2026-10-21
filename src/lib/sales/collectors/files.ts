// 파일형(공공데이터 CSV·XLSX) 수집기 공통부 — 원본 lib/collectors/file-prospects.ts 이식(10/21). 쓰기는 store.upsertProspects.
import { SIDO_ALIASES } from './prospects';
import type { CollectorResult } from './types';
import { upsertProspects } from './store';

/** RFC4180 수준 CSV 파서: 따옴표 필드·필드 내 쉼표/줄바꿈·"" 이스케이프·CRLF·BOM */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let inQ = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; continue; }
    if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; }
    else field += c;
  }
  row.push(field); if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}
export function csvToObjects(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text); if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}
export function decodeKoreanText(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'euc-kr' } {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 256 * 1024));
  if (!head.includes('�')) return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
  return { text: new TextDecoder('euc-kr').decode(bytes), encoding: 'euc-kr' };
}
export type ProspectPayload = Record<string, unknown>;
export type SourceFile = { url: string; pageUrl?: string; label?: string };
export type Extracted = { rows: number; payloads: ProspectPayload[]; filtered: number; note?: string; error?: string; warnings?: string[] };
export type FileSourceSpec = { slug: string; sourceName: string; pageUrl: string; files: SourceFile[]; mapRow?: (row: Record<string, string>) => ProspectPayload | null; requiredHeaders?: string[];
  extract?: (bytes: Uint8Array, file: SourceFile) => Extracted; maxRowsPerRun?: number; downloadTimeoutMs?: number };
export const CHUNK = 300;
export function extractCsv(bytes: Uint8Array, spec: Pick<FileSourceSpec, 'mapRow' | 'requiredHeaders'>): Extracted {
  const { text, encoding } = decodeKoreanText(bytes);
  const rows = csvToObjects(text);
  const headers = (parseCsv(text)[0] ?? []).map((h) => h.trim());
  const missing = (spec.requiredHeaders ?? []).filter((h) => !headers.includes(h));
  if (missing.length) return { rows: rows.length, payloads: [], filtered: 0, error: `원천 형식 변경 의심 — 필수 컬럼 없음: ${missing.join(', ')} (받은 컬럼: ${headers.slice(0, 12).join(', ')})` };
  const payloads: ProspectPayload[] = []; let filtered = 0;
  for (const r of rows) { const p = spec.mapRow?.(r) ?? null; if (p) payloads.push(p); else filtered++; }
  return { rows: rows.length, payloads, filtered, note: encoding };
}
const fail = (msg: string): CollectorResult => ({ inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: msg, summary: msg, providerMode: 'file_download' });
export async function runFileProspectCollector(spec: FileSourceSpec, fetchImpl: typeof fetch = fetch, deadlineMs = 40000, now: () => number = Date.now): Promise<CollectorResult> {
  const startedAt = now(); const observedAt = new Date().toISOString();
  const payloads: ProspectPayload[] = []; let rowsTotal = 0; let filtered = 0; const fileErrors: string[] = []; const notes: string[] = [];
  for (const file of spec.files) {
    const remaining = deadlineMs - (now() - startedAt);
    if (remaining < 3000) { fileErrors.push(`시간 한도 근접 — ${file.label ?? file.url} 다운로드는 다음 실행에서`); continue; }
    let bytes: Uint8Array;
    try {
      const res = await fetchImpl(file.url, { signal: AbortSignal.timeout(Math.min(spec.downloadTimeoutMs ?? 25000, remaining - 2000)) });
      if (!res.ok) { fileErrors.push(`원천 파일 ${res.status} ${res.statusText} (${file.label ?? file.url})`); continue; }
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) { fileErrors.push(`원천 파일 요청 실패 (${file.label ?? file.url}): ${e instanceof Error ? e.message : String(e)}`); continue; }
    let ex: Extracted;
    try { ex = spec.extract ? spec.extract(bytes, file) : extractCsv(bytes, spec); } catch (e) { ex = { rows: 0, payloads: [], filtered: 0, error: `파싱 실패: ${e instanceof Error ? e.message : String(e)}` }; }
    if (ex.error) { fileErrors.push(`${file.label ? file.label + ': ' : ''}${ex.error}`); continue; }
    rowsTotal += ex.rows; filtered += ex.filtered; if (ex.note) notes.push(`${file.label ?? '파일'} ${ex.note}`);
    for (const w of ex.warnings ?? []) fileErrors.push(`${file.label ? file.label + ': ' : ''}${w}`);
    const sourceUrl = file.pageUrl ?? spec.pageUrl;
    for (const p of ex.payloads) payloads.push({ source_slug: spec.slug, source_name: spec.sourceName, source_url: sourceUrl, source_observed_at: observedAt, ...p });
  }
  if (payloads.length === 0 && fileErrors.length > 0) return fail(fileErrors.join('\n'));
  const total = payloads.length; const win = rotatingWindow(total, spec.maxRowsPerRun ?? 600, todayIndex()); const batch = payloads.slice(win.start, win.end);
  let inserted = 0, updated = 0, unchanged = 0, errors = fileErrors.length, invalid = 0, merged = 0; const logs: string[] = [...fileErrors];
  for (let i = 0; i < batch.length; i += CHUNK) {
    if (deadlineMs - (now() - startedAt) < 5000) { errors += 1; logs.push(`시간 한도 근접 — ${batch.length - i}건은 다음 순환에서 처리`); break; }
    try { const r = await upsertProspects(batch.slice(i, i + CHUNK)); inserted += r.inserted; updated += r.updated; unchanged += r.unchanged; errors += r.errors; invalid += r.invalid; merged += r.duplicatesMerged; if (r.errorLog && logs.length < 10) logs.push(r.errorLog); }
    catch (e) { errors += Math.min(CHUNK, batch.length - i); if (logs.length < 10) logs.push(e instanceof Error ? e.message : String(e)); }
  }
  return { inserted, updated, unchanged, errors: errors + invalid, errorLog: logs.length ? logs.join('\n') : undefined, providerMode: 'file_download',
    summary: `원천 ${rowsTotal}행${notes.length ? `(${notes.join(', ')})` : ''} · 대상 ${total}` + (batch.length < total ? ` · 이번 구간 ${win.start + 1}~${win.end}/${total} (${win.cycleDays}일 순환)` : '') +
      ` · 신규 ${inserted} · 갱신 ${updated} · 변화없음 ${unchanged} · 대상외 ${filtered}` + (invalid ? ` · 형식오류 ${invalid}` : '') + (merged ? ` · 중복병합 ${merged}` : '') + (errors ? ` · 오류 ${errors}` : '') };
}
/** data.go.kr 파일데이터 페이지의 메타데이터(contentUrl)에서 최신 다운로드 URL(분기마다 바뀜). 실패하면 마지막 확인값 */
export async function resolveDataGoKrFileUrl(pageUrl: string, fallback: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  try { const res = await fetchImpl(pageUrl, { signal: AbortSignal.timeout(5000) }); if (!res.ok) return fallback; const html = await res.text();
    const m = html.match(/"contentUrl"\s*:\s*"(https:\/\/www\.data\.go\.kr\/cmm\/cmm\/fileDownload\.do\?atchFileId=FILE_\d+&(?:amp;)?fileDetailSn=\d+[^"]*)"/); return m ? m[1].replace(/&amp;/g, '&') : fallback; } catch { return fallback; }
}
export const todayIndex = () => Math.floor((Date.now() + 9 * 3600_000) / 86_400_000);
export function rotatingWindow(total: number, size: number, dayIndex: number) {
  if (total <= size) return { start: 0, end: total, cycleDays: 1 };
  const cycleDays = Math.ceil(total / size); const k = ((dayIndex % cycleDays) + cycleDays) % cycleDays;
  return { start: k * size, end: Math.min(total, (k + 1) * size), cycleDays };
}
export function toYmd(v: string | undefined): string | null {
  const t = (v ?? '').trim(); let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; return null;
}
export function regionFromAddress(addr: string | undefined): string | null {
  const parts = (addr ?? '').trim().split(/\s+/).filter(Boolean); if (parts.length && SIDO_ALIASES[parts[0]]) parts[0] = SIDO_ALIASES[parts[0]];
  return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : parts[0] ?? null;
}
export const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
export const addDaysYmd = (ymd: string, days: number) => new Date(Date.parse(ymd + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10);
