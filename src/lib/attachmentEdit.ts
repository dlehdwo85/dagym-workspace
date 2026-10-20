import * as Y from 'yjs';
import { z } from 'zod';
import { db } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { loadAttachment } from './attachments';
import { loadTaskForUser } from './access';
import { getObject, objectSize, putObject, uploadTarget, downloadUrl } from './storage';
import { unzip } from './textExtract';
import { writeDocx } from './docx';
import { fillXlsx, templateLayout, type CellEdit } from './docFill';
import { DOC_MIME, docMarkdown, loadYDoc } from './libDocs';
import { tenantOf, type SessionUser } from './types';

/**
 * 대표 10/20 23:05 "파일을 업무에 올리면 열어서 요청자·담당자들이 고치고 저장" — 외부 유료 편집기 없이 워크인 안에서.
 * ① docx → [열어서 편집]: 1회 변환해 워크인 문서(Tiptap+Yjs 공동 편집)로, 업무 참여자(요청자·담당자·협업자·검토자)에게 편집 공유. [업무로 저장]하면 Word 로 다시 써서 첨부 새 버전.
 * ② xlsx → [칸 고치기]: 서식·수식·병합은 그대로 두고 값만 바꿔 새 버전(docFill.fillXlsx).
 * ③ 그 밖(hwp·pdf·이미지·pptx…) → [새 버전 올리기]: 내려받아 고친 파일을 다시 올리면 v2… 이전 버전 보관·되돌리기.
 * 모든 저장은 버전 기록 + 업무 타임라인 '파일 수정 — 이름 v3' + 요청자(본인 제외) 알림. 권한 = 그 업무의 요청자·담당자·협업자·검토자·관리자(perms.edit), 그 외는 보기.
 */
const EDITABLE_DOC = /\.docx$/i; const EDITABLE_SHEET = /\.xlsx$/i;
export const editKindOf = (name: string | null | undefined, mime?: string | null) => (EDITABLE_DOC.test(name ?? '') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ? 'doc' : (EDITABLE_SHEET.test(name ?? '') || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ? 'sheet' : 'file';

/** 업무 첨부 + 편집 권한(요청자·담당자·협업자·검토자·관리자). 일정 첨부는 일정 편집 권한 */
async function editable(u: SessionUser, id: string) {
  const { a } = await loadAttachment(u, id);
  if (a.kind !== 'file' || a.upload_status !== 'ready') throw badRequest('파일 첨부만 편집할 수 있습니다');
  let canEdit = false; let task: any = null;
  if (a.task_id) { const t = await loadTaskForUser(u, a.task_id); task = t.task; canEdit = !!(t.perms as any).edit || a.created_by === u.id || (await participants(a.task_id)).includes(u.id); }
  else { const { loadEvent } = await import('./events'); canEdit = !!(await loadEvent(u, a.event_id)).perms.edit; }
  return { a, task, canEdit };
}
async function participants(taskId: string) {
  const sql = db();
  const [t] = await sql<any[]>`select created_by, assignee_id, requested_by from tasks where id = ${taskId}`;
  const co = await sql<{ user_id: string }[]>`select user_id from task_collaborators where task_id = ${taskId}`;
  // 검토자 = 이 업무의 검토 업무(review_of) 담당자
  const rv = await sql<{ assignee_id: string | null }[]>`select assignee_id from tasks where review_of = ${taskId} and deleted_at is null`.catch(() => [] as { assignee_id: string | null }[]);
  return [...new Set([t?.created_by, t?.assignee_id, t?.requested_by, ...co.map((c) => c.user_id), ...rv.map((r) => r.assignee_id)].filter(Boolean))] as string[];
}
/** 저장 뒤 공통: 버전 번호 올리고 타임라인·알림 */
async function bump(u: SessionUser, a: any, next: { key: string; name: string; mime: string; size: number; kind: 'upload' | 'doc' | 'sheet' | 'restore'; note?: string }) {
  const sql = db();
  const version = Number(a.version ?? 1) + 1;
  await sql.begin(async (tx) => {
    // 첫 편집이면 원본을 v1 로 보관
    const [has] = await tx`select 1 from attachment_versions where attachment_id = ${a.id} limit 1`;
    if (!has) await tx`insert into attachment_versions (attachment_id, version, storage_key, file_name, mime_type, size_bytes, kind, created_by, created_at) values (${a.id}, ${Number(a.version ?? 1)}, ${a.storage_key}, ${a.file_name}, ${a.mime_type}, ${a.size_bytes ?? 0}, 'original', ${a.created_by}, ${a.created_at})`;
    await tx`insert into attachment_versions (attachment_id, version, storage_key, file_name, mime_type, size_bytes, kind, note, created_by) values (${a.id}, ${version}, ${next.key}, ${next.name}, ${next.mime}, ${next.size}, ${next.kind}, ${next.note ?? null}, ${u.id})`;
    await tx`update attachments set storage_key = ${next.key}, file_name = ${next.name}, mime_type = ${next.mime}, size_bytes = ${next.size}, version = ${version}, updated_at = now(), updated_by = ${u.id} where id = ${a.id}`;
  });
  const entity = a.task_id ? 'task' : 'event';
  await activity(sql, entity, a.task_id ?? a.event_id, u.id, 'file_edited', { name: next.name, version, kind: next.kind, attachmentId: a.id });
  if (a.task_id) {
    const [t] = await sql<any[]>`select title, requested_by, created_by, assignee_id from tasks where id = ${a.task_id}`;
    const who = [...new Set([t?.requested_by ?? t?.created_by, t?.assignee_id].filter((x) => x && x !== u.id))] as string[];
    await notify(sql, { userIds: who, type: 'comment', title: `파일 수정 v${version}: ${next.name}`, body: `${u.name} 님이 "${t?.title ?? ''}" 첨부를 고쳐 저장했습니다`, link: `/tasks/${a.task_id}`, entityType: 'task', entityId: a.task_id, actorId: u.id, dedupeKey: `attver:${a.id}:${version}` }).catch(() => {});
  }
  return { version };
}

// ---------------- 버전 ----------------
export async function listVersions(u: SessionUser, id: string) {
  const { a, canEdit } = await editable(u, id).catch(async (e) => { if (e?.status === 400) { const { a } = await loadAttachment(u, id); return { a, task: null, canEdit: false }; } throw e; });
  const rows = await db()<any[]>`select v.id, v.version, v.file_name, v.mime_type, v.size_bytes, v.kind, v.note, v.created_at, u.name as created_by_name from attachment_versions v left join users u on u.id = v.created_by where v.attachment_id = ${id} order by v.version desc`;
  return { current: Number(a.version ?? 1), docId: a.doc_id ?? null, editKind: editKindOf(a.file_name, a.mime_type), canEdit, versions: rows };
}
export const newVersionInput = z.object({ fileName: z.string().trim().min(1).max(200), mimeType: z.string().max(120).optional(), size: z.number().int().min(1).max(200 * 1024 * 1024), note: z.string().max(300).optional() });
/** 새 버전 올리기 1/2: 올릴 자리 */
export async function startVersion(u: SessionUser, id: string, i: z.infer<typeof newVersionInput>) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden('이 업무의 요청자·담당자·검토자만 고칠 수 있습니다');
  await (await import('./plans')).assertStorage(u, i.size);
  const safe = i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120);
  const key = `att/${new Date().toISOString().slice(0, 7)}/${a.id}/v${Number(a.version ?? 1) + 1}-${safe}`;
  const mime = i.mimeType || a.mime_type || 'application/octet-stream';
  return { key, upload: await uploadTarget(key, mime), mime, fileName: i.fileName, note: i.note ?? null };
}
export const completeVersionInput = z.object({ key: z.string().min(1).max(300), fileName: z.string().trim().min(1).max(200), mimeType: z.string().max(120).optional(), note: z.string().max(300).optional() });
/** 새 버전 올리기 2/2: 올라갔는지 확인 → 현재 파일을 바꾸고 이전은 보관 */
export async function completeVersion(u: SessionUser, id: string, i: z.infer<typeof completeVersionInput>) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden();
  if (!i.key.startsWith(`att/`) || !i.key.includes(`/${a.id}/`)) throw badRequest('올린 자리가 다릅니다');
  const size = await objectSize(i.key); if (size === null) throw badRequest('올린 파일을 찾을 수 없습니다. 다시 올려 주세요');
  return bump(u, a, { key: i.key, name: i.fileName, mime: i.mimeType || a.mime_type, size, kind: 'upload', note: i.note });
}
export async function restoreVersion(u: SessionUser, id: string, versionId: string) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden();
  const [v] = await db()<any[]>`select * from attachment_versions where id = ${versionId} and attachment_id = ${id}`;
  if (!v) throw notFound('버전이 없습니다');
  return bump(u, a, { key: v.storage_key, name: v.file_name, mime: v.mime_type, size: Number(v.size_bytes), kind: 'restore', note: `v${v.version} 으로 되돌림` });
}
export async function versionDownload(u: SessionUser, id: string, versionId: string) {
  await loadAttachment(u, id);
  const [v] = await db()<any[]>`select storage_key, file_name from attachment_versions where id = ${versionId} and attachment_id = ${id}`;
  if (!v) throw notFound('버전이 없습니다');
  return downloadUrl(v.storage_key, v.file_name, false);
}

// ---------------- docx → 워크인 문서(공동 편집) ----------------
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
type Block = { type: 'heading' | 'paragraph' | 'bullet' | 'ordered' | 'table'; level?: number; runs?: { text: string; bold?: boolean; italic?: boolean }[]; rows?: string[][] };
/** document.xml → 블록(제목·문단·글머리·번호·표). 서식은 굵게·기울임만 */
export function docxBlocks(buf: Buffer): Block[] {
  const z = unzip(buf); const get = z.get('word/document.xml'); if (!get) throw badRequest('Word 파일(.docx)이 아닙니다');
  const xml = get().toString('utf8');
  const numbering = z.get('word/numbering.xml')?.().toString('utf8') ?? '';
  const bulletNums = new Set<string>();
  for (const m of numbering.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)) if (/<w:numFmt w:val="bullet"/.test(m[0])) bulletNums.add(m[1]);
  const numToAbs = new Map<string, string>(); for (const m of numbering.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) numToAbs.set(m[1], m[2]);
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const out: Block[] = [];
  const para = (p: string): Block | null => {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? '';
    const runs = [...p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)].map((r) => { const t = [...r[1].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((x) => unxml(x[1])).join('') + (/<w:br\b/.test(r[1]) ? '\n' : '') + (/<w:tab\b/.test(r[1]) ? '\t' : '');
      return { text: t, bold: /<w:b\b(?!\s*w:val="(?:0|false)")/.test(r[1]), italic: /<w:i\b(?!\s*w:val="(?:0|false)")/.test(r[1]) }; }).filter((r) => r.text);
    if (!runs.length) return null;
    const h = /^(?:Heading|heading|Title|제목)\s*([1-6])?/.exec(style); if (h) return { type: 'heading', level: Math.min(3, Number(h[1] ?? 1) || 1), runs };
    const num = /<w:numId w:val="(\d+)"/.exec(p)?.[1];
    if (num) return { type: bulletNums.has(numToAbs.get(num) ?? '') || /ListBullet/i.test(style) ? 'bullet' : 'ordered', runs };
    if (/ListBullet/i.test(style)) return { type: 'bullet', runs }; if (/ListNumber/i.test(style)) return { type: 'ordered', runs };
    return { type: 'paragraph', runs };
  };
  // 표와 문단을 문서 순서대로
  for (const m of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*(?:\/>|>[\s\S]*?<\/w:p>)/g)) {
    const s = m[0];
    if (s.startsWith('<w:tbl')) {
      const rows = [...s.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((x) => unxml(x[1])).join('').trim()));
      if (rows.length) out.push({ type: 'table', rows });
    } else { const b = para(s); if (b) out.push(b); }
    if (out.length > 2000) break;
  }
  return out;
}
/** 블록 → Yjs(Tiptap 노드 이름 그대로: heading(level)·paragraph·bulletList/orderedList > listItem > paragraph·table > tableRow > tableCell > paragraph, 굵게·기울임 mark) */
export function blocksToYDoc(blocks: Block[]) {
  const doc = new Y.Doc(); const frag = doc.getXmlFragment('default');
  const text = (runs: Block['runs']) => { const t = new Y.XmlText(); for (const r of runs ?? []) { const attrs: Record<string, unknown> = {}; if (r.bold) attrs.bold = {}; if (r.italic) attrs.italic = {}; t.insert(t.length, r.text, Object.keys(attrs).length ? attrs : undefined); } return t; };
  const paragraph = (runs: Block['runs']) => { const p = new Y.XmlElement('paragraph'); p.insert(0, [text(runs)]); return p; };
  doc.transact(() => {
    let list: { el: Y.XmlElement; type: string } | null = null;
    const flush = () => { if (list) { frag.insert(frag.length, [list.el]); list = null; } };
    for (const b of blocks) {
      if (b.type === 'bullet' || b.type === 'ordered') {
        const name = b.type === 'bullet' ? 'bulletList' : 'orderedList';
        if (!list || list.type !== name) { flush(); list = { el: new Y.XmlElement(name), type: name }; }
        const li = new Y.XmlElement('listItem'); li.insert(0, [paragraph(b.runs)]); list.el.insert(list.el.length, [li]); continue;
      }
      flush();
      if (b.type === 'heading') { const h = new Y.XmlElement('heading'); h.setAttribute('level', String(b.level ?? 1)); h.insert(0, [text(b.runs)]); frag.insert(frag.length, [h]); }
      else if (b.type === 'table') {
        const t = new Y.XmlElement('table');
        (b.rows ?? []).forEach((row, ri) => { const tr = new Y.XmlElement('tableRow'); row.forEach((cell) => { const tc = new Y.XmlElement(ri === 0 ? 'tableHeader' : 'tableCell'); tc.insert(0, [paragraph([{ text: cell }])]); tr.insert(tr.length, [tc]); }); t.insert(t.length, [tr]); });
        frag.insert(frag.length, [t]);
      } else frag.insert(frag.length, [paragraph(b.runs)]);
    }
    flush();
    if (!frag.length) frag.insert(0, [paragraph([{ text: '' }])]);
  });
  return doc;
}
/** [열어서 편집]: 첫 번에만 변환(원본은 첨부에 그대로), 다음부터는 같은 문서 열기. 업무 참여자에게 편집 공유 */
export async function openAsDoc(u: SessionUser, id: string) {
  const { a, task, canEdit } = await editable(u, id);
  if (!a.task_id) throw badRequest('업무 첨부만 문서로 열 수 있습니다');
  if (editKindOf(a.file_name, a.mime_type) !== 'doc') throw badRequest('Word(.docx) 파일만 문서로 엽니다 — 다른 파일은 [새 버전 올리기]');
  const sql = db(); const t = tenantOf(u);
  if (a.doc_id) { const [ok] = await sql`select 1 from library_files where id = ${a.doc_id} and deleted_at is null`; if (ok) { await shareToParticipants(a.doc_id, a.task_id); return { docId: a.doc_id, link: `/library/doc/${a.doc_id}?att=${a.id}`, created: false }; } }
  if (!canEdit) throw forbidden('이 업무의 요청자·담당자·검토자만 편집할 수 있습니다');
  const buf = await getObject(a.storage_key);
  const ydoc = blocksToYDoc(docxBlocks(buf));
  const title = String(a.file_name).replace(/\.docx$/i, '').slice(0, 200);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, tags, created_by, source, upload_status, security, task_id)
    values (${t}, 'work', ${`업무 첨부/${month}`}, ${title}, ${`${title}.wdoc`}, ${DOC_MIME}, 0, ${['문서', '업무 첨부']}, ${u.id}, 'doc', 'ready', 'internal', ${a.task_id}) returning id`;
  await sql`insert into lib_docs (library_file_id, tenant, snapshot) values (${f.id}, ${t}, ${Buffer.from(Y.encodeStateAsUpdate(ydoc))})`;
  await sql`update attachments set doc_id = ${f.id} where id = ${a.id}`;
  await shareToParticipants(f.id, a.task_id);
  await activity(sql, 'task', a.task_id, u.id, 'file_opened_doc', { name: a.file_name, docId: f.id, attachmentId: a.id });
  void task;
  return { docId: f.id, link: `/library/doc/${f.id}?att=${a.id}`, created: true };
}
async function shareToParticipants(docId: string, taskId: string) {
  const sql = db();
  for (const uid of await participants(taskId)) await sql`insert into lib_doc_shares (doc_id, user_id, role) values (${docId}, ${uid}, 'edit') on conflict (doc_id, user_id) do update set role = 'edit'`.catch(() => {});
}
/** [업무로 저장]: 워크인 문서 → Word 로 써서 첨부 새 버전(이전 버전 보관) */
export async function saveDocToAttachment(u: SessionUser, id: string) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden('이 업무의 요청자·담당자·검토자만 저장할 수 있습니다');
  if (!a.doc_id) throw badRequest('먼저 [열어서 편집]으로 문서를 만드세요');
  const [f] = await db()<{ title: string }[]>`select title from library_files where id = ${a.doc_id} and deleted_at is null`; if (!f) throw notFound('문서가 지워졌습니다');
  const { doc } = await loadYDoc(a.doc_id);
  const data = writeDocx(f.title, docMarkdown(doc));
  const name = `${f.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || '문서'}.docx`;
  const key = `att/${new Date().toISOString().slice(0, 7)}/${a.id}/v${Number(a.version ?? 1) + 1}-${name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  await putObject(key, data, mime);
  const r = await bump(u, a, { key, name, mime, size: data.length, kind: 'doc', note: '워크인 문서에서 저장' });
  await (await import('./libDocs')).saveVersion(a.doc_id, 'attachment_save', true).catch(() => {});
  return { ...r, fileName: name };
}

// ---------------- xlsx 칸 고치기 ----------------
export async function sheetLayout(u: SessionUser, id: string) {
  const { a, canEdit } = await editable(u, id);
  if (editKindOf(a.file_name, a.mime_type) !== 'sheet') throw badRequest('Excel(.xlsx) 파일만 칸을 고칠 수 있습니다');
  const lay = templateLayout(await getObject(a.storage_key), 'xlsx', 2000) as any;
  return { canEdit, version: Number(a.version ?? 1), sheets: lay.sheets.map((s: any) => ({ name: s.name, range: s.range, merges: s.merges, cells: s.cells })), truncated: lay.truncated };
}
export const sheetEditInput = z.object({ edits: z.array(z.object({ sheet: z.string().max(100).optional(), cell: z.string().regex(/^[A-Z]{1,3}\d{1,7}$/i), value: z.union([z.string().max(5000), z.number(), z.null()]) })).min(1).max(500), note: z.string().max(300).optional() });
export async function saveSheet(u: SessionUser, id: string, i: z.infer<typeof sheetEditInput>) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden('이 업무의 요청자·담당자·검토자만 고칠 수 있습니다');
  if (editKindOf(a.file_name, a.mime_type) !== 'sheet') throw badRequest('Excel(.xlsx) 파일만');
  const r = fillXlsx(await getObject(a.storage_key), i.edits.map((e) => ({ sheet: e.sheet, cell: e.cell.toUpperCase(), value: e.value })) as CellEdit[]);
  const key = `att/${new Date().toISOString().slice(0, 7)}/${a.id}/v${Number(a.version ?? 1) + 1}-${String(a.file_name).replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  await putObject(key, r.data, mime);
  const b = await bump(u, a, { key, name: a.file_name, mime, size: r.data.length, kind: 'sheet', note: i.note ?? `칸 ${i.edits.length}개 고침` });
  return { ...b, warnings: r.warnings ?? [] };
}
