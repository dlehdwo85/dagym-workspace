// #507(대표 10/23 15:50): 영업 DB(입찰 공고·지원사업)에서 업무로 넘어오면 그 공고의 첨부를 서버가 받아 자료실 '영업/공고/<공고명 앞 40자>'에
// 한 번만 저장하고(같은 주소 = 같은 자료) 업무마다 연결한다(출처 '공고 첨부(자동)'). 받는 규칙은 공고 첨부 중계와 같다(허용 공공 사이트·https·리다이렉트 금지·파일당 30MB).
// 업무 만들기는 막지 않는다 — 응답 뒤(after)에 돌고, 못 받은 파일은 업무 설명에 한 줄('공고 첨부 n건 중 m건 자동 첨부 실패(이유) — 공고문 내려받기: 링크').
import { after } from 'next/server';
import { sha256 } from '../crypto';
import { db } from '../db';
import { HttpError, badRequest } from '../errors';
import { tenantOf, type SessionUser } from '../types';
import { fetchFile } from './files';

export type SrcFile = { url: string; name: string | null };
export type SourceKind = 'bid' | 'support';
type Lib = { id: string; storage_key: string; file_name: string; mime_type: string; size_bytes: string | number; title: string };
const MAX_FILES = 10;
const kaptUrl = (bid: string, seq: string) => `https://www.k-apt.go.kr/bid/bidFileDown.do?bidNum=${encodeURIComponent(bid)}&fileSeq=${encodeURIComponent(seq)}`;

/** 원천 행의 첨부 칸(문자열 주소·{url|href, name}·JSON 글자) → 받을 목록. 화면용 중계 주소(/api/bids/…)는 원래 주소로 */
export function sourceFiles(...lists: unknown[]): SrcFile[] {
  const out: SrcFile[] = []; const seen = new Set<string>();
  for (const list of lists) {
    const arr = Array.isArray(list) ? list : typeof list === 'string' && list.startsWith('[') ? (() => { try { return JSON.parse(list) as unknown[]; } catch { return []; } })() : list ? [list] : [];
    for (const a of arr as any[]) {
      let url = typeof a === 'string' ? a : String(a?.url ?? a?.href ?? '');
      let name: string | null = a && typeof a === 'object' && a.name ? String(a.name) : null;
      if (url.startsWith('/api/bids/')) {
        const q = new URL(url, 'http://x').searchParams; name = name ?? q.get('n');
        url = q.get('u') ?? (q.get('bid') && q.get('seq') ? kaptUrl(q.get('bid')!, q.get('seq')!) : '');
      }
      url = url.trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url); out.push({ url, name: name?.trim() || null });
    }
  }
  return out.slice(0, MAX_FILES);
}

/** 원천의 이름·첨부·바로가기 */
async function sourceOf(tenant: string, kind: SourceKind, id: string): Promise<{ name: string; files: SrcFile[]; link: string } | null> {
  const sql = db();
  if (kind === 'bid') {
    const [r] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id} and not gone`;
    if (!r) return null;
    const row = r.row ?? {};
    const name = [row.complex_name ?? row.facility_name, row.title ?? row.notice_title ?? row.bid_name].filter(Boolean).join(' ').trim() || '공고';
    return { name, files: sourceFiles(row.attachment_urls ?? row.attachments, row.notice_file_url), link: `/s/sales/bids?tab=working&q=${encodeURIComponent(id)}` };
  }
  const [p] = await sql<{ title: string; attachments: any }[]>`select title, attachments from support_programs where id = ${id} and (tenant is null or tenant = ${tenant})`.catch(() => []);
  if (!p) return null;
  return { name: p.title || '지원사업', files: sourceFiles(p.attachments), link: `/s/sales/support?id=${id}` };
}

const reasonOf = (e: unknown) => e instanceof HttpError ? (e.status === 413 ? '30MB 넘음' : e.status === 403 ? '허용하지 않은 사이트' : /redirect/.test(e.code ?? '') ? '다른 주소로 넘어감' : e.code === 'file_page' ? '파일 대신 웹페이지(로그인·세션 필요)' : e.message.replace(/ — .*$/, '').slice(0, 60))
  : String((e as Error)?.message ?? e).slice(0, 60);
const fileLabel = (f: SrcFile) => f.name || (() => { try { return decodeURIComponent(new URL(f.url).pathname.split('/').pop() || '') || '첨부'; } catch { return '첨부'; } })();
const FAIL_RE = '\n?공고 첨부 [0-9]+건 중 [0-9]+건 자동 첨부 실패[^\n]*';

/**
 * 공고 첨부를 받아(자료실에 없을 때만) 업무들에 붙인다. 반환: 전체·성공·실패(이름·이유).
 * 이미 붙은 파일(같은 저장 파일)은 다시 붙이지 않고, 실패 줄은 매번 새로 씀(다시 눌러 성공하면 줄이 사라짐).
 */
export async function attachSourceFiles(u: SessionUser, i: { kind: SourceKind; id: string; taskIds: string[] }) {
  const t = tenantOf(u); const sql = db();
  const src = await sourceOf(t, i.kind, i.id);
  if (!src || !src.files.length || !i.taskIds.length) return { total: src?.files.length ?? 0, ok: 0, failed: [] as { name: string; reason: string }[] };
  const folder = `영업/공고/${src.name.replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)}`;
  const { saveGeneratedFile } = await import('../library');
  const libs: Lib[] = []; const failed: { name: string; reason: string }[] = [];
  for (const f of src.files) {
    const ref = `salesfile:${sha256(`${f.url}`).slice(0, 40)}`;
    try {
      let [lib] = await sql<Lib[]>`select id, storage_key, file_name, mime_type, size_bytes, title from library_files where tenant = ${t} and ext_ref = ${ref} and deleted_at is null and upload_status = 'ready' limit 1`;
      if (!lib) {
        const got = await fetchFile(f.url, f.name);
        const saved = await saveGeneratedFile(u, { fileName: got.fileName, mime: got.mime, data: got.data, title: got.fileName.replace(/\.[^.]+$/, '') || got.fileName, folder, tags: ['영업', '공고 첨부'],
          description: `${src.name} — 공고 첨부(자동)`, source: 'sales_auto', space: 'sales', extRef: ref, meta: { url: f.url, kind: i.kind, id: i.id } });
        lib = { id: saved.id, storage_key: saved.storageKey, file_name: got.fileName, mime_type: got.mime, size_bytes: got.data.length, title: got.fileName.replace(/\.[^.]+$/, '') || got.fileName };
      }
      libs.push(lib);
    } catch (e) { failed.push({ name: fileLabel(f), reason: reasonOf(e) }); }
  }
  const { activity } = await import('../log');
  const line = failed.length ? `\n공고 첨부 ${src.files.length}건 중 ${failed.length}건 자동 첨부 실패(${failed.map((x) => `${x.name}: ${x.reason}`).join(' · ').slice(0, 300)}) — 공고문 내려받기: ${src.link}` : '';
  for (const taskId of i.taskIds) {
    for (const lib of libs) {
      const [has] = await sql`select 1 from attachments where task_id = ${taskId} and storage_key = ${lib.storage_key} and deleted_at is null limit 1`;
      if (has) continue;
      await sql`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, doc_title, source, created_by)
        values (${taskId}, 'file', ${lib.storage_key}, ${lib.file_name}, ${lib.mime_type}, ${lib.size_bytes}, 'ready', ${lib.title}, 'sales_auto', ${u.id})`;
      await activity(sql, 'task', taskId, u.id, 'file_attached', { name: lib.file_name, size: Number(lib.size_bytes), from: 'sales_auto', folder });
    }
    await sql`update tasks set description = regexp_replace(coalesce(description, ''), ${FAIL_RE}, '', 'g') || ${line}, updated_at = now(), version = version + 1
      where id = ${taskId} and (coalesce(description, '') ~ ${FAIL_RE} or ${line} <> '')`;
  }
  return { total: src.files.length, ok: libs.length, failed };
}

/** 업무를 만든 요청의 응답 뒤에 돌린다(요청 밖이면 바로 뒤에서). 실패해도 업무에는 영향 없음 */
export function attachSourceFilesLater(u: SessionUser, i: { kind: SourceKind; id: string; taskIds: string[] }) {
  if (!i.taskIds.length) return;
  const run = () => attachSourceFiles(u, i).catch(async (e) => { await (await import('../log')).logError('sales-auto-attach', e, { kind: i.kind, id: i.id, taskIds: i.taskIds }).catch(() => {}); });
  try { after(run); } catch { void run(); }
}

/** 업무 상세 [공고 파일 붙이기] — 원천이 공고·지원사업인 업무(이미 만들어진 업무 채우기·실패 다시 시도). 업무를 볼 수 있는 사람이면 누구나 */
export async function attachTaskSourceFiles(u: SessionUser, taskId: string) {
  const { loadTaskForUser } = await import('../access');
  await loadTaskForUser(u, taskId);
  const [t] = await db()<{ sales_ref: any }[]>`select sales_ref from tasks where id = ${taskId}`;
  const ref = t?.sales_ref;
  if (!ref?.id || !['bid', 'support'].includes(String(ref.kind))) throw badRequest('공고·지원사업에서 넘어온 업무가 아닙니다');
  return attachSourceFiles(u, { kind: ref.kind as SourceKind, id: String(ref.id), taskIds: [taskId] });
}
