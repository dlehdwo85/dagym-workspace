// 대표 결정 10/19: 자료실 '워크인 문서' 공동 편집 1단계 — Yjs(CRDT) 조각을 워크인 API 로 주고받고 Neon 에 추가형 저장.
// 외부 유료 실시간 서비스 없음(설계 docs/research/LIBRARY_DOC_COEDIT_DESIGN.md). 업무 설명·체크리스트는 대상이 아님.
// 권한은 자료실 규칙 그대로(loadLibraryFile) + 문서 공유(lib_doc_shares, 보기/편집). 다른 회사 404. 보기 권한이 보낸 조각은 403.
import * as Y from 'yjs';
import { z } from 'zod';
import { db } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { RANK, menuLevel, requireMenu } from './menuPerms';
import { cleanFolder, confWords, folderLevel, loadLibraryFile, ruleSecurity, tenantOf } from './library';
import { writeDocx } from './docx';
import type { SessionUser } from './types';

export const DOC_MIME = 'application/x-workin-doc';
export const isDocMime = (m: string | null | undefined) => m === DOC_MIME;
const FIELD = 'default'; // Tiptap Collaboration 기본 fragment 이름
const COMPACT_EVERY = 200; // 조각이 이만큼 쌓이면 합침
const VERSION_MS = 10 * 60 * 1000; // 변경 기록 간격
const PRESENCE_MS = 20_000; // 커서·이름 유효 시간

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export const docCreateInput = z.object({ title: z.string().trim().min(1).max(200), folder: z.string().max(200).default(''), space: z.enum(['work', 'sales', 'marketing']).optional(),
  scope: z.enum(['company', 'team', 'mine']).optional(), teamId: z.string().uuid().optional() }); // 292차 #814 내 파일·우리 팀에 새 문서
export const syncInput = z.object({
  since: z.coerce.number().int().min(0).default(0),
  clientId: z.coerce.number().int().min(0).default(0),
  update: z.string().max(2_000_000).optional(), // base64 Yjs update
  awareness: z.string().max(20_000).optional(), // base64 awareness update(내 커서·이름)
  leave: z.boolean().optional(),
});
export const sharesInput = z.object({ shares: z.array(z.object({ userId: z.string().uuid(), role: z.enum(['view', 'edit']) })).max(200) });

/** 새 워크인 문서 — 자료실 파일 1건(저장 파일 없음, mime 으로 구분) + 빈 Yjs 상태 */
export async function createDoc(u: SessionUser, i: z.infer<typeof docCreateInput>) {
  denyDemo(u);
  await requireMenu(u, 'library', 'edit');
  const folder = cleanFolder(i.folder);
  const space = i.space ?? 'work';
  const scope = i.scope ?? 'company';
  if (scope !== 'company' && space !== 'work') throw badRequest('우리 팀·내 파일은 업무 공간 자료실에서만 쓸 수 있습니다');
  if (scope === 'company' && RANK[await folderLevel(u, folder)] < RANK.edit) throw forbidden(`"${folder || '자료실'}" 폴더에 만들 권한이 없습니다`);
  const L = await import('./library');
  const teamId = scope === 'team' ? (i.teamId ?? (await L.myTeams(u))[0]?.id) : null;
  if (scope === 'team' && (!teamId || !((await L.myTeams(u)).some((t) => t.id === teamId) || (isAdmin(u) && (await L.visibleTeamIds(u)).includes(teamId))))) throw badRequest('그 팀 구성원만 팀 문서를 만들 수 있습니다');
  if (space !== 'work' && !(await L.librarySpaces(u)).includes(space)) throw notFound();
  const sql = db();
  const t = tenantOf(u);
  const suggested = ruleSecurity(i.title, await confWords(t));
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, scope, team_id, space, folder, title, file_name, mime_type, size_bytes, tags, created_by, source, upload_status, security, security_suggested)
    values (${t}, ${scope}, ${teamId}, ${space}, ${folder}, ${i.title}, ${`${i.title.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.wdoc`}, ${DOC_MIME}, 0, ${['문서']}, ${u.id}, 'doc', 'ready', 'internal', ${suggested}) returning id`;
  const empty = new Y.Doc(); empty.getXmlFragment(FIELD);
  await sql`insert into lib_docs (library_file_id, tenant, snapshot) values (${f.id}, ${t}, ${Buffer.from(Y.encodeStateAsUpdate(empty))})`;
  const { audit } = await import('./log');
  await audit(sql, u.id, 'library.doc_create', 'library_file', f.id, { title: i.title, folder }, null);
  return { id: f.id, link: `/library/doc/${f.id}` };
}

/** 문서 접근: 자료실 권한(폴더·등급·공간·격리) 또는 공유. canEdit = 올린 사람·관리자·편집 공유·폴더 편집 권한 */
export async function docAccess(u: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('문서가 없습니다');
  const sql = db();
  const [share] = await sql<{ role: 'view' | 'edit' }[]>`select s.role from lib_doc_shares s join library_files f on f.id = s.doc_id
    where s.doc_id = ${id} and s.user_id = ${u.id} and f.tenant = ${tenantOf(u)} and f.deleted_at is null`;
  let f: any;
  try { f = await loadLibraryFile(u, id, 'meta'); } catch (e) {
    if (!share) throw e;
    [f] = await sql<any[]>`select * from library_files where id = ${id} and tenant = ${tenantOf(u)} and deleted_at is null`;
    if (!f) throw notFound('문서가 없습니다');
  }
  if (!isDocMime(f.mime_type)) throw notFound('문서가 없습니다');
  const mine = f.created_by === u.id;
  const canEdit = mine || isAdmin(u) || share?.role === 'edit' || (!share && RANK[await menuLevel(u, 'library')] >= RANK.edit && (f.scope === 'team' || (f.scope === 'company' && RANK[await folderLevel(u, f.folder)] >= RANK.edit))); // 292차: 팀 문서는 그 팀(볼 수 있는 사람)이 고침
  return { file: f, canEdit, canShare: mine || isAdmin(u), shared: !!share };
}

/** 열기: snapshot + 그 뒤 조각 (base64) */
export async function openDoc(u: SessionUser, id: string) {
  const { file, canEdit, canShare, shared } = await docAccess(u, id);
  const sql = db();
  const [d] = await sql<{ snapshot: Buffer; snapshot_seq: string }[]>`select snapshot, snapshot_seq from lib_docs where library_file_id = ${id}`;
  if (!d) throw notFound('문서가 없습니다');
  const ups = await sql<{ seq: string; update: Buffer }[]>`select seq, update from lib_doc_updates where doc_id = ${id} and seq > ${d.snapshot_seq} order by seq`;
  const [by] = await sql<{ name: string }[]>`select name from users where id = ${file.created_by}`;
  if (file.effective_security === 'confidential') { const { audit } = await import('./log'); await audit(sql, u.id, 'library.confidential_open', 'library_file', id, { title: file.title, folder: file.folder }, null); }
  return {
    file: { id: file.id, title: file.title, folder: file.folder, security: file.effective_security ?? file.security, created_by: file.created_by, created_by_name: by?.name ?? '', updated_at: file.updated_at, task_id: file.task_id ?? null },
    canEdit, canShare, shared, snapshot: b64(d.snapshot), updates: ups.map((x) => b64(x.update)),
    seq: ups.length ? Number(ups[ups.length - 1].seq) : Number(d.snapshot_seq),
  };
}

/** 한 번의 왕복: 내 조각·커서 보내기 + since 뒤 남의 조각·커서 받기. 조각이 200개 넘으면 합치고 10분마다 변경 기록 */
export async function syncDoc(u: SessionUser, id: string, i: z.infer<typeof syncInput>) {
  const { file, canEdit } = await docAccess(u, id);
  const sql = db();
  if (i.leave) { await sql`delete from lib_doc_presence where doc_id = ${id} and client_id = ${i.clientId}`; return { ok: true }; }
  if (i.update) {
    if (!canEdit) throw forbidden('이 문서는 보기만 할 수 있습니다');
    denyDemo(u); // 체험 계정은 보기만
    const bytes = fromB64(i.update);
    if (!bytes.length) throw badRequest('빈 조각');
    await sql`insert into lib_doc_updates (doc_id, client_id, update, user_id) values (${id}, ${i.clientId}, ${Buffer.from(bytes)}, ${u.id})`;
    await sql`update lib_docs set updated_at = now(), pending_users = (select array_agg(distinct x) from unnest(array_append(pending_users, ${u.id}::uuid)) x) where library_file_id = ${id}`;
    await sql`update library_files set updated_at = now() where id = ${id}`;
  }
  if (i.awareness) {
    await sql`insert into lib_doc_presence (doc_id, client_id, user_id, state) values (${id}, ${i.clientId}, ${u.id}, ${Buffer.from(fromB64(i.awareness))})
      on conflict (doc_id, client_id) do update set state = excluded.state, user_id = excluded.user_id, updated_at = now()`;
  }
  const ups = await sql<{ seq: string; update: Buffer; client_id: string }[]>`select seq, update, client_id from lib_doc_updates where doc_id = ${id} and seq > ${i.since} order by seq limit 500`;
  const presence = await sql<{ client_id: string; user_id: string; state: Buffer; name: string }[]>`select p.client_id, p.user_id, p.state, us.name from lib_doc_presence p join users us on us.id = p.user_id
    where p.doc_id = ${id} and p.client_id <> ${i.clientId} and p.updated_at > now() - ${PRESENCE_MS / 1000 + ' seconds'}::interval`;
  const [d] = await sql<{ snapshot_seq: string; version_at: Date; version_seq: string }[]>`select snapshot_seq, version_at, version_seq from lib_docs where library_file_id = ${id}`;
  const latest = ups.length ? Number(ups[ups.length - 1].seq) : i.since;
  // 합치기·변경 기록(가벼운 조건 검사만; 실제 작업은 가끔)
  if (i.update && d) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from lib_doc_updates where doc_id = ${id} and seq > ${d.snapshot_seq}`;
    if (n >= COMPACT_EVERY) await compactDoc(id);
    if (Date.now() - new Date(d.version_at).getTime() > VERSION_MS) await saveVersion(id, 'auto');
  }
  return {
    seq: Math.max(latest, Number(d?.snapshot_seq ?? 0)),
    updates: ups.filter((x) => Number(x.client_id) !== i.clientId).map((x) => b64(x.update)),
    presence: presence.map((p) => ({ clientId: Number(p.client_id), userId: p.user_id, name: p.name, state: b64(p.state) })),
    canEdit, title: file.title,
  };
}

export async function loadYDoc(id: string, upToSeq?: number) {
  const sql = db();
  const [d] = await sql<{ snapshot: Buffer; snapshot_seq: string }[]>`select snapshot, snapshot_seq from lib_docs where library_file_id = ${id}`;
  if (!d) throw notFound('문서가 없습니다');
  const ups = upToSeq === undefined
    ? await sql<{ seq: string; update: Buffer }[]>`select seq, update from lib_doc_updates where doc_id = ${id} and seq > ${d.snapshot_seq} order by seq`
    : await sql<{ seq: string; update: Buffer }[]>`select seq, update from lib_doc_updates where doc_id = ${id} and seq > ${d.snapshot_seq} and seq <= ${upToSeq} order by seq`;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(d.snapshot));
  for (const x of ups) { try { Y.applyUpdate(doc, new Uint8Array(x.update)); } catch { /* 깨진 조각은 건너뜀 */ } }
  return { doc, seq: ups.length ? Number(ups[ups.length - 1].seq) : Number(d.snapshot_seq) };
}

/** 조각을 하나로 합쳐 snapshot 갱신, 합친 조각은 지움(클라이언트는 since 뒤 것만 받으므로 영향 없음) */
export async function compactDoc(id: string) {
  const { doc, seq } = await loadYDoc(id);
  const snap = Buffer.from(Y.encodeStateAsUpdate(doc));
  const sql = db();
  await sql`update lib_docs set snapshot = ${snap}, snapshot_seq = ${seq} where library_file_id = ${id}`;
  await sql`delete from lib_doc_updates where doc_id = ${id} and seq <= ${seq}`;
  await sql`update library_files set size_bytes = ${snap.length} where id = ${id}`;
  return { seq, bytes: snap.length };
}

/** 변경 기록 저장(합친 뒤) + 글자 뽑아 자료실 검색·AI 비서용 text_content 갱신. 바뀐 것이 없으면 건너뜀 */
export async function saveVersion(id: string, reason: string, force = false) {
  const sql = db();
  const [d] = await sql<{ version_seq: string; pending_users: string[] }[]>`select version_seq, pending_users from lib_docs where library_file_id = ${id}`;
  if (!d) return null;
  const { seq } = await compactDoc(id);
  if (!force && seq <= Number(d.version_seq)) { await sql`update lib_docs set version_at = now() where library_file_id = ${id}`; return null; }
  const [s] = await sql<{ snapshot: Buffer }[]>`select snapshot from lib_docs where library_file_id = ${id}`;
  const doc = new Y.Doc(); Y.applyUpdate(doc, new Uint8Array(s.snapshot));
  const text = docText(doc);
  const [v] = await sql<{ id: string }[]>`insert into lib_doc_versions (doc_id, seq, snapshot, by_users, reason, text) values (${id}, ${seq}, ${s.snapshot}, ${d.pending_users}, ${reason}, ${text.slice(0, 20000)}) returning id`;
  await sql`update lib_docs set version_seq = ${seq}, version_at = now(), pending_users = '{}' where library_file_id = ${id}`;
  await sql`update library_files set text_content = ${text.slice(0, 200000)}, updated_at = now() where id = ${id}`;
  return { id: Number(v.id), seq };
}

/** 정기 실행: 10분 넘게 변경 기록이 없거나, 고치던 사람이 모두 나간 문서의 기록·합치기 */
export async function docVersionsJob() {
  const sql = db();
  const rows = await sql<{ id: string }[]>`select d.library_file_id as id from lib_docs d
    where (select count(*) from lib_doc_updates x where x.doc_id = d.library_file_id and x.seq > d.version_seq) > 0
      and (d.version_at < now() - interval '10 minutes'
        or not exists (select 1 from lib_doc_presence p where p.doc_id = d.library_file_id and p.updated_at > now() - interval '60 seconds'))
    limit 50`;
  let saved = 0;
  for (const r of rows) if (await saveVersion(r.id, 'idle')) saved++;
  await sql`delete from lib_doc_presence where updated_at < now() - interval '10 minutes'`;
  return { checked: rows.length, saved };
}

export async function listVersions(u: SessionUser, id: string) {
  await docAccess(u, id);
  const sql = db();
  const rows = await sql<{ id: string; seq: string; reason: string | null; created_at: Date; text: string | null; names: string[] | null }[]>`
    select v.id, v.seq, v.reason, v.created_at, left(v.text, 160) as text,
      (select array_agg(us.name order by us.name) from users us where us.id = any(v.by_users)) as names
    from lib_doc_versions v where v.doc_id = ${id} order by v.id desc limit 100`;
  return { versions: rows.map((r) => ({ id: Number(r.id), seq: Number(r.seq), reason: r.reason, createdAt: r.created_at, preview: r.text ?? '', by: r.names ?? [] })) };
}
export async function getVersion(u: SessionUser, id: string, versionId: number) {
  await docAccess(u, id);
  const [v] = await db()<{ snapshot: Buffer; created_at: Date; text: string | null }[]>`select snapshot, created_at, text from lib_doc_versions where doc_id = ${id} and id = ${versionId}`;
  if (!v) throw notFound('기록이 없습니다');
  return { id: versionId, snapshot: b64(v.snapshot), createdAt: v.created_at, text: v.text ?? '' };
}
/** 지금 상태를 기록으로 남김(되돌리기 전에 서버가 호출하거나, 사용자가 '기록 남기기') */
export async function markVersion(u: SessionUser, id: string, reason = 'manual') {
  const { canEdit } = await docAccess(u, id);
  if (!canEdit) throw forbidden('이 문서는 보기만 할 수 있습니다');
  return (await saveVersion(id, reason, true)) ?? { id: null };
}

/** 공유 목록·바꾸기(올린 사람·관리자). 회사 안 사람만 */
export async function listShares(u: SessionUser, id: string) {
  const { canShare } = await docAccess(u, id);
  const { directory } = await import('./admin');
  const dir = await directory(u);
  const shares = await db()<{ user_id: string; role: string }[]>`select user_id, role from lib_doc_shares where doc_id = ${id}`;
  const people = (dir.users as any[]).filter((x) => x.id !== u.id).map((x) => ({ id: x.id, name: x.name, title: x.title ?? null, role: shares.find((s) => s.user_id === x.id)?.role ?? null }));
  return { canShare, people, shares: shares.map((s) => ({ userId: s.user_id, role: s.role })) };
}
export async function setShares(u: SessionUser, id: string, i: z.infer<typeof sharesInput>) {
  const { canShare } = await docAccess(u, id);
  if (!canShare) throw forbidden('올린 사람 또는 관리자만 공유를 바꿀 수 있습니다');
  const sql = db();
  const ids = i.shares.map((s) => s.userId);
  const ok = ids.length ? await sql<{ id: string }[]>`select id from users where id = any(${ids}::uuid[]) and tenant = ${tenantOf(u)} and status = 'active'` : [];
  if (ok.length !== new Set(ids).size) throw badRequest('회사 안 사람만 공유할 수 있습니다');
  await sql.begin(async (tx) => {
    await tx`delete from lib_doc_shares where doc_id = ${id}`;
    for (const s of i.shares) await tx`insert into lib_doc_shares (doc_id, user_id, role, created_by) values (${id}, ${s.userId}, ${s.role}, ${u.id}) on conflict (doc_id, user_id) do update set role = excluded.role`;
  });
  const { audit } = await import('./log');
  await audit(sql, u.id, 'library.doc_share', 'library_file', id, { n: i.shares.length }, null);
  return listShares(u, id);
}

/** 내보내기: .docx (기존 마크다운 → Word 변환기) · .md · 글자 */
export async function exportDoc(u: SessionUser, id: string, format: 'docx' | 'md' | 'txt') {
  const { file } = await docAccess(u, id);
  const { doc } = await loadYDoc(id);
  if (file.effective_security === 'confidential') { const { audit } = await import('./log'); await audit(db(), u.id, 'library.confidential_download', 'library_file', id, { title: file.title, folder: file.folder }, null); }
  const base = file.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || '문서';
  if (format === 'docx') return { fileName: `${base}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: writeDocx(file.title, docMarkdown(doc)) };
  if (format === 'md') return { fileName: `${base}.md`, mime: 'text/markdown; charset=utf-8', data: Buffer.from(`# ${file.title}\n\n${docMarkdown(doc)}`) };
  return { fileName: `${base}.txt`, mime: 'text/plain; charset=utf-8', data: Buffer.from(docText(doc)) };
}

// ---------------- Yjs 문서 → 글자·마크다운 ----------------
type Node = Y.XmlElement | Y.XmlText | Y.XmlHook;
function inline(n: Node, md: boolean): string {
  if (n instanceof Y.XmlText) {
    return n.toDelta().map((op: any) => {
      let s = typeof op.insert === 'string' ? op.insert : '';
      if (md && s.trim()) {
        const a = op.attributes ?? {};
        if (a.code) s = `\`${s}\``;
        if (a.bold) s = `**${s}**`;
        if (a.italic) s = `*${s}*`;
        if (a.strike) s = `~~${s}~~`;
        if (a.link?.href) s = `[${s}](${a.link.href})`;
      }
      return s;
    }).join('');
  }
  if (n instanceof Y.XmlElement) {
    if (n.nodeName === 'hardBreak') return md ? '  \n' : '\n';
    return n.toArray().map((c) => inline(c as Node, md)).join('');
  }
  return '';
}
function blocks(n: Node | Y.XmlFragment, md: boolean, depth = 0, out: string[] = []): string[] {
  if (n instanceof Y.XmlFragment && !(n instanceof Y.XmlElement)) { (n.toArray() as Node[]).forEach((k) => blocks(k, md, depth, out)); return out; } // 최상위 fragment
  if (!(n instanceof Y.XmlElement)) { const s = inline(n, md); if (s) out.push(s); return out; }
  const kids = n.toArray() as Node[];
  const ind = md ? '  '.repeat(depth) : '';
  switch (n.nodeName) {
    case 'heading': { const lv = Number(n.getAttribute('level') ?? 1); out.push(`${md ? '#'.repeat(Math.min(6, Math.max(1, lv))) + ' ' : ''}${inline(n, md)}`); break; }
    case 'paragraph': out.push(inline(n, md)); break;
    case 'codeBlock': out.push(md ? `\`\`\`\n${inline(n, false)}\n\`\`\`` : inline(n, false)); break;
    case 'blockquote': { const inner = blocks(n, md, depth, []).map((l) => (md ? `> ${l}` : l)); out.push(...inner); break; }
    case 'bulletList': case 'orderedList': {
      kids.forEach((li, i) => {
        if (!(li instanceof Y.XmlElement)) return;
        const parts = li.toArray() as Node[];
        const first = parts[0] ? blocks(parts[0], md, depth + 1, []).join('\n') : '';
        out.push(`${ind}${md ? (n.nodeName === 'bulletList' ? '- ' : `${i + 1}. `) : '• '}${first}`);
        for (const rest of parts.slice(1)) blocks(rest, md, depth + 1, out);
      });
      break;
    }
    case 'table': {
      const rows = kids.filter((r): r is Y.XmlElement => r instanceof Y.XmlElement).map((r) => (r.toArray() as Node[]).map((c) => inline(c, md).replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()));
      if (!rows.length) break;
      if (md) { out.push(`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)); }
      else out.push(...rows.map((r) => r.join('\t')));
      break;
    }
    case 'horizontalRule': out.push(md ? '---' : ''); break;
    default: kids.forEach((k) => blocks(k, md, depth, out));
  }
  return out;
}
export function docText(doc: Y.Doc) { return blocks(doc.getXmlFragment(FIELD), false).join('\n').replace(/\n{3,}/g, '\n\n').trim(); }
export function docMarkdown(doc: Y.Doc) { return blocks(doc.getXmlFragment(FIELD), true).join('\n\n').trim(); }
