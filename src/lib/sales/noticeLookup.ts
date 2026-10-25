// #650(대표 10/25 23:20 'AI 세일즈가 온비드 공고문을 웹 검색으로 찾다 실패'): AI 세일즈 공고 도구 — 우리 영업 DB(수집한 공고 줄)의 원문·첨부를 웹 검색보다 먼저 읽는다.
// 첨부는 공고 첨부 중계·자동 첨부(#507)와 같은 규칙(허용 공공 사이트·https·리다이렉트 금지·30MB)으로 서버가 받아 자료실 '영업/공고/<공고명>'에 한 번만 저장(같은 주소 = 같은 ext_ref)하고 본문 글자를 뽑아 준다.
import { sha256 } from '../crypto';
import { db } from '../db';
import { badRequest, notFound } from '../errors';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { fetchFile, sourceFiles, type SrcFile } from './files';
import { salesBidsOn } from './options';
import { fixG2bUrl, searchHint } from './sourceLink';
import { SOURCE_LABEL } from './srcViews';

type Row = Record<string, any>;
const pick = (r: Row, ...keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v !== undefined && v !== null && v !== '') return v; } return null; };
const clipText = (v: unknown, n: number) => { const s = typeof v === 'string' ? v.replace(/\s+\n/g, '\n').trim() : v == null ? '' : String(v); return s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null; };
const filesOf = (r: Row): SrcFile[] => sourceFiles(r.attachment_urls ?? r.attachments, r.notice_file_url);
const titleOf = (r: Row) => String(pick(r, 'title', 'notice_title', 'bid_name', 'name') ?? '(제목 없음)');

async function loadRow(id: string): Promise<Row | null> {
  const [r] = await db()<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
  return r ? { ...r.row, __id: r.src_id } : null;
}
/** 목록용 요약(한국어 칸만, 영문 키 없음) — 바로 가는 주소가 없는 원천(온비드·국방 등)은 '공고번호 검색' 안내 */
function brief(r: Row) {
  const st = String(pick(r, 'source_type', 'source', 'source_code') ?? '');
  const raw = pick(r, 'source_url', 'url', 'detail_url', 'link');
  const hint = searchHint({ source: st, url: raw, externalId: pick(r, 'source_external_id'), noticeNo: pick(r, 'notice_no') });
  return {
    id: String(r.__id), title: titleOf(r), source: SOURCE_LABEL[st.toLowerCase()] ?? st, issuer: pick(r, 'issuer', 'agency', 'demand_agency', 'org_name'), noticeNo: pick(r, 'notice_no', 'source_external_id'),
    posted: pick(r, 'posted_date', 'notice_date', 'posted_at'), deadline: pick(r, 'deadline_at', 'close_at', 'deadline', 'participation_deadline_at'), opening: pick(r, 'opening_at', 'open_at'), status: pick(r, 'current_status', 'status'),
    url: hint ? null : fixG2bUrl(raw), search: hint ? `${hint.site}에서 ${hint.label} '${hint.no}' 검색 (${hint.home})` : null, attachments: filesOf(r).length,
  };
}

/** 영업 DB(수집한 공고 줄)에서 제목·공고번호·발주처·단지 이름으로 찾기 — 최신순 */
export async function searchNotices(u: SessionUser, q: string, limit = 8) {
  await assertSpace(u, 'sales');
  if (!(await salesBidsOn(tenantOf(u)))) return { items: [], note: '입찰·공고를 쓰지 않는 회사입니다' };
  const term = String(q ?? '').trim().replace(/\s+/g, ' ');
  if (term.length < 2) throw badRequest('찾을 말을 2자 이상 넣어 주세요');
  const like = `%${term}%`;
  const rows = await db()<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
    and (coalesce(row->>'title', row->>'notice_title', row->>'bid_name', '') ilike ${like} or coalesce(row->>'notice_no', '') ilike ${like} or coalesce(row->>'source_external_id', '') ilike ${like}
      or coalesce(row->>'issuer', '') ilike ${like} or coalesce(row->>'demand_agency', '') ilike ${like} or coalesce(row->>'complex_name', '') ilike ${like} or coalesce(row->>'facility_name', '') ilike ${like})
    order by coalesce(row->>'posted_date', row->>'first_seen_at', row->>'updated_at') desc nulls last limit ${Math.min(20, Math.max(1, Math.floor(limit) || 8))}`;
  return { items: rows.map((r) => brief({ ...r.row, __id: r.src_id })), note: rows.length ? '결과 id 로 read_sales_notice 를 부르면 상세·첨부 본문을 읽습니다' : '영업 DB 에 없는 공고 — 다른 말로 다시 찾거나, 그래도 없으면 웹에서 찾아 출처를 밝히세요' };
}

/** 첨부 한 개: 자료실에 같은 주소로 저장된 파일이 있으면 그 본문, 없으면 서버가 받아 자료실 '영업/공고/<공고명>'에 저장(본문 글자 추출은 저장 때) */
async function attachmentText(u: SessionUser, r: Row, f: SrcFile, k: number, bid: string | null) {
  const sql = db(); const t = tenantOf(u);
  const ref = `salesfile:${sha256(f.url).slice(0, 40)}`; // #507 자동 첨부와 같은 키 — 업무에 붙은 파일을 다시 받지 않음
  const [lib] = await sql<{ id: string; file_name: string; text_content: string | null; text_error: string | null }[]>`select id, file_name, text_content, text_error from library_files where tenant = ${t} and ext_ref = ${ref} and deleted_at is null and upload_status = 'ready' limit 1`;
  if (lib) return { name: lib.file_name, text: lib.text_content, note: lib.text_content ? null : (lib.text_error ?? '본문 글자 없음(그림·스캔본)'), libraryId: lib.id };
  const name = titleOf(r);
  const got = await fetchFile(f.url, f.name, { fallback: `${name.slice(0, 30).trim()} 첨부 ${k + 1}`, bid });
  const { saveGeneratedFile } = await import('../library');
  const saved = await saveGeneratedFile(u, { fileName: got.fileName, mime: got.mime, data: got.data, title: got.fileName.replace(/\.[^.]+$/, '') || got.fileName, folder: `영업/공고/${name.replace(/[\\/]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)}`,
    tags: ['영업', '공고 첨부'], description: `${name} — 공고 첨부(AI 세일즈가 읽음)`, source: 'sales_auto', space: 'sales', extRef: ref, meta: { url: f.url, kind: 'bid', id: r.__id } });
  const [row] = await sql<{ text_content: string | null; text_error: string | null }[]>`select text_content, text_error from library_files where id = ${saved.id}`;
  return { name: got.fileName, text: row?.text_content ?? null, note: row?.text_content ? null : (row?.text_error ?? '본문 글자 없음(그림·스캔본)'), libraryId: saved.id };
}

/** 공고 한 건의 상세(한국어 칸) + 첨부 본문(최대 3개, 합쳐 maxChars) */
export async function readNotice(u: SessionUser, id: string, opt: { maxFiles?: number; maxChars?: number } = {}) {
  await assertSpace(u, 'sales');
  if (!/^[\w.:-]{1,80}$/.test(id)) throw notFound('공고를 찾을 수 없습니다');
  const r = await loadRow(id);
  if (!r) throw notFound('공고를 찾을 수 없습니다');
  const b = brief(r);
  const detail = {
    ...b, contractMethod: pick(r, 'contract_method', 'award_method', 'bid_system', 'contract_type'), contractPeriod: pick(r, 'contract_period', 'contract_term', 'service_period'), category: pick(r, 'bid_category', 'notice_type', 'classification'),
    estimated: pick(r, 'estimated_amount', 'estimated_price', 'presumed_price', 'base_amount', 'budget', 'amount'), region: pick(r, 'region'), complex: pick(r, 'complex_name', 'facility_name', 'apartment_name'), households: pick(r, 'household_count', 'households'),
    taskScope: clipText(pick(r, 'task_scope', 'main_tasks', 'scope_of_work'), 2000), qualification: clipText(pick(r, 'qualification', 'participation_requirements', 'bid_qualification'), 2000), briefing: pick(r, 'site_briefing', 'pre_bid_meeting', 'site_meeting'),
    phone: pick(r, 'office_phone', 'management_phone', 'phone', 'contact_phone'), address: pick(r, 'office_address', 'address'), body: clipText(pick(r, 'notice_text', 'body', 'content', 'description', 'summary'), 6000),
    onbidIds: r.onbid_ids ?? null, // #650 온비드 번호들(cltrNo·pbctNo…) — 온비드 공고 검색 화면에서 공고번호로 찾을 때 참고
  };
  const all = filesOf(r); const list = all.slice(0, Math.max(0, Math.min(5, opt.maxFiles ?? 3)));
  const bid = String(pick(r, 'source_type') ?? '') === 'kapt_bid' ? (String(pick(r, 'source_external_id') ?? '') || null) : null;
  let budget = Math.max(1000, opt.maxChars ?? 20000);
  const files: { name: string; chars: number; text: string | null; note: string | null; libraryId?: string }[] = [];
  for (const [k, f] of list.entries()) {
    const t = await attachmentText(u, r, f, k, bid).catch((e) => ({ name: f.name ?? `첨부 ${k + 1}`, text: null as string | null, note: String((e as Error)?.message ?? e).slice(0, 120), libraryId: undefined as string | undefined }));
    const text = t.text ? t.text.slice(0, budget) : null;
    if (text) budget = Math.max(0, budget - text.length);
    files.push({ name: t.name, chars: t.text?.length ?? 0, text, note: t.note ?? null, ...(t.libraryId ? { libraryId: t.libraryId } : {}) });
  }
  return { ...detail, files, moreFiles: Math.max(0, all.length - list.length), note: '우리 영업 DB 에 저장된 원문·첨부입니다(첨부는 자료실 "영업/공고"에 저장됨). 여기 없는 내용은 지어내지 말고 원문 주소 또는 공고번호 검색으로 안내하세요.' };
}
