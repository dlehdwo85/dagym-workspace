// 252차 #786(대표 10/29 00:20): 입찰 공고의 첨부 공고문(hwp·hwpx·pdf·docx)을 받아 글을 뽑고 '참가자격' 절을 잘라 공고 줄에 저장한다(원문 1,500자 + 규칙으로 뽑은 요건 + 화면 한 줄).
// AI·비용 없음. 파일은 자료실에 저장하지 않고 글만 읽는다(이미 자료실에 받아 둔 같은 주소 파일이 있으면 그 글을 씀). 나라장터는 API 의 업종 제한·참가 지역을 한 줄에 합친다.
// 정기 실행: 열린 관련 공고 중 아직 안 읽었거나 첨부가 바뀐 것(정정 공고)·못 읽은 것(20시간 뒤, 3번까지)을 마감 가까운 순으로 한 번에 몇 건씩.
import { sha256 } from '../crypto';
import { db } from '../db';
import { extractTextResult, unzip } from '../textExtract';
import { apiExtra, COMMON_ONLY, docDeadline, eligibilityItems, eligibilityLine, eligibilitySection, jsonSafe, lineOf, type EligItem } from './eligibilityText';
import { visionRead, type PhotoDoc } from './eligibilityVision';
import { sourceFiles, type SrcFile } from './files';

export type Eligibility = { text: string | null; items: EligItem[]; line: string | null; error: string | null; file: { name: string | null; url: string } | null; readAt: string; sig: string; tries: number;
  /** 253차 #790 사진 공고문을 AI 비전으로 읽음(숫자는 원문 확인) */ by?: 'vision'; visionUsd?: number;
  /** 259차: 입찰 마감이 없는 공고(임시 마감·마감 칸 빔)에서 공고문의 제출 마감을 찾아봄 — 찾았으면 그 글줄 */ dl?: { at: string | null; label: string | null } };
/** 259차: 마감 칸이 비었거나 공동수급협정 마감(임시)인 공고 — 공고문에서 제안서·입찰서 제출 마감을 찾음 */
export const needsDocDeadline = (r: Row) => !String(r.deadline_at ?? '') || r.deadline_src === 'agreement';
type Row = Record<string, any>;
const kstDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

/** 공고 줄의 첨부 목록 지문 — 정정 공고로 첨부가 바뀌면 다시 읽음 */
export function filesSig(r: Row): string {
  const urls = sourceFiles(r.attachment_urls ?? r.attachments, r.notice_file_url).map((f) => f.url).sort();
  return urls.length ? sha256(urls.join('\n')).slice(0, 16) : '';
}
/** 공고문일 법한 파일부터 — 이름에 '공고' +3 · '입찰' +1 · 과업지시서·내역서·도면·서식 등 −2 · 글을 뽑을 수 없는 꼴(그림·압축) 맨 뒤 */
const NOT_NOTICE = /(과업|시방|내역|도면|설계|평가|제안요청|양식|서식|사진|견적|별지|계약서|청렴|서약|위임|확약|산출|명세|배치|조감|현황)/;
export function rankFiles(files: SrcFile[]): SrcFile[] {
  const score = (f: SrcFile) => {
    const n = String(f.name ?? ''); const ext = /\.([a-z0-9]{1,5})$/i.exec(n)?.[1]?.toLowerCase() ?? '';
    return (/공고/.test(n) ? 3 : 0) + (/입찰/.test(n) ? 1 : 0) - (NOT_NOTICE.test(n) ? 2 : 0) + (/^(hwp|hwpx|pdf|docx|txt)$/.test(ext) ? 1 : 0) - (/^(jpe?g|png|gif|bmp|tiff?|zip|7z|egg|alz|xlsx?|pptx?)$/.test(ext) ? 5 : 0);
  };
  return files.map((f, i) => ({ f, i, s: score(f) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.f);
}
/** 글 → 저장할 결과(절·항목·한 줄). 절이 없으면 null */
export function eligibilityOf(text: string | null | undefined, r: Row = {}): { text: string; items: EligItem[]; line: string } | null {
  const sec = eligibilitySection(text); if (!sec) return null;
  const items = eligibilityItems(sec);
  return { text: sec, items, line: eligibilityLine(items, sec, apiExtra(r, items)) ?? COMMON_ONLY };
}
export const PHOTO_ONLY = '공고문이 사진(스캔)으로만 되어 있음';
/** 글이 없는 이유 — 스캔 PDF·그림만 든 docx/hwpx(word/media·BinData)는 '사진(스캔)으로만' (253차 로컬 운영 확인: docx 에 그림 16장·글 0) */
function fileErr(e: string | null, data: Buffer, name: string): string {
  if (e && /스캔|글자가 없는/.test(e)) return PHOTO_ONLY;
  if (/\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(name)) return PHOTO_ONLY;
  if (/\.(docx|hwpx|pptx)$/i.test(name)) { try { if ([...unzip(data).keys()].some((k) => /(^|\/)(media|BinData)\//i.test(k))) return PHOTO_ONLY; } catch { /* 아래 */ } }
  return !e ? '본문 글자 없음' : /추출 오류/.test(e) ? '글 뽑기 오류' : /커서/.test(e) ? '파일이 너무 큼' : e.slice(0, 40);
}

/** 한 공고 읽기 — 같은 공고번호의 다른 줄(원본 복사·워크인 수집)에도 같은 결과를 씀. 반환: 저장한 결과(공고가 없으면 null) */
export async function readEligibility(id: string, opt: { maxFiles?: number; vision?: boolean } = {}): Promise<Eligibility | null> {
  const sql = db();
  const [r0] = await sql<{ row: Row }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
  if (!r0) return null;
  const { noticeFiles, reasonOf } = await import('./autoAttach');
  const { fetchFile } = await import('./files');
  const src = await noticeFiles(id).catch((e) => ({ files: [] as SrcFile[], bid: null, listError: String((e as Error)?.message ?? e).slice(0, 80) }));
  const [r1] = await sql<{ row: Row }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`; // K-apt 목록을 읽으면 첨부 칸이 바뀜
  const row = r1?.row ?? r0.row; const prev = (row.eligibility ?? null) as Eligibility | null;
  const files = rankFiles(src?.files ?? []).slice(0, opt.maxFiles ?? 3);
  let found: { text: string; items: EligItem[]; line: string } | null = null; let used: SrcFile | null = null; let tried: SrcFile | null = null; const errs: string[] = [];
  const needDl = needsDocDeadline(row); let dl: { at: string; label: string } | null = null; // 259차
  let photo: { f: SrcFile; doc: PhotoDoc } | null = null; let by: 'vision' | undefined; let visionUsd: number | undefined; let visionDone = false; let visionSkip = false;
  for (const f of files) {
    tried = tried ?? f;
    try {
      let text: string | null = null; let terr: string | null = null;
      const ref = `salesfile:${sha256(f.url).slice(0, 40)}`;
      const [lib] = await sql<{ text_content: string | null }[]>`select text_content from library_files where ext_ref = ${ref} and source = 'sales_auto' and deleted_at is null and text_content is not null limit 1`; // 업무로 넘길 때 받아 둔 같은 공고 첨부(공개 공고문)
      if (lib?.text_content) text = lib.text_content;
      else { const got = await fetchFile(f.url, f.name, { bid: src?.bid ?? null }); const x = await extractTextResult(got.data, got.fileName, got.mime); text = x.text; terr = x.text ? null : fileErr(x.error, got.data, got.fileName); f.name = f.name ?? got.fileName;
        if (terr === PHOTO_ONLY && !photo) photo = { f, doc: { data: got.data, fileName: got.fileName, mime: got.mime } }; }
      if (!text) { errs.push(terr ?? '본문 글자 없음'); continue; }
      if (needDl && !dl) dl = docDeadline(text, row.posted_date ? String(row.posted_date) : null);
      found = eligibilityOf(text, row); used = f;
      if (found) break;
      errs.push('참가자격 절 없음');
    } catch (e) { errs.push(`공고문 못 받음(${reasonOf(e)})`); }
  }
  // #790 글자가 없는 공고문(사진·스캔)은 AI 비전으로 — 공고당 한 번(첨부가 바뀌면 다시), 회사 AI 예산 안. 읽었는지는 같은 첨부(sig)에 visionUsd 가 있는지로(못 읽은 횟수 tries 와 따로)
  const sigNow = filesSig(row); const visionBefore = prev?.sig === sigNow && prev?.visionUsd != null;
  if (!found && photo && visionBefore) { // 이미 사진으로 읽은 공고 — 다시 부르지 않고 그 글을 씀([공고문 다시 읽기]도)
    visionUsd = prev!.visionUsd;
    if (prev!.text) { found = { text: prev!.text, items: eligibilityItems(prev!.text), line: lineOf(prev!.text, row) }; used = photo.f; by = 'vision'; }
    else errs.push('사진에서도 참가자격 절을 못 찾음');
  } else if (!found && photo && opt.vision !== false) {
    try {
      const v = await visionRead(photo.doc, String(row.title ?? ''));
      if ('skip' in v) { visionSkip = true; errs.push(`AI 사진 읽기 안 함: ${v.skip}`); }
      else {
        visionDone = true; visionUsd = v.usd;
        const sec = v.text ? eligibilitySection(v.text) ?? v.text : null;
        if (sec) { found = eligibilityOf(sec, row) ?? { text: sec.slice(0, 1500), items: eligibilityItems(sec), line: lineOf(sec, row) }; used = photo.f; by = 'vision'; }
        else errs.push('사진에서도 참가자격 절을 못 찾음');
      }
    } catch (e) { errs.push(`AI 사진 읽기 못함(${String((e as Error)?.message ?? e).slice(0, 40)})`); }
  }
  const prevTries = prev && !prev.text && prev.sig === sigNow ? prev.tries ?? 0 : 0;
  const extra = apiExtra(row, []);
  const error = found ? null : !files.length ? (src?.listError ? '첨부 목록을 못 읽음' : '첨부 공고문 없음') : [...new Set(errs)].join(' · ').slice(0, 160) || '공고문에서 참가자격 절을 못 찾음';
  const out: Eligibility = { text: found?.text ?? null, items: found?.items ?? [], line: found?.line ?? (extra.length ? extra.join(' · ') : null), error, file: (used ?? tried) ? { name: (used ?? tried)!.name, url: (used ?? tried)!.url } : null, // 못 읽었어도 어떤 파일을 봤는지
    readAt: new Date().toISOString(), sig: sigNow, tries: found ? 0 : visionDone || visionBefore ? 3 : visionSkip ? prevTries : prevTries + 1, // 사진 읽기를 한 공고는 첨부가 바뀔 때까지 다시 안 함 · 설정 이유로 건너뛴 것은 세지 않음
    ...(by ? { by } : {}), ...(visionUsd != null ? { visionUsd } : {}), ...(needDl ? { dl: { at: dl?.at ?? null, label: dl ? jsonSafe(dl.label) : null } } : {}) };
  out.text = jsonSafe(out.text); out.line = jsonSafe(out.line); out.error = jsonSafe(out.error); out.items = out.items.map((x) => ({ ...x, label: jsonSafe(x.label) })); // 257차: 저장 실패 막기
  const st = String(row.source_type ?? ''); const ext = String(row.source_external_id ?? '');
  // 259차: 공고문에서 제출 마감을 찾으면 마감으로(deadline_src 'doc' — 다음 수집의 임시 마감이 덮지 않음, API 에 진짜 입찰 마감이 오면 그것으로)
  const dlPatch = dl ? { deadline_at: dl.at, deadline_src: 'doc', doc_deadline_label: jsonSafe(dl.label) } : {};
  await sql`update sales_src_rows set row = row || ${sql.json({ eligibility: out, ...dlPatch } as never)}::jsonb where scope = 'global' and tbl = 'procurement_notices'
    and (src_id = ${id} ${st && ext ? sql`or (row->>'source_type' = ${st} and row->>'source_external_id' = ${ext})` : sql``})`; // synced_at 은 그대로(메일 '고침'으로 안 셈)
  return out;
}

/** 읽을 차례 — 처음·첨부 바뀜(정정)·못 읽고 20시간 지남(3번까지) */
export function eligibilityDue(r: Row, now = Date.now()): boolean {
  const e = r.eligibility as Eligibility | undefined;
  if (!e) return true;
  if (e.sig !== filesSig(r)) return true;
  if (needsDocDeadline(r) && !e.dl) return true; // 259차: 입찰 마감이 없는 공고는 공고문 제출 마감을 한 번 찾아봄(예전에 읽은 공고도)
  if (e.text && e.by !== 'vision' && !eligibilitySection(e.text)) return true; // 256차: 예전 규칙으로 잘못 자른 절(등록 절차 안내 등)은 다시 읽음
  return !e.text && (e.tries ?? 0) < 3 && now - Date.parse(e.readAt ?? '') > 20 * 3600e3;
}
/** 258차(로컬 10/29 09:20 ⓑ): 마감일 칸이 빈 관련 공고도 목록 '진행 중'에 보이므로 읽음 — 원천 목록에서 최근 30일 안에 본 것만(오래 안 보인 줄은 빼고) */
const NO_DEADLINE_DAYS = 30;
const seenSince = (today: string) => kstDay(new Date(Date.parse(`${today}T12:00:00+09:00`) - NO_DEADLINE_DAYS * 864e5));
/** 257차: 정기 실행이 읽는 공고인지(아래 tick 의 조건과 같음) — 아니면 이유. 공고 조회에서 '왜 아직 안 읽혔나' */
export function eligibilityOutOfScope(r: Row, gone = false, today = kstDay()): string | null {
  if (gone) return '사라짐·합쳐짐 줄';
  if (String(r.related ?? 'false') !== 'true') return '관련 공고 아님';
  const dl = String(r.deadline_at ?? '').slice(0, 10);
  if (!dl && String(r.last_seen_at ?? r.first_seen_at ?? '').slice(0, 10) < seenSince(today)) return `마감일 칸 없음 · 원천 목록에서 ${NO_DEADLINE_DAYS}일 넘게 안 보임`;
  if (dl && dl < today) return '마감 지남';
  if (/취소|낙찰|유찰|개찰/.test(String(r.current_status ?? ''))) return `상태 '${r.current_status}'`;
  if (r.kapt_cancel_at) return 'K-apt 취소';
  return null;
}
/** 정기 실행(tick) — 열린 관련 공고(마감 전·취소/낙찰/유찰 아님)를 마감 가까운 순으로 한 건씩(K-apt 는 빠른 연속 요청을 끊음). SALES_ELIGIBILITY=off 면 안 돎 */
export async function eligibilityTick(o: { budgetMs?: number; max?: number } = {}) {
  if (process.env.SALES_ELIGIBILITY === 'off') return { skipped: 'off' };
  const sql = db(); const t0 = Date.now(); const budget = o.budgetMs ?? 25_000; const max = o.max ?? (Number(process.env.SALES_ELIGIBILITY_MAX) || 6);
  const rows = await sql<{ src_id: string; row: Row }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
    and coalesce(row->>'related', 'false') = 'true'
    and (left(coalesce(row->>'deadline_at', ''), 10) >= ${kstDay()} or (coalesce(row->>'deadline_at', '') = '' and left(coalesce(row->>'last_seen_at', row->>'first_seen_at', ''), 10) >= ${seenSince(kstDay())}))
    and coalesce(row->>'current_status', '') !~ '취소|낙찰|유찰|개찰' and coalesce(row->>'kapt_cancel_at', '') = ''
    order by nullif(row->>'deadline_at', '') asc nulls last limit 400`; // 마감일 없는 공고는 마감 있는 공고 뒤
  const seen = new Set<string>(); const due: string[] = [];
  for (const r of rows) {
    const key = r.row.source_type && r.row.source_external_id ? `${r.row.source_type}:${r.row.source_external_id}` : r.src_id;
    if (seen.has(key)) continue; seen.add(key);
    if (eligibilityDue(r.row)) due.push(r.src_id);
  }
  let done = 0, found = 0; const tried: string[] = [];
  const noOf = (id: string) => { const r = rows.find((x) => x.src_id === id)?.row; return String(r?.source_external_id ?? id).slice(0, 24); };
  for (const id of due) {
    if (done >= max || Date.now() - t0 > budget) break;
    // 257차(로컬 10/29 08:45 '안 읽은 6건이 정기 실행에서 계속 남음'): 읽다 오류가 나면 저장되지 않아 마감 순 맨 앞에 남고 다음 실행도 같은 공고만 — 오류 이유를 저장해 20시간 뒤 다시(다른 공고가 차례를 받음)
    const e = await readEligibility(id).catch(async (err) => {
      const msg = jsonSafe(String((err as Error)?.message ?? err).slice(0, 80));
      const r = rows.find((x) => x.src_id === id)?.row; const prev = r?.eligibility as Eligibility | undefined;
      const fail: Eligibility = { text: null, items: [], line: null, error: `읽기 오류: ${msg}`, file: null, readAt: new Date().toISOString(), sig: r ? filesSig(r) : '', tries: (prev && !prev.text ? prev.tries ?? 0 : 0) + 1,
        ...(r && needsDocDeadline(r) ? { dl: { at: null, label: null } } : {}) }; // 259차: 오류 난 공고가 '마감 찾기'로 매번 다시 앞자리에 서지 않게
      await sql`update sales_src_rows set row = row || ${sql.json({ eligibility: fail } as never)}::jsonb where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`.catch(() => {});
      tried.push(`${noOf(id)} 오류(${msg.slice(0, 40)})`); return null;
    }); done++;
    if (e?.text) { found++; tried.push(`${noOf(id)} 절 찾음`); } else if (e) tried.push(`${noOf(id)} ${String(e.error ?? '못 찾음').slice(0, 40)}`);
  }
  return { open: seen.size, due: due.length, done, found, tried, waiting: due.slice(done, done + 10).map(noOf) }; // job_runs 기록에 이번에 읽은 공고·결과와 다음 차례
}
