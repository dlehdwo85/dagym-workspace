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
 * ③ 그 밖(hwp·pptx…) → [새 버전 올리기]: 내려받아 고친 파일을 다시 올리면 v2… 이전 버전 보관·되돌리기.
 * ④ #533 [고치기]: 글(txt·csv·md…)·사진은 브라우저에서 고쳐 새 버전으로 올리고(edit: text·image), PDF 는 글자·체크·서명·가리기를 서버가 찍어 새 버전(editPdf).
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
async function bump(u: SessionUser, a: any, next: { key: string; name: string; mime: string; size: number; kind: 'upload' | 'doc' | 'sheet' | 'restore' | 'text' | 'image' | 'pdf'; note?: string }) {
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
  const key = versionKey(a, i.fileName);
  const mime = i.mimeType || a.mime_type || 'application/octet-stream';
  return { key, upload: await uploadTarget(key, mime), mime, fileName: i.fileName, note: i.note ?? null };
}
const versionKey = (a: any, name: string) => `att/${new Date().toISOString().slice(0, 7)}/${a.id}/v${Number(a.version ?? 1) + 1}-${name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
// #533: edit = 브라우저 편집기에서 고친 글·사진(버전 기록에 '글 고침'·'사진 고침')
export const completeVersionInput = z.object({ key: z.string().min(1).max(300), fileName: z.string().trim().min(1).max(200), mimeType: z.string().max(120).optional(), note: z.string().max(300).optional(), edit: z.enum(['text', 'image']).optional() });
/** 새 버전 올리기 2/2: 올라갔는지 확인 → 현재 파일을 바꾸고 이전은 보관 */
export async function completeVersion(u: SessionUser, id: string, i: z.infer<typeof completeVersionInput>) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden();
  if (!i.key.startsWith(`att/`) || !i.key.includes(`/${a.id}/`)) throw badRequest('올린 자리가 다릅니다');
  const size = await objectSize(i.key); if (size === null) throw badRequest('올린 파일을 찾을 수 없습니다. 다시 올려 주세요');
  return bump(u, a, { key: i.key, name: i.fileName, mime: i.mimeType || a.mime_type, size, kind: i.edit ?? 'upload', note: i.note });
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

// ---------------- #533 [고치기]: 편집기 원본 · PDF 에 찍기 ----------------
/** 편집기가 읽는 원본 바이트(같은 출처) — 고칠 수 있는 사람만, 자료실 기밀 파일은 기밀 열람 권한, 50MB 까지 */
export async function editSource(u: SessionUser, id: string) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden('이 업무의 요청자·담당자·검토자만 고칠 수 있습니다');
  const { storageSecurity, userSeesConfidential } = await import('./library');
  const lib = await storageSecurity(tenantOf(u), a.storage_key);
  if (lib?.deleted) throw notFound('자료실에서 지운 파일입니다');
  if (lib?.security === 'confidential' && !(await userSeesConfidential(u.id))) throw forbidden('기밀 자료입니다 — 기밀 열람 권한이 있어야 고칠 수 있습니다');
  const size = await objectSize(a.storage_key); if (size === null) throw notFound('파일을 찾을 수 없습니다');
  if (size > 50 * 1024 * 1024) throw badRequest('50MB 가 넘는 파일은 브라우저에서 고칠 수 없습니다 — 내려받아 고친 뒤 [고친 파일 올리기]');
  return { a, bytes: await getObject(a.storage_key) };
}
const stampInput = z.object({ type: z.enum(['text', 'check', 'sign', 'cover']), page: z.number().int().min(1).max(2000), x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.003).max(1), h: z.number().min(0.003).max(1),
  value: z.string().max(2000).optional(), image: z.string().max(400_000).optional() });
export const pdfEditInput = z.object({ items: z.array(stampInput).min(1).max(300) });
const STAMP_LABEL = { text: '글자', check: '체크', sign: '서명', cover: '가리기' } as const;
/** PDF [고치기] 저장: 흰 상자로 가리고 그 위에 글자·체크·서명을 찍어 같은 첨부의 새 버전(원본은 v1 로 보관) */
export async function editPdf(u: SessionUser, id: string, i: z.infer<typeof pdfEditInput>) {
  const { a, bytes } = await editSource(u, id);
  if (!/pdf/i.test(a.mime_type ?? '') && !/\.pdf$/i.test(a.file_name ?? '')) throw badRequest('PDF 첨부만 이렇게 고칠 수 있습니다');
  let total = 0;
  const items = i.items.map((it) => {
    if (it.x + it.w > 1.001 || it.y + it.h > 1.001) throw badRequest('칸이 쪽 밖으로 나갔습니다');
    const value = it.value?.replace(/[\u{10000}-\u{10FFFF}]/gu, '').trimEnd(); // 글꼴에 없는 그림 문자 빼기
    if (it.type === 'text' && !value?.trim()) throw badRequest('빈 글자 칸이 있습니다 — 적거나 지워 주세요');
    let png: Buffer | undefined;
    if (it.type === 'sign') {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(it.image ?? ''); if (!m) throw badRequest('서명 그림이 없습니다');
      png = Buffer.from(m[1], 'base64'); if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw badRequest('서명 그림 형식이 다릅니다');
      total += png.length;
    }
    return { type: it.type, page: it.page, x: it.x, y: it.y, w: it.w, h: it.h, value, png };
  });
  if (total > 1_500_000) throw badRequest('서명 그림이 너무 큽니다');
  const { stampPdf, unrotatePdf } = await import('./contractPdf');
  let out: Buffer;
  try { out = await stampPdf((await unrotatePdf(bytes)) ?? bytes, items); } // 돌아간 쪽은 화면에 보이는 방향 그대로 세운 뒤 찍음(편집기 좌표 = 보이는 쪽)
  catch (e: any) {
    if (e?.message === 'NO_PAGE') throw badRequest('없는 쪽에 놓은 칸이 있습니다');
    if (e?.message === 'TEXT_OVER') throw badRequest('글이 칸에 다 들어가지 않습니다 — 칸을 키우거나 글을 줄여 주세요');
    throw badRequest(/encrypt/i.test(String(e?.message ?? e)) ? '암호가 걸린 PDF 는 고칠 수 없습니다 — 내려받아 고친 뒤 [고친 파일 올리기]' : 'PDF 를 읽지 못했습니다 — 내려받아 고친 뒤 [고친 파일 올리기]');
  }
  const key = versionKey(a, a.file_name); await putObject(key, out, 'application/pdf');
  const n = (['text', 'check', 'sign', 'cover'] as const).map((t) => [STAMP_LABEL[t], items.filter((x) => x.type === t).length] as const).filter(([, c]) => c).map(([l, c]) => `${l} ${c}`).join('·');
  return bump(u, a, { key, name: a.file_name, mime: 'application/pdf', size: out.length, kind: 'pdf', note: `PDF 에 써넣음(${n})` });
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
/**
 * #806(대표 10/29 '문서 고치기 빈 화면' — 글 0자·사진 16장 docx): 원본에 든 것. 글자 수(글상자 안 포함)·사진 수·글상자 수.
 * 사진만 든 문서(스캔·사진을 붙인 문서)는 워크인 문서로 바꾸면 빈 문서가 되므로 바꾸지 않는다.
 */
export function docxInfo(buf: Buffer) {
  const xml = unzip(buf).get('word/document.xml')?.().toString('utf8') ?? '';
  const chars = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unxml(m[1])).join('').replace(/\s+/g, '').length;
  return { chars, images: (xml.match(/<a:blip\b|<v:imagedata\b/g) ?? []).length, boxes: (xml.match(/<w:txbxContent\b/g) ?? []).length };
}
const blockChars = (blocks: Block[]) => blocks.reduce((n, b) => n + (b.runs ?? []).map((r) => r.text).join('').replace(/\s+/g, '').length + (b.rows ?? []).flat().join('').replace(/\s+/g, '').length, 0);
const imageOnly = (i: ReturnType<typeof docxInfo>) => i.images > 0 && i.chars < 20; // 사진 밑 짧은 이름표('현장 사진' 등)만 있어도 사진 문서
/** 워크인 문서로 바꾸면 빠지는 것(사진·글상자 글) — 문서 화면 위 안내 한 줄 */
function lostOf(i: ReturnType<typeof docxInfo>, blocks: Block[]) {
  const kept = blockChars(blocks);
  return { images: i.images, text: i.chars > 40 && kept < i.chars * 0.7 ? Math.round((1 - kept / i.chars) * 100) : 0 };
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
  if (a.doc_id) {
    const [ok] = await sql`select 1 from library_files where id = ${a.doc_id} and deleted_at is null`;
    if (ok) {
      const empty = await emptyImageDoc(u, a, canEdit);
      if (empty) return empty;
      await shareToParticipants(a.doc_id, a.task_id);
      const lost = await sourceLost(a).catch(() => null);
      return { docId: a.doc_id, link: docLink(a.doc_id, a.id, lost), created: false };
    }
  }
  if (!canEdit) throw forbidden('이 업무의 요청자·담당자·검토자만 편집할 수 있습니다');
  const buf = await getObject(a.storage_key);
  const info = docxInfo(buf);
  if (imageOnly(info)) return { imageOnly: true as const, images: info.images, pdf: await pdfMadeOf(a.id) };
  const blocks = docxBlocks(buf);
  const ydoc = blocksToYDoc(blocks);
  const title = String(a.file_name).replace(/\.docx$/i, '').slice(0, 200);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, tags, created_by, source, upload_status, security, task_id)
    values (${t}, 'work', ${`업무 첨부/${month}`}, ${title}, ${`${title}.wdoc`}, ${DOC_MIME}, 0, ${['문서', '업무 첨부']}, ${u.id}, 'doc', 'ready', 'internal', ${a.task_id}) returning id`;
  await sql`insert into lib_docs (library_file_id, tenant, snapshot) values (${f.id}, ${t}, ${Buffer.from(Y.encodeStateAsUpdate(ydoc))})`;
  await sql`update attachments set doc_id = ${f.id} where id = ${a.id}`;
  await shareToParticipants(f.id, a.task_id);
  await activity(sql, 'task', a.task_id, u.id, 'file_opened_doc', { name: a.file_name, docId: f.id, attachmentId: a.id });
  void task;
  return { docId: f.id, link: docLink(f.id, a.id, lostOf(info, blocks)), created: true };
}
const docLink = (docId: string, attId: string, lost: { images: number; text: number } | null) =>
  `/library/doc/${docId}?att=${attId}${lost?.images ? `&lostImg=${lost.images}` : ''}${lost?.text ? `&lostText=${lost.text}` : ''}`;
/** 이미 바꾼 문서를 다시 열 때도 원본 기준으로 빠진 것 안내(원본 = 처음 올린 판) */
async function sourceLost(a: any) {
  const [v] = await db()<{ storage_key: string }[]>`select storage_key from attachment_versions where attachment_id = ${a.id} and kind = 'original' limit 1`;
  const buf = await getObject(v?.storage_key ?? a.storage_key);
  return lostOf(docxInfo(buf), docxBlocks(buf));
}
/**
 * #806: 사진만 든 원본을 예전에 바꿔 둔 빈 문서 → 원래 첨부로 되돌림. 문서 연결을 끊고(자료실 문서는 지운 것으로),
 * 빈 문서를 [업무로 저장]해 첨부가 빈 Word 로 바뀌었으면 처음 올린 판으로 되돌린다. 글을 적어 둔 문서는 건드리지 않음
 */
async function emptyImageDoc(u: SessionUser, a: any, canEdit: boolean) {
  const { doc } = await loadYDoc(a.doc_id);
  if (docMarkdown(doc).replace(/\s+/g, '')) return null;
  const sql = db();
  const [orig] = await sql<any[]>`select id, storage_key from attachment_versions where attachment_id = ${a.id} and kind = 'original' limit 1`;
  const info = docxInfo(await getObject(orig?.storage_key ?? a.storage_key));
  if (!imageOnly(info)) return null;
  if (canEdit) {
    await sql`update library_files set deleted_at = now() where id = ${a.doc_id} and source = 'doc' and deleted_at is null`;
    await sql`update attachments set doc_id = null where id = ${a.id}`;
    const [cur] = await sql<{ kind: string }[]>`select kind from attachment_versions where attachment_id = ${a.id} and version = ${Number(a.version ?? 1)}`;
    if (orig && cur?.kind === 'doc') await restoreVersion(u, a.id, orig.id);
    await activity(sql, 'task', a.task_id, u.id, 'file_doc_reverted', { name: a.file_name, attachmentId: a.id, images: info.images });
  }
  return { imageOnly: true as const, images: info.images, reverted: canEdit, pdf: await pdfMadeOf(a.id) };
}
type MadePdf = { id: string; file_name: string; mime_type: string; size_bytes: number; kind: 'file' };
const pdfMadeOf = async (attId: string): Promise<MadePdf | null> => (await db()<MadePdf[]>`select id, file_name, mime_type, size_bytes::int as size_bytes, kind from attachments where pdf_of = ${attId} and deleted_at is null order by created_at desc limit 1`)[0] ?? null;
/**
 * #806 [PDF 로 만들어 글자 넣기]: 사진만 든 Word 의 사진을 문서 순서대로 한 쪽에 한 장씩 PDF 로 → 같은 업무에 새 첨부(원본 Word 는 그대로).
 * 만든 PDF 는 [고치기]에서 글자·체크·서명·가리기. 이미 만든 게 있으면 그걸 돌려줌
 */
export async function docImagesToPdf(u: SessionUser, id: string) {
  const { a, canEdit } = await editable(u, id); if (!canEdit) throw forbidden('이 업무의 요청자·담당자·검토자만 만들 수 있습니다');
  if (!a.task_id) throw badRequest('업무 첨부만 PDF 로 만들 수 있습니다');
  if (editKindOf(a.file_name, a.mime_type) !== 'doc') throw badRequest('Word(.docx) 파일만');
  const had = await pdfMadeOf(a.id); if (had) return { pdf: had, created: false };
  const [orig] = await db()<{ storage_key: string }[]>`select storage_key from attachment_versions where attachment_id = ${a.id} and kind = 'original' limit 1`;
  const z = unzip(await getObject(orig?.storage_key ?? a.storage_key));
  const xml = z.get('word/document.xml')?.().toString('utf8') ?? '';
  const rels = z.get('word/_rels/document.xml.rels')?.().toString('utf8') ?? '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? '', /Target="([^"]+)"/.exec(m[0])?.[1] ?? '']));
  const ids = [...xml.matchAll(/<a:blip\b[^>]*r:embed="([^"]+)"|<v:imagedata\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  const sharp = (await import('sharp')).default;
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  let skipped = 0;
  for (const rid of ids.slice(0, 200)) {
    const t = target.get(rid); const get = t ? z.get(`word/${t.replace(/^\.?\//, '')}`) ?? z.get(t.replace(/^\//, '')) : undefined;
    if (!get) { skipped++; continue; }
    try {
      const jpg = await sharp(get(), { failOn: 'none' }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer();
      const img = await pdf.embedJpg(jpg);
      const w = 595, h = Math.min(1684, Math.max(200, Math.round((w * img.height) / img.width)));
      pdf.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    } catch { skipped++; } // emf·wmf 같은 그림은 못 바꿈
  }
  if (!pdf.getPageCount()) throw badRequest('문서 안 사진을 PDF 로 바꾸지 못했습니다. 원본을 내려받아 확인해 주세요');
  const out = Buffer.from(await pdf.save());
  const name = `${String(a.file_name).replace(/\.docx$/i, '')}.pdf`;
  const key = `att/${new Date().toISOString().slice(0, 7)}/${a.task_id}/${crypto.randomUUID()}-${name.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  await putObject(key, out, 'application/pdf');
  const sql = db();
  const [n] = await sql<{ id: string }[]>`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, doc_title, source, created_by, pdf_of)
    values (${a.task_id}, 'file', ${key}, ${name}, 'application/pdf', ${out.length}, 'ready', ${a.doc_title ?? null}, 'other', ${u.id}, ${a.id}) returning id`;
  await activity(sql, 'task', a.task_id, u.id, 'file_attached', { name, size: out.length, from: 'doc_pdf', of: a.file_name, pages: pdf.getPageCount(), skipped });
  return { pdf: { id: n.id, file_name: name, mime_type: 'application/pdf', size_bytes: out.length, kind: 'file' as const }, created: true, pages: pdf.getPageCount(), skipped };
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
