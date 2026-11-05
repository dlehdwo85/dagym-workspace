// 252차 #786(대표 10/29 00:20): 입찰 공고의 첨부 공고문(hwp·hwpx·pdf·docx)을 받아 글을 뽑고 '참가자격' 절을 잘라 공고 줄에 저장한다(원문 1,500자 + 규칙으로 뽑은 요건 + 화면 한 줄).
// AI·비용 없음. 파일은 자료실에 저장하지 않고 글만 읽는다(이미 자료실에 받아 둔 같은 주소 파일이 있으면 그 글을 씀). 나라장터는 API 의 업종 제한·참가 지역을 한 줄에 합친다.
// 정기 실행: 열린 관련 공고 중 아직 안 읽었거나 첨부가 바뀐 것(정정 공고)·못 읽은 것(20시간 뒤, 3번까지)을 마감 가까운 순으로 한 번에 몇 건씩.
import { sha256 } from '../crypto';
import { db } from '../db';
import { extractTextResult, unzip } from '../textExtract';
import { aiLongDue, apiExtra, commonOnly, docDeadline, eligibilityItems, eligibilityLine, eligibilitySection, jsonSafe, lineOf, needsAiItems, SEC_LONG, SEC_MAX, textSig, type EligAi, type EligItem } from './eligibilityText';
import { visionRead, type PhotoDoc } from './eligibilityVision';
import { sourceFiles, type SrcFile } from './files';

export type Eligibility = { text: string | null; items: EligItem[]; line: string | null; error: string | null; file: { name: string | null; url: string } | null; readAt: string; sig: string; tries: number; /** 350차 #938: 읽을 때 본 자료실 사본·업무 첨부 공고문 id(새 문서가 올라오면 다시 읽음) */ ldocs?: string[];
  /** 253차 #790 사진 공고문을 AI 비전으로 읽음(숫자는 원문 확인) */ by?: 'vision'; visionUsd?: number;
  /** 259차: 입찰 마감이 없는 공고(임시 마감·마감 칸 빔)에서 공고문의 제출 마감을 찾아봄 — 찾았으면 그 글줄 */ dl?: { at: string | null; label: string | null };
  /** 262차: 규칙으로 항목을 못 뽑은 절을 빠른 AI 가 정리한 항목(절 지문 sig 가 같을 때만 씀) */ ai?: EligAi;
  /** 264차: 저장한 절이 1,500자에서 잘렸을 때 공고문에서 다시 자른 더 긴 절(AI 에 줌·다시 정리할 때 씀) · 그 시도를 한 시각(공고문을 다시 받는 것은 한 번만) */ longText?: string; aiLongTry?: string };
/** 259차: 마감 칸이 비었거나 공동수급협정 마감(임시)인 공고 — 공고문에서 제안서·입찰서 제출 마감을 찾음 */
export const needsDocDeadline = (r: Row) => !String(r.deadline_at ?? '') || r.deadline_src === 'agreement';
type Row = Record<string, any>;
const kstDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

/** 공고 줄의 첨부 목록 지문 — 정정 공고로 첨부가 바뀌면 다시 읽음 */
export function filesSig(r: Row): string {
  const urls = sourceFiles(r.attachment_urls ?? r.attachments, r.notice_file_url).map((f) => f.url).sort();
  return urls.length ? sha256(urls.join('\n')).slice(0, 16) : '';
}
type Sql = ReturnType<typeof db>;
/** 350차(대표 11/04 #938 천안푸르지오레이크사이드 — 공고문이 KG2B 에만 있고 K-apt 첨부는 없음 · 사람이 업무·자료실에 올린 공고문도 읽기): 원천 첨부 밖의 공고문 후보
 *  ① 이 공고(같은 번호 줄 포함)의 자동 첨부 사본(자료실 sales_auto, meta.id = 공고 줄) ② 이 공고에서 만든 업무에 사람이 올린 hwp·hwpx·pdf·docx 첨부(자료실 문서를 연결한 것은 그 글) */
export type LocalDoc = { kind: 'lib' | 'att'; id: string; name: string; key: string | null; mime: string | null; text: string | null; url: string };
export async function localDocs(sql: Sql, ids: string[]): Promise<LocalDoc[]> {
  if (!ids.length) return [];
  type F = { id: string; file_name: string; storage_key: string | null; mime_type: string | null; text_content: string | null };
  const libs = await sql<F[]>`select id, file_name, storage_key, mime_type, text_content from library_files
    where deleted_at is null and upload_status = 'ready' and source = 'sales_auto' and meta->>'id' = any(${ids}::text[]) order by created_at desc limit 5`.catch(() => [] as F[]);
  const atts = await sql<F[]>`select a.id, a.file_name, a.storage_key, a.mime_type, lf.text_content
    from attachments a join tasks t on t.id = a.task_id left join library_files lf on lf.id = a.doc_id
    where t.deleted_at is null and t.sales_ref->>'kind' = 'bid' and t.sales_ref->>'id' = any(${ids}::text[]) and a.deleted_at is null and a.kind = 'file' and a.upload_status = 'ready'
      and coalesce(a.source, 'upload') <> 'sales_auto' and a.file_name ~* '\\.(hwpx?|pdf|docx?)$' order by a.created_at desc limit 6`.catch(() => [] as F[]);
  const docs: LocalDoc[] = [...libs.map((f) => ({ kind: 'lib' as const, id: String(f.id), name: f.file_name, key: f.storage_key, mime: f.mime_type, text: f.text_content, url: `/api/library/${f.id}/download` })),
    ...atts.map((f) => ({ kind: 'att' as const, id: String(f.id), name: f.file_name, key: f.storage_key, mime: f.mime_type, text: f.text_content, url: `/api/attachments/${f.id}/download` }))];
  return docs.sort((a, b) => (/공고/.test(b.name) ? 1 : 0) - (/공고/.test(a.name) ? 1 : 0)).slice(0, 4);
}
/** 정기 실행용: 공고 줄(src_id)마다 지금 있는 자료실 사본·업무 첨부 공고문 id — 저장된 ldocs 에 없는 것이 생기면 다시 읽을 차례 */
export async function localDocIds(sql: Sql, ids: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>(); if (!ids.length) return m;
  const add = (k: string, v: string) => { if (!m.has(k)) m.set(k, []); m.get(k)!.push(v); };
  type R = { nid: string; id: string };
  for (const r of await sql<R[]>`select meta->>'id' as nid, id::text as id from library_files where deleted_at is null and upload_status = 'ready' and source = 'sales_auto' and meta->>'id' = any(${ids}::text[])`.catch(() => [] as R[])) add(r.nid, r.id);
  for (const r of await sql<R[]>`select t.sales_ref->>'id' as nid, a.id::text as id from attachments a join tasks t on t.id = a.task_id
    where t.deleted_at is null and t.sales_ref->>'kind' = 'bid' and t.sales_ref->>'id' = any(${ids}::text[]) and a.deleted_at is null and a.kind = 'file' and a.upload_status = 'ready'
      and coalesce(a.source, 'upload') <> 'sales_auto' and a.file_name ~* '\\.(hwpx?|pdf|docx?)$'`.catch(() => [] as R[])) add(r.nid, r.id);
  return m;
}
/** 350차 #938 ③: 자동 읽기가 3번 실패해 멈춘 공고 */
export const eligFailed = (e: Eligibility | null | undefined) => !!e && !e.text && Number(e.tries ?? 0) >= 3;
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
  return { text: sec, items, line: eligibilityLine(items, sec, apiExtra(r, items)) ?? commonOnly(sec) };
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
export async function readEligibility(id: string, opt: { maxFiles?: number; vision?: boolean; ai?: boolean } = {}): Promise<Eligibility | null> {
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
  let full: string | null = null; // 264차: 절을 찾은 공고문 글 전체(잘린 절을 더 길게 다시 자를 때)
  const needDl = needsDocDeadline(row); let dl: { at: string; label: string } | null = null; // 259차
  let photo: { f: SrcFile; doc: PhotoDoc } | null = null; let by: 'vision' | undefined; let visionUsd: number | undefined; let visionDone = false; let visionSkip = false; let visionStop: unknown = null;
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
      if (found) { full = text; break; }
      errs.push('참가자격 절 없음');
    } catch (e) { errs.push(`공고문 못 받음(${reasonOf(e)})`); }
  }
  // 350차 #938: 원천 첨부에서 못 찾았으면(첨부 없음 포함) 이 공고의 자료실 사본·업무에 올린 공고문에서
  const st0 = String(row.source_type ?? ''), ext0 = String(row.source_external_id ?? '');
  const groupIds = [id, ...(st0 && ext0 ? (await sql<{ src_id: string }[]>`select src_id from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id <> ${id} and row->>'source_type' = ${st0} and row->>'source_external_id' = ${ext0}`).map((x) => x.src_id) : [])];
  const local = await localDocs(sql, groupIds); const ldocs = local.map((d) => d.id);
  if (!found) for (const d of local) {
    try {
      let text = d.text;
      if (!text && d.key) { const { getObject } = await import('../storage'); const buf = await getObject(d.key); const x = await extractTextResult(buf, d.name, d.mime ?? 'application/octet-stream'); text = x.text; if (!text) { errs.push(`${d.name}: ${fileErr(x.error, buf, d.name)}`); continue; } }
      if (!text) { errs.push(`${d.name}: 글 없음`); continue; }
      tried = tried ?? { url: d.url, name: d.name };
      if (needDl && !dl) dl = docDeadline(text, row.posted_date ? String(row.posted_date) : null);
      found = eligibilityOf(text, row);
      if (found) { full = text; used = { url: d.url, name: d.name }; break; }
      errs.push(`${d.name}: 참가자격 절 없음`);
    } catch (e) { errs.push(`${d.name}: 못 읽음(${String((e as Error)?.message ?? e).slice(0, 40)})`); }
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
        if (sec) { found = eligibilityOf(sec, row) ?? { text: sec.slice(0, 1500), items: eligibilityItems(sec), line: lineOf(sec, row) }; used = photo.f; by = 'vision'; full = v.text; }
        else errs.push('사진에서도 참가자격 절을 못 찾음');
      }
    } catch (e) {
      // 371차 #994: 회사 예산·요청 수·크레딧 막힘은 시도 횟수(최대 3)로 세지 않음 — 정상으로 돌아오면 다시 읽음 · '못 함' 기록
      if ((await import('../ai/guard')).isAiStop(e)) { visionSkip = true; visionStop = e; errs.push(`AI 사진 읽기 미룸 — 한도·크레딧(${String((e as Error)?.message ?? e).slice(0, 40)})`); }
      else errs.push(`AI 사진 읽기 못함(${String((e as Error)?.message ?? e).slice(0, 40)})`);
    }
  }
  const prevTries = prev && !prev.text && prev.sig === sigNow ? prev.tries ?? 0 : 0;
  const extra = apiExtra(row, []);
  const error = found ? null : !files.length && !local.length ? (src?.listError ? '첨부 목록을 못 읽음' : '첨부 공고문 없음') : [...new Set(errs)].join(' · ').slice(0, 160) || '공고문에서 참가자격 절을 못 찾음';
  // 264차: 더 긴 절을 AI 에 주려고 다시 읽은 것뿐인데 공고문을 못 받았으면 — 전 결과 그대로(시도 시각만)
  const longOnly = !found && !!prev?.text && prev.sig === sigNow && aiLongDue(prev);
  const out: Eligibility = longOnly ? { ...prev!, aiLongTry: new Date().toISOString() } : { text: found?.text ?? null, items: found?.items ?? [], line: found?.line ?? (extra.length ? extra.join(' · ') : null), error, file: (used ?? tried) ? { name: (used ?? tried)!.name, url: (used ?? tried)!.url } : null, // 못 읽었어도 어떤 파일을 봤는지
    readAt: new Date().toISOString(), sig: sigNow, ldocs, tries: found ? 0 : visionDone || visionBefore ? 3 : visionSkip ? prevTries : prevTries + 1, // 사진 읽기를 한 공고는 첨부가 바뀔 때까지 다시 안 함 · 설정 이유로 건너뛴 것은 세지 않음
    ...(by ? { by } : {}), ...(visionUsd != null ? { visionUsd } : {}), ...(needDl ? { dl: { at: dl?.at ?? null, label: dl ? jsonSafe(dl.label) : null } } : {}) };
  // 262차: 규칙으로 항목을 못 뽑은 절은 빠른 AI 로 정리(같은 절이면 전에 정리한 것을 그대로 — 다시 부르지 않음)
  if (out.text && needsAiItems(out.text)) {
    const keep = prev?.ai && prev.ai.sig === textSig(out.text) ? prev.ai : null;
    const { aiItemsDue, aiItemsFor } = await import('./eligibilityAi');
    // 264차: 절이 1,500자에서 잘렸으면 공고문 글에서 4,000자까지 다시 잘라 AI 에(전에 짧은 절로 정리했으면 한 번 다시)
    const cut = !longOnly && out.text.length >= SEC_MAX;
    const longer = cut && full ? eligibilitySection(full, SEC_LONG) : null;
    const long = longer && longer.length > out.text.length ? jsonSafe(longer) : null;
    if (cut) { out.aiLongTry = new Date().toISOString(); if (long) out.longText = long; }
    out.ai = keep && !aiItemsDue({ text: out.text, ai: keep }) && (!long || keep.long) ? keep : opt.ai === false ? keep ?? undefined
      : await aiItemsFor(out.text, String(row.title ?? ''), keep, { long: long ?? out.longText }).catch(() => keep ?? undefined);
    if (out.ai?.items.length) out.line = eligibilityLine(out.ai.items, out.text, apiExtra(row, out.ai.items));
  }
  out.text = jsonSafe(out.text); out.line = jsonSafe(out.line); out.error = jsonSafe(out.error); out.items = out.items.map((x) => ({ ...x, label: jsonSafe(x.label) })); // 257차: 저장 실패 막기
  if (out.ai) out.ai = { ...out.ai, items: out.ai.items.map((x) => ({ ...x, label: jsonSafe(x.label) })) };
  const st = String(row.source_type ?? ''); const ext = String(row.source_external_id ?? '');
  // 259차: 공고문에서 제출 마감을 찾으면 마감으로(deadline_src 'doc' — 다음 수집의 임시 마감이 덮지 않음, API 에 진짜 입찰 마감이 오면 그것으로)
  const dlPatch = dl ? { deadline_at: dl.at, deadline_src: 'doc', doc_deadline_label: jsonSafe(dl.label) } : {};
  await sql`update sales_src_rows set row = row || ${sql.json({ eligibility: out, ...dlPatch } as never)}::jsonb where scope = 'global' and tbl = 'procurement_notices'
    and (src_id = ${id} ${st && ext ? sql`or (row->>'source_type' = ${st} and row->>'source_external_id' = ${ext})` : sql``})`; // synced_at 은 그대로(메일 '고침'으로 안 셈)
  await noteElig(sql, id, String(row.title ?? ''), { vision: visionStop ? 'stop' : visionDone ? 'done' : null, stopErr: visionStop, ai: out.ai });
  return out;
}

/** 371차 #994: 사진 읽기·AI 항목 정리가 한도·크레딧에 막히면 '못 함', 다시 되면 '다시 채움'(공용 공고 = tenant 'global') */
async function noteElig(sql: Sql, id: string, title: string, s: { vision: 'stop' | 'done' | null; stopErr?: unknown; ai?: { skip?: string | null; error?: string | null; items: unknown[] } | null }) {
  const SK = await import('../ai/skips');
  if (s.vision === 'stop') await SK.noteSkip(sql, 'global', 'eligibility_vision', id, title, s.stopErr ?? { code: 'ai_stop', message: '사진 공고문 읽기 — AI 한도·크레딧' });
  else if (s.vision === 'done') await SK.noteDone(sql, 'global', 'eligibility_vision', [id]);
  if (s.ai?.skip && /^AI 예산·한도/.test(s.ai.skip)) await SK.noteSkip(sql, 'global', 'eligibility_ai', id, title, { code: 'ai_stop', message: s.ai.skip });
  else if (s.ai && !s.ai.skip && !s.ai.error) await SK.noteDone(sql, 'global', 'eligibility_ai', [id]);
}

/** 262차: 공고문을 다시 받지 않고 저장한 절만으로 AI 항목 정리(정기 실행 — 예전에 읽은 공고). 같은 공고번호의 다른 줄에도 씀 */
export async function fillAiItems(id: string): Promise<EligAi | null> {
  const sql = db();
  const [r] = await sql<{ row: Row }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
  const e = r?.row?.eligibility as Eligibility | undefined;
  if (!e?.text || !needsAiItems(e.text)) return null;
  const ai = await (await import('./eligibilityAi')).aiItemsFor(e.text, String(r.row.title ?? ''), e.ai, { long: e.longText });
  const safe = { ...ai, items: ai.items.map((x) => ({ ...x, label: jsonSafe(x.label) })) };
  const line = safe.items.length ? jsonSafe(eligibilityLine(safe.items, e.text, apiExtra(r.row, safe.items))) : e.line;
  const st = String(r.row.source_type ?? ''); const ext = String(r.row.source_external_id ?? '');
  await sql`update sales_src_rows set row = jsonb_set(jsonb_set(row, '{eligibility,ai}', ${sql.json(safe as never)}::jsonb), '{eligibility,line}', to_jsonb(${line ?? null}::text))
    where scope = 'global' and tbl = 'procurement_notices' and row ? 'eligibility' and row->'eligibility'->>'text' = ${e.text}
    and (src_id = ${id} ${st && ext ? sql`or (row->>'source_type' = ${st} and row->>'source_external_id' = ${ext})` : sql``})`;
  await noteElig(sql, id, String(r.row.title ?? ''), { vision: null, ai: safe });
  return safe;
}

/** 읽을 차례 — 처음·첨부 바뀜(정정)·못 읽고 20시간 지남(3번까지) */
export function eligibilityDue(r: Row, now = Date.now(), ldocIds?: string[]): boolean {
  const e = r.eligibility as Eligibility | undefined;
  if (!e) return true;
  if (e.sig !== filesSig(r)) return true;
  if (ldocIds?.some((x) => !(e.ldocs ?? []).includes(x))) return true; // 350차 #938 ①·④: 자료실 사본·업무 첨부에 공고문이 새로 생김
  if (needsDocDeadline(r) && !e.dl) return true; // 259차: 입찰 마감이 없는 공고는 공고문 제출 마감을 한 번 찾아봄(예전에 읽은 공고도)
  if (e.text && e.by !== 'vision' && !eligibilitySection(e.text)) return true; // 256차: 예전 규칙으로 잘못 자른 절(등록 절차 안내 등)은 다시 읽음
  if (aiLongDue(e)) return true; // 264차: 1,500자에서 잘렸고 규칙으로 못 뽑은 절 — AI 에 더 긴 절을 주려고 한 번 다시 읽음
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
  const lmap = await localDocIds(sql, rows.map((r) => r.src_id)); // 350차 #938
  for (const r of rows) {
    const key = r.row.source_type && r.row.source_external_id ? `${r.row.source_type}:${r.row.source_external_id}` : r.src_id;
    if (seen.has(key)) continue; seen.add(key);
    if (eligibilityDue(r.row, Date.now(), lmap.get(r.src_id))) due.push(r.src_id);
  }
  // 262차: 예전에 읽은 공고 중 규칙으로 항목을 못 뽑은 것 — 공고문을 다시 받지 않고 AI 항목 정리만(공고당 한 번)
  const { aiItemsDue } = await import('./eligibilityAi');
  const aiDue = rows.filter((r) => seen.has(r.row.source_type && r.row.source_external_id ? `${r.row.source_type}:${r.row.source_external_id}` : r.src_id) && !due.includes(r.src_id) && aiItemsDue(r.row.eligibility))
    .filter((r, i, a) => a.findIndex((x) => (x.row.source_external_id ?? x.src_id) === (r.row.source_external_id ?? r.src_id)) === i).map((r) => r.src_id);
  let done = 0, found = 0; const tried: string[] = [];
  const noOf = (id: string) => { const r = rows.find((x) => x.src_id === id)?.row; return String(r?.source_external_id ?? id).slice(0, 24); };
  for (const id of due) {
    if (done >= max || Date.now() - t0 > budget) break;
    // 257차(로컬 10/29 08:45 '안 읽은 6건이 정기 실행에서 계속 남음'): 읽다 오류가 나면 저장되지 않아 마감 순 맨 앞에 남고 다음 실행도 같은 공고만 — 오류 이유를 저장해 20시간 뒤 다시(다른 공고가 차례를 받음)
    const e = await readEligibility(id).catch(async (err) => {
      const msg = jsonSafe(String((err as Error)?.message ?? err).slice(0, 80));
      const r = rows.find((x) => x.src_id === id)?.row; const prev = r?.eligibility as Eligibility | undefined;
      const fail: Eligibility = prev?.text && r && prev.sig === filesSig(r) && aiLongDue(prev) ? { ...prev, aiLongTry: new Date().toISOString() } // 264차: 더 긴 절 읽기만 실패 — 전 결과 그대로
        : { text: null, items: [], line: null, error: `읽기 오류: ${msg}`, file: null, readAt: new Date().toISOString(), sig: r ? filesSig(r) : '', tries: (prev && !prev.text ? prev.tries ?? 0 : 0) + 1,
        ...(r && needsDocDeadline(r) ? { dl: { at: null, label: null } } : {}) }; // 259차: 오류 난 공고가 '마감 찾기'로 매번 다시 앞자리에 서지 않게
      await sql`update sales_src_rows set row = row || ${sql.json({ eligibility: fail } as never)}::jsonb where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`.catch(() => {});
      tried.push(`${noOf(id)} 오류(${msg.slice(0, 40)})`); return null;
    }); done++;
    if (e?.text) { found++; tried.push(`${noOf(id)} 절 찾음`); } else if (e) tried.push(`${noOf(id)} ${String(e.error ?? '못 찾음').slice(0, 40)}`);
  }
  let aiDone = 0;
  for (const id of aiDue) {
    if (aiDone >= max || Date.now() - t0 > budget) break;
    const a = await fillAiItems(id).catch((err) => { tried.push(`${noOf(id)} AI 항목 오류(${String((err as Error)?.message ?? err).slice(0, 40)})`); return null; }); aiDone++;
    if (a) tried.push(`${noOf(id)} AI 항목 ${a.items.length}개${a.skip ? `(건너뜀: ${a.skip.slice(0, 30)})` : a.error ? `(오류: ${a.error.slice(0, 30)})` : ''}`);
  }
  return { open: seen.size, due: due.length, done, found, aiDue: aiDue.length, aiDone, tried, waiting: due.slice(done, done + 10).map(noOf) }; // job_runs 기록에 이번에 읽은 공고·결과와 다음 차례
}
