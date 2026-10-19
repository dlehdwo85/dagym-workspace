import { z } from 'zod';
import { db } from './db';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo, accessibleUnitIds, taskVisibleSql, teamScope } from './access';
import { activity } from './log';
import { MAX_UPLOAD_BYTES, downloadUrl, getObject, objectSize, putObject, uploadTarget } from './storage';
import { extractText } from './textExtract';
import type { Role, SessionUser } from './types';
import { RANK, menuLevel, requireMenu } from './menuPerms';

/**
 * V9 회사 자료실: 로고·소개서·단가표·보고서. 업무 첨부와 같은 저장소(S3 호환/로컬)를 쓰고, 저장 키에 고객 회사(tenant)가 들어간다.
 * V13 4번 권한: 메뉴 권한(자료실: 보기 / 올리기·수정 / 삭제) × 폴더 권한(가까운 상위 폴더 설정을 상속, 메뉴 권한보다 넓힐 수 없음).
 * 내려받기 주소 발급·AI 비서 검색·읽기 모두 listLibrary / loadLibraryFile 을 거치므로 같은 검사를 받는다.
 */
export { tenantOf } from './types';
import { tenantOf } from './types';
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|jar|apk|ipa|dll|sh)$/i;
export const cleanFolder = (f?: string | null) => (f ?? '').split('/').map((s) => s.trim()).filter(Boolean).join('/').slice(0, 200);

export const libraryInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().positive(),
  title: z.string().trim().max(200).optional(),
  folder: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  description: z.string().max(2000).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), // V13 3번 중복 감지
  allowDuplicate: z.boolean().optional(),
  purpose: z.enum(['revenue', 'ai_attach']).optional(),
  space: z.enum(['work', 'sales', 'marketing']).optional(), // 대표 지시(10/18): 공간별 자료실(저장소는 하나) // revenue: 매출 근거 폴더 / ai_attach: AI 에게 줄 첨부(자동 정리 생략 — AI 요청 1회 아낌)
});
export const libraryPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folder: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  description: z.string().max(2000).nullable().optional(),
  security: z.enum(['public', 'internal', 'confidential']).optional(), // V14 15번 — 올리기는 편집자, 기밀을 내리거나 확인은 기밀 편집 권한
});

const COLS = `f.id, f.folder, f.security, f.security_suggested, f.security_confirmed, f.title, f.file_name, f.mime_type, f.size_bytes, f.tags, f.description, f.upload_status, f.created_at, f.updated_at, f.created_by,
  (f.text_content is not null) as has_text, f.organized_by, f.ai_confidence, f.needs_review, (f.ai_prev is not null) as can_undo, f.organize_status, f.organize_error, f.task_id, f.source`;

// ---------------- V14 15번 보안 등급 (일반·내부·기밀) ----------------
export type Security = 'public' | 'internal' | 'confidential';
export const SEC_RANK: Record<Security, number> = { public: 0, internal: 1, confidential: 2 };
export const SEC_LABEL: Record<Security, string> = { public: '일반', internal: '내부', confidential: '기밀' };
const maxSec = (a: Security, b: Security): Security => (SEC_RANK[a] >= SEC_RANK[b] ? a : b);
type SecCtx = { folders: { folder: string; security: Security }[]; internal: boolean; confidential: boolean; confEdit: boolean };
/** 사람의 등급 열람 권한 + 회사의 폴더 등급 (서버 강제 — AI 도구도 이 검사를 거친다) */
export async function secCtx(u: SessionUser): Promise<SecCtx> {
  const [folders, internal, conf] = await Promise.all([
    db()<{ folder: string; security: Security }[]>`select folder, security from library_folder_security where tenant = ${tenantOf(u)}`,
    menuLevel(u, 'library_internal'), menuLevel(u, 'confidential')]);
  return { folders, internal: RANK[internal] >= RANK.view, confidential: RANK[conf] >= RANK.view, confEdit: RANK[conf] >= RANK.edit };
}
/** 폴더 등급: 자기와 모든 상위 폴더 설정 중 가장 높은 것 */
function folderSec(c: SecCtx, folder: string): Security {
  const parts = folder.split('/').filter(Boolean);
  let s: Security = 'public';
  for (let n = 1; n <= parts.length; n++) { const p = c.folders.find((x) => x.folder === parts.slice(0, n).join('/')); if (p) s = maxSec(s, p.security); }
  return s;
}
export const effSec = (c: SecCtx, f: { folder: string; security: Security }) => maxSec(folderSec(c, f.folder), f.security);
const secAllowed = (c: SecCtx, s: Security) => s === 'public' || (s === 'internal' ? c.internal : c.confidential);
/** 이 사람이 이 파일을 볼 수 있는 등급인가 (올린 사람 본인은 항상) */
export const canSeeSec = (c: SecCtx, u: SessionUser, f: { folder: string; security: Security; created_by?: string | null }) => f.created_by === u.id || secAllowed(c, effSec(c, f));
/**
 * V34 C1·C2: 저장 파일(storage_key)의 자료실 등급(폴더 상속 포함). 자료실에서 온 파일이 아니면 null,
 * 자료실에서 모두 지웠으면 deleted — 업무 첨부 내려받기·공유 링크·외부 메일이 매번 이 값으로 다시 판단한다
 */
export async function storageSecurity(tenant: string, storageKey: string): Promise<{ security: Security; deleted: boolean } | null> {
  const sql = db();
  const all = await sql<{ folder: string; security: Security; deleted_at: Date | null; source: string }[]>`select folder, security, deleted_at, source from library_files where tenant = ${tenant} and storage_key = ${storageKey}`;
  // V38 4(로컬 검수 반영): 업무에서 자동 등록한 행(task_attach)은 업무 첨부·공유 링크 판단에 쓰지 않는다 — 업무 첨부는 기존 규칙 그대로,
  // 자료실에서 지워도(=자료실 목록에서만 숨김) 업무 첨부는 남음. 원래 자료실 파일을 붙인 경우는 V34-C2 대로 삭제·기밀이 첨부에도 적용
  const rows = all.filter((r) => r.source !== 'task_attach');
  if (!rows.length) return null;
  const folders = await sql<{ folder: string; security: Security }[]>`select folder, security from library_folder_security where tenant = ${tenant}`;
  const c: SecCtx = { folders, internal: false, confidential: false, confEdit: false };
  const live = rows.filter((r) => !r.deleted_at);
  const sec = (live.length ? live : rows).map((r) => effSec(c, r)).reduce((a, b) => maxSec(a, b), 'public' as Security);
  return { security: sec, deleted: !live.length };
}
/** 사람 id 로 기밀 열람 권한 확인 (업무 담당자 등) */
export async function userSeesConfidential(userId: string) {
  const [r] = await db()<any[]>`select id, email, name, role, status, tenant, is_demo as "isDemo" from users where id = ${userId}`;
  if (!r || r.status !== 'active') return false;
  return RANK[await menuLevel({ ...r, timezone: 'Asia/Seoul', sessionId: '' }, 'confidential')] >= RANK.view;
}
/** 이름·본문으로 기밀 후보 (AI 가 없거나 놓쳐도) */
/**
 * 기밀 이름 규칙(V38 4 로컬 검수): 내부 민감 단어 중심 — 견적·제안서·회사소개·브로슈어·카탈로그처럼 고객에게 보내는 문서는 넣지 않는다.
 * 회사 설정(회사 정보·디자인 화면)에서 관리자가 고칠 수 있고, 비우면 이 기본 목록. 주민등록번호 모양은 항상 기밀
 */
export const DEFAULT_CONF_WORDS = ['급여', '연봉', '월급', '상여', '인사평가', '인사기록', '인사카드', '평가표', '주민등록', '주민번호', '통장', '계좌', '비밀번호', '계약 원본', '계약서 원본', '근로계약', '로그인 정보', '로그인정보', '비번', '패스워드',
  '재무제표', '손익', '원가', '매입 단가', '매입단가', '매출 장부', '비밀', '기밀', 'confidential', 'salary', 'payroll'];
const RRN = /\d{6}-[1-4]\d{6}/;
const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '');
function matchWords(text: string, words: string[]) { const t = norm(text); return RRN.test(text) || words.some((w) => w.trim() && t.includes(norm(w))); }
export function ruleSecurity(text: string, words: string[] = DEFAULT_CONF_WORDS): Security | null { return matchWords(text, words) ? 'confidential' : null; }
/** 회사별 기밀 단어(설정 없으면 기본) */
export async function confWords(tenant: string): Promise<string[]> {
  const [r] = await db()<{ w: string | null }[]>`select conf_words as w from tenants where id = ${tenant}`;
  const list = (r?.w ?? '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  return list.length ? list.slice(0, 200) : DEFAULT_CONF_WORDS;
}
async function secAudit(u: SessionUser, f: any, purpose: string) {
  const { audit } = await import('./log');
  await audit(db(), u.id, `library.confidential_${purpose}`, 'library_file', f.id, { title: f.title, folder: f.folder }, null);
}

// ---------------- V13 4번 폴더 권한 ----------------
type FolderPerm = { folder: string; role: string; level: string };
const folderPerms = (u: SessionUser) => db()<FolderPerm[]>`select folder, role, level from library_folder_perms where tenant = ${tenantOf(u)}`;
/** 폴더에 대한 실제 단계: 대표는 전부, 나머지는 min(메뉴 단계, 가장 가까운 상위 폴더 설정) */
function folderLevelOf(role: Role, base: string, perms: FolderPerm[], folder: string) {
  if (role === 'owner') return base;
  const parts = folder.split('/').filter(Boolean);
  for (let n = parts.length; n >= 1; n--) {
    const p = perms.find((x) => x.role === role && x.folder === parts.slice(0, n).join('/'));
    if (p) return RANK[p.level] < RANK[base] ? p.level : base;
  }
  return base;
}
export async function folderLevel(u: SessionUser, folder: string) {
  const [base, perms] = await Promise.all([menuLevel(u, 'library'), folderPerms(u)]);
  return folderLevelOf(u.role, base, perms, cleanFolder(folder));
}
async function requireFolder(u: SessionUser, folder: string, need: 'view' | 'edit' | 'delete') {
  const lv = await folderLevel(u, folder);
  if (RANK[lv] >= RANK[need]) return lv;
  if (lv === 'none') throw notFound('자료가 없습니다');
  throw forbidden(`"${folder || '최상위'}" 폴더: ${need === 'delete' ? '삭제' : '올리기·수정'} 권한이 없습니다`);
}

/** 대표 지시(10/18): 공간별 자료실 — 볼 수 있는 공간(업무 + 배정된 영업·마케팅)의 자료만, space 를 고르면 그 공간만 */
export async function librarySpaces(u: SessionUser) { return (await (await import('./spaces')).userSpaces(u)) as string[]; }
export async function listLibrary(u: SessionUser, q: { q?: string; folder?: string; limit?: number; review?: boolean; space?: string }) {
  // 스토어 심사(10/19): 체험 계정도 자료실 보기는 됨(예시 파일) — 올리기·폴더 바꾸기는 막음
  const mySpaces = await librarySpaces(u);
  if (q.space && q.space !== 'all' && !mySpaces.includes(q.space)) throw notFound();
  const spaceList = q.space && q.space !== 'all' ? [q.space] : mySpaces;
  const base = await requireMenu(u, 'library', 'view'); // V13 메뉴 권한
  const sql = db();
  // 폴더 권한: 볼 수 있는 폴더만 (올린 사람 본인 파일은 항상 보임)
  const [perms, allFolders] = await Promise.all([folderPerms(u),
    sql<{ folder: string; n: number }[]>`select folder, sum(n)::int n from (
        select folder, 1 as n from library_files where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready'
        union all select path, 0 from library_folders where tenant = ${tenantOf(u)}) x group by folder order by folder`]);
  const sc = await secCtx(u);
  // 등급: 볼 수 있는 등급 목록 + 폴더 등급이 허용되는 폴더 (본인이 올린 파일은 항상)
  const secs = (['public', 'internal', 'confidential'] as Security[]).filter((s) => secAllowed(sc, s));
  const secFolders = allFolders.map((f) => f.folder).filter((f) => secAllowed(sc, folderSec(sc, f)));
  const units = await accessibleUnitIds(u, sql);
  const ts = await teamScope(u, sql); // 로컬 10/19: 격리 팀 구성원은 같은 팀 사람이 올린 자료·볼 수 있는 업무의 첨부만
  // V38 4: 업무 첨부에서 온 파일은 그 업무를 볼 수 있는 사람에게만(올린 사람 본인은 항상)
  const secCond = sql`f.space = any(${spaceList}::text[]) and (f.created_by = ${u.id} or (f.security = any(${secs}::text[]) and f.folder = any(${secFolders}::text[])
    and ${ts.isolated ? sql`(f.created_by = any(${ts.mates}::uuid[]) or f.task_id is not null)` : sql`true`}
    and (f.task_id is null or exists (select 1 from tasks t where t.id = f.task_id and t.deleted_at is null and ${taskVisibleSql(sql, u, units)}))))`;
  const counts = new Map((await sql<{ folder: string; n: number }[]>`select folder, count(*)::int n from library_files f where f.tenant = ${tenantOf(u)} and f.deleted_at is null
    and f.upload_status = 'ready' and ${secCond} group by folder`).map((r) => [r.folder, r.n]));
  // 빈 폴더(V14 18번)는 폴더 권한·등급만 맞으면 보이고, 파일이 있는 폴더는 볼 수 있는 파일이 있을 때만(기밀 파일만 있는 폴더의 존재를 숨김)
  const visible = allFolders.filter((f) => folderLevelOf(u.role, base, perms, f.folder) !== 'none' && (counts.has(f.folder) || (f.n === 0 && secAllowed(sc, folderSec(sc, f.folder)))))
    .map((f) => ({ folder: f.folder, n: counts.get(f.folder) ?? 0, security: folderSec(sc, f.folder), level: folderLevelOf(u.role, base, perms, f.folder) }));
  const visibleNames = visible.map((f) => f.folder);
  const terms = (q.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const like = (t: string) => `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = await sql`
    select ${sql.unsafe(COLS)}, u.name as created_by_name,
      ${terms.length ? sql`substring(f.text_content from greatest(1, strpos(lower(f.text_content), lower(${terms[0]})) - 60) for 200)` : sql`null`} as snippet
    from library_files f left join users u on u.id = f.created_by
    where f.tenant = ${tenantOf(u)} and f.deleted_at is null and f.upload_status = 'ready'
      and (f.folder = any(${visibleNames}::text[]) or f.created_by = ${u.id}) and ${secCond}
      ${q.review ? sql`and f.needs_review` : sql``}
      ${q.folder !== undefined && q.folder !== null && q.folder !== '*' ? sql`and (f.folder = ${cleanFolder(q.folder)} or f.folder like ${cleanFolder(q.folder) + '/%'})` : sql``}
      ${terms.length ? sql`and ${terms.map((t) => sql`(f.title ilike ${like(t)} or f.file_name ilike ${like(t)} or f.folder ilike ${like(t)} or array_to_string(f.tags, ' ') ilike ${like(t)}
          or coalesce(f.description, '') ilike ${like(t)} or coalesce(f.text_content, '') ilike ${like(t)})`).reduce((a, b) => sql`${a} and ${b}`)}` : sql``}
    order by ${terms.length ? sql`(f.title ilike ${like(terms[0])}) desc,` : sql``} f.updated_at desc
    limit ${Math.min(q.limit ?? 200, 500)}`;
  const [{ review }] = await sql<{ review: number }[]>`select count(*)::int review from library_files f where f.tenant = ${tenantOf(u)} and f.deleted_at is null
    and f.upload_status = 'ready' and f.needs_review and (f.folder = any(${visibleNames}::text[]) or f.created_by = ${u.id}) and ${secCond}`;
  return { secLevels: secs, confEdit: sc.confEdit, files: rows.map((r: any) => ({ ...r, effective_security: effSec(sc, r), level: r.created_by === u.id && folderLevelOf(u.role, base, perms, r.folder) === 'none' ? 'view' : folderLevelOf(u.role, base, perms, r.folder) })),
    folders: visible, review, level: base, spaces: mySpaces, spaceCounts: Object.fromEntries((await sql<{ space: string; n: number }[]>`select space, count(*)::int n from library_files f
      where f.tenant = ${tenantOf(u)} and f.deleted_at is null and f.upload_status = 'ready' and f.space = any(${mySpaces}::text[]) group by space`).map((r) => [r.space, r.n])), aiOrganize: (await import('./ai/provider')).aiEnabled() };
}

export async function createLibraryFile(u: SessionUser, i: z.infer<typeof libraryInput>) {
  denyDemo(u);
  // 매출 근거: 매출 입력 권한이 있으면 "매출 근거" 폴더에 올릴 수 있다(자료실 폴더 권한과 별개)
  const revenue = i.purpose === 'revenue' && RANK[await menuLevel(u, 'revenue')] >= RANK.edit;
  const folder = revenue ? '매출 근거' : cleanFolder(i.folder);
  if (!revenue) { await requireMenu(u, 'library', 'edit'); await requireFolder(u, folder, 'edit'); }
  const space = i.space ?? 'work';
  if (space !== 'work' && !(await librarySpaces(u)).includes(space)) throw notFound();
  if (i.size > MAX_UPLOAD_BYTES) throw badRequest(`파일은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다`);
  if (BLOCKED_EXT.test(i.fileName)) throw badRequest('실행 파일은 올릴 수 없습니다');
  await (await import('./plans')).assertStorage(u, i.size); // V10 회사 저장공간 한도
  const sql = db();
  const mime = i.mimeType || 'application/octet-stream';
  if (i.contentHash && !i.allowDuplicate) { // V13 3번: 같은 파일이 이미 있으면 알려 준다(볼 수 있는 것만)
    const dups = await sql<{ id: string; title: string; folder: string; created_by: string }[]>`select id, title, folder, created_by, security from library_files
      where tenant = ${tenantOf(u)} and content_hash = ${i.contentHash} and deleted_at is null and upload_status = 'ready' limit 5`;
    const base = await menuLevel(u, 'library'); const perms = await folderPerms(u);
    const sc = await secCtx(u);
    const d = dups.find((x: any) => x.created_by === u.id || (folderLevelOf(u.role, base, perms, x.folder) !== 'none' && canSeeSec(sc, u, x)));
    if (d) throw new HttpError(409, 'duplicate', `이미 있는 파일입니다: ${d.folder ? d.folder + ' / ' : ''}${d.title}`, { duplicate: d });
  }
  // V14 15번: 매출 근거는 기밀(확정), 그 외는 내부(대표 지시: 확인 전 기본값) — 이름이 기밀 후보면 "기밀 제안"으로 표시해 확인을 받는다
  const ruled = revenue ? 'confidential' : ruleSecurity(`${i.fileName} ${i.title ?? ''} ${(i.tags ?? []).join(' ')}`, await confWords(tenantOf(u)));
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, tags, description, created_by, content_hash, source, security, security_suggested, security_confirmed)
    values (${tenantOf(u)}, ${space}, ${folder}, ${i.title || i.fileName.replace(/\.[^.]+$/, '')}, ${i.fileName}, ${mime}, ${i.size}, ${i.tags ?? []}, ${i.description ?? null}, ${u.id},
      ${i.contentHash ?? null}, ${revenue ? 'revenue' : i.purpose === 'ai_attach' ? 'ai_attach' : 'upload'}, ${revenue ? 'confidential' : 'internal'}, ${ruled}, ${revenue}) returning id`;
  const safe = i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120);
  const key = `lib/${tenantOf(u)}/${f.id}/${safe}`;
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return { id: f.id, upload: await uploadTarget(key, mime) };
}

/** 서버가 만든 파일(AI 보고서 등)을 자료실에 바로 저장 */
export async function saveGeneratedFile(u: SessionUser, p: { fileName: string; mime: string; data: Buffer; title: string; folder: string; tags?: string[]; description?: string; source?: string; security?: Security; space?: 'work' | 'sales' | 'marketing'; extRef?: string; meta?: unknown }) {
  await (await import('./plans')).assertStorage(u, p.data.length);
  const sql = db();
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, space, ext_ref, meta, folder, title, file_name, mime_type, size_bytes, tags, description, source, created_by, upload_status, security, security_confirmed)
    values (${tenantOf(u)}, ${p.space ?? 'work'}, ${p.extRef ?? null}, ${p.meta ? sql.json(p.meta as never) : null}, ${cleanFolder(p.folder)}, ${p.title}, ${p.fileName}, ${p.mime}, ${p.data.length}, ${p.tags ?? []}, ${p.description ?? null}, ${p.source ?? 'ai'}, ${u.id}, 'pending',
      ${p.security ?? 'internal'}, ${p.security === 'confidential'}) returning id`;
  const key = `lib/${tenantOf(u)}/${f.id}/${p.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  await putObject(key, p.data, p.mime);
  await sql`update library_files set storage_key = ${key}, upload_status = 'ready', text_content = ${extractText(p.data, p.fileName, p.mime)} where id = ${f.id}`;
  return { id: f.id, storageKey: key };
}

/** purpose: open(보기·고치기) · download(내려받기) · ai(AI 가 읽음) — 기밀이면 누가·언제를 감사 기록에 남긴다 */
export async function loadLibraryFile(u: SessionUser, id: string, purpose: 'open' | 'download' | 'ai' | 'meta' = 'open') {
  if (purpose === 'ai') denyDemo(u); // 체험 계정: 보기·내려받기는 됨, AI 읽기는 막음
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('자료가 없습니다');
  const [f] = await db()<any[]>`select * from library_files where id = ${id} and tenant = ${tenantOf(u)} and deleted_at is null`;
  if (!f) throw notFound('자료가 없습니다'); // 다른 회사 자료는 없는 것처럼
  const sc = await secCtx(u);
  f.effective_security = effSec(sc, f);
  if (f.created_by !== u.id && f.space !== 'work' && !(await librarySpaces(u)).includes(f.space)) throw notFound('자료가 없습니다'); // 공간 밖 자료는 존재도 숨김
  if (f.created_by !== u.id) { // 올린 사람 본인 (매출 근거처럼 다른 경로로 올린 파일 포함)은 항상
    const ts = await teamScope(u);
    if (ts.isolated && !ts.mates.includes(f.created_by) && !f.task_id) throw notFound('자료가 없습니다'); // 격리 팀: 본사 자료는 존재도 숨김
    await requireMenu(u, 'library', 'view');
    await requireFolder(u, f.folder, 'view'); // 폴더 권한 — 서명 주소 발급·AI 읽기 전에
    if (!canSeeSec(sc, u, f)) throw notFound('자료가 없습니다'); // V14 15번: 등급 밖이면 존재도 숨김
    if (f.task_id) { // V38 4: 업무 첨부에서 온 파일 = 그 업무를 볼 수 있어야
      const { loadTaskForUser } = await import('./access');
      await loadTaskForUser(u, f.task_id).catch(() => { throw notFound('자료가 없습니다'); });
    }
  }
  if (f.effective_security === 'confidential' && purpose !== 'meta') await secAudit(u, f, purpose);
  return f;
}
const canEdit = (u: SessionUser, f: { created_by?: string | null }) => f.created_by === u.id || isAdmin(u);

export async function completeLibraryFile(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  if (f.created_by !== u.id) throw forbidden();
  if (f.upload_status === 'ready') return { ok: true, id };
  const size = await objectSize(f.storage_key);
  if (size === null) throw badRequest('업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  const text = await getObject(f.storage_key).then((b) => extractText(b, f.file_name, f.mime_type)).catch(() => null);
  await db()`update library_files set upload_status = 'ready', size_bytes = ${size}, text_content = ${text}, updated_at = now() where id = ${id}`;
  // V13 3번: 올리자마자 자동 정리(AI, 한도 소진·AI 꺼짐이면 파일명 규칙). 정리 실패는 올리기 성공에 영향 없음
  const organized = f.source === 'revenue' || f.source === 'ai_attach' ? null : await organizeLibraryFile(u, id, { keepFolder: !!f.folder }).catch(async (e: any) => {
    await db()`update library_files set organize_status = 'failed', organize_error = ${String(e?.message ?? '정리 오류').slice(0, 200)} where id = ${id}`;
    return { by: 'rule' as const, error: String(e?.message ?? '정리 오류') };
  });
  return { ok: true, id, hasText: !!text, organized };
}

export async function updateLibraryFile(u: SessionUser, id: string, i: z.infer<typeof libraryPatch>) {
  const f = await loadLibraryFile(u, id);
  await requireMenu(u, 'library', 'edit');
  if (f.created_by !== u.id) await requireFolder(u, f.folder, 'edit');
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 고칠 수 있습니다');
  const folder = i.folder !== undefined ? cleanFolder(i.folder) : f.folder;
  if (folder !== f.folder) await requireFolder(u, folder, 'edit');
  const tags = i.tags ?? f.tags;
  const sql = db();
  let security: Security = f.security, confirmed: boolean = f.security_confirmed;
  if (i.security && i.security !== f.security) {
    const sc = await secCtx(u);
    if (SEC_RANK[i.security] < SEC_RANK[f.security as Security] && f.security === 'confidential' && !sc.confEdit) throw forbidden('기밀 등급을 내리려면 "기밀 자료" 편집 권한이 필요합니다');
    if (i.security === 'confidential' && !sc.confidential && f.created_by !== u.id) throw forbidden('기밀 열람 권한이 없어 기밀로 지정할 수 없습니다');
    security = i.security; confirmed = sc.confEdit;
    const { audit } = await import('./log');
    await audit(sql, u.id, 'library.security_set', 'library_file', id, { from: f.security, to: i.security }, null);
  } else if (i.security && (await secCtx(u)).confEdit) confirmed = true; // 같은 등급 저장 = 확인
  await sql`update library_files set title = ${i.title ?? f.title}, folder = ${folder}, tags = ${tags}, description = ${i.description !== undefined ? i.description : f.description},
    needs_review = false, security = ${security}, security_confirmed = ${confirmed}, updated_at = now() where id = ${id}`;
  // 자동 정리된 파일을 사람이 고치면 회사별 학습 예시로 남긴다 → 다음 정리에 반영
  if (f.organized_by && (folder !== f.folder || String(tags) !== String(f.tags)))
    await sql`insert into library_rules (tenant, file_name, mime_type, folder, tags, created_by) values (${tenantOf(u)}, ${f.file_name}, ${f.mime_type}, ${folder}, ${tags}, ${u.id})`;
  return { ok: true };
}
/** 대기열 ②(AI 기밀 도구): 이름·본문 규칙이 "기밀 후보"로 표시했지만 아직 기밀로 확정되지 않은 자료 — 기밀 편집 권한(기밀 관리자)만 본다 */
export async function listConfidentialSuggestions(u: SessionUser, limit = 50) {
  const sc = await secCtx(u);
  if (!sc.confEdit) throw forbidden('"기밀 자료" 편집 권한이 있어야 기밀 후보를 볼 수 있습니다');
  const base = await menuLevel(u, 'library'); const perms = await folderPerms(u);
  const rows = await db()<{ id: string; title: string; folder: string; file_name: string; security: Security; created_by: string; created_at: Date; tags: string[] }[]>`
    select id, title, folder, file_name, security, created_by, created_at, tags from library_files
    where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready' and security_suggested = 'confidential'
      and (security <> 'confidential' or security_confirmed = false) order by created_at desc limit ${limit * 2}`;
  return rows.filter((f) => folderLevelOf(u.role, base, perms, f.folder) !== 'none' && canSeeSec(sc, u, f)).slice(0, limit)
    .map((f) => ({ id: f.id, title: f.title, folder: f.folder, fileName: f.file_name, security: f.security, tags: f.tags, createdAt: f.created_at }));
}
export async function deleteLibraryFile(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  // 삭제 단계 권한이 있으면 누구 파일이든, 올리기·수정 단계면 내가 올린 파일만
  const lv = await folderLevel(u, f.folder);
  if (!(RANK[lv] >= RANK.delete || (f.created_by === u.id && RANK[await menuLevel(u, 'library')] >= RANK.edit)))
    throw forbidden('자료실: 삭제 권한이 없습니다 — 대표에게 요청하세요');
  await db()`update library_files set deleted_at = now() where id = ${id}`;
  return { ok: true };
}
export async function libraryDownload(u: SessionUser, id: string, inline: boolean) {
  const f = await loadLibraryFile(u, id, 'download');
  if (f.upload_status !== 'ready') throw notFound();
  return downloadUrl(f.storage_key, f.file_name, inline && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(f.mime_type));
}

/** 자료를 업무에 첨부 (같은 저장 파일을 가리킴 — 복사하지 않음) */
export async function attachLibraryToTask(u: SessionUser, fileId: string, taskId: string) {
  const f = await loadLibraryFile(u, fileId, 'meta');
  if (f.upload_status !== 'ready') throw badRequest('아직 올리는 중인 자료입니다');
  const { assertAttachTarget } = await import('./attachments');
  await assertAttachTarget(u, taskId, null);
  const sql = db();
  if (f.effective_security === 'confidential') await assertConfidentialAudience(taskId); // V14 15번
  const [a] = await sql<{ id: string }[]>`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, doc_title, source, created_by)
    values (${taskId}, 'file', ${f.storage_key}, ${f.file_name}, ${f.mime_type}, ${f.size_bytes}, 'ready', ${f.title}, 'other', ${u.id}) returning id`;
  await activity(sql, 'task', taskId, u.id, 'file_attached', { name: f.file_name, size: Number(f.size_bytes), from: 'library' });
  return { id: a.id };
}

/** 기밀 자료·기밀 근거 결과물: 업무에 관계된 모든 사람(담당·지시·만든 사람·협업자)이 기밀 열람 권한이 있어야 한다 */
export async function assertConfidentialAudience(taskId: string, extraUserIds: string[] = []) {
  const sql = db();
  const [t] = await sql<any[]>`select assignee_id, requested_by, created_by from tasks where id = ${taskId}`;
  const collab = (await sql<{ user_id: string }[]>`select user_id from task_collaborators where task_id = ${taskId}`.catch(() => [])).map((r) => r.user_id);
  const ids = [...new Set([t?.assignee_id, t?.requested_by, t?.created_by, ...collab, ...extraUserIds].filter(Boolean) as string[])];
  for (const id of ids) if (!(await userSeesConfidential(id))) throw forbidden('기밀 자료 — 이 업무에 기밀 열람 권한이 없는 사람이 있어 붙일 수 없습니다');
}

// ---------------- V13 3번 자료실 자동 정리 ----------------
const tokens = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase().split(/[\s_\-.()[\]]+/).filter((t) => t.length >= 2);
/** AI 없이: 회사가 고친 예시 중 파일명 낱말이 가장 많이 겹치는 것의 폴더·태그를 따른다 */
function ruleGuess(fileName: string, rules: { file_name: string; folder: string; tags: string[] }[]) {
  const mine = new Set(tokens(fileName));
  let best: (typeof rules)[number] | null = null; let score = 0;
  for (const r of rules) { const s = tokens(r.file_name).filter((t) => mine.has(t)).length; if (s > score) { score = s; best = r; } }
  return best && score > 0 ? { folder: best.folder, tags: best.tags, confidence: Math.min(0.9, 0.4 + score * 0.2) } : null;
}
const ORG_SYSTEM = `회사 자료실 정리 담당입니다. 파일 하나의 이름·종류·본문 일부(또는 이미지)를 보고 폴더·태그·제목·한 줄 요약을 정해 JSON 으로 답하세요.
- 폴더는 "상위/하위" 형식, 가능하면 이미 있는 폴더를 쓰고 없을 때만 새로 만드세요. 예: 회사명_로고_가로형.png → 브랜드자료/회사명, 태그 로고·회사명·가로형.
- 회사가 직접 고친 예시가 있으면 그 규칙(같은 종류는 같은 폴더)을 우선 따르세요.
- 태그는 3~6개, # 없이 짧게. 제목은 사람이 읽기 좋게(확장자 없이). 요약은 한 문장.
- confidence 는 0~1, 내용을 확인하지 못했거나 애매하면 0.5 이하.
- security(보안 등급): 매출·급여·인사·계약서·주민번호·계좌·견적 단가·정산·손익 등 민감하면 "confidential", 회사 내부용이면 "internal", 누구에게 보여도 되는 홍보물·로고면 "public".`;
export async function organizeLibraryFile(u: SessionUser, id: string, opt: { keepFolder?: boolean; preview?: boolean } = {}) {
  const sql = db();
  const [f] = await sql<any[]>`select * from library_files where id = ${id} and tenant = ${tenantOf(u)} and deleted_at is null`;
  if (!f) throw notFound();
  const prev = { folder: f.folder, title: f.title, tags: f.tags, description: f.description };
  const [rules, folders] = await Promise.all([
    sql<{ file_name: string; folder: string; tags: string[] }[]>`select file_name, folder, tags from library_rules where tenant = ${tenantOf(u)} order by created_at desc limit 40`,
    sql<{ folder: string }[]>`select distinct folder from library_files where tenant = ${tenantOf(u)} and deleted_at is null and folder <> '' order by folder limit 80`,
  ]);
  let out: { folder: string; tags: string[]; title?: string; summary?: string; confidence: number; security?: Security } | null = null;
  let by: 'ai' | 'rule' = 'rule';
  let reason: string | null = null; // V14 3번: AI 로 정리하지 못한 이유(화면에 표시)
  if (!opt.preview) await sql`update library_files set organize_status = 'pending', organize_error = null where id = ${id}`;
  const { aiEnabled, anthropicProvider, costUsd } = await import('./ai/provider');
  const quota = aiEnabled() ? await (await import('./plans')).assertAiRequest(u).then(() => null, (e: any) => e?.message ?? '이번 달 AI 한도를 모두 썼습니다') : '내장 AI 가 꺼져 있습니다(운영자 설정)';
  if (quota) reason = quota;
  else {
    const provider = anthropicProvider({ tier: 'fast' });
    const isImg = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime_type) && Number(f.size_bytes) <= 3_500_000;
    const isPdf = f.mime_type === 'application/pdf' && !f.text_content && Number(f.size_bytes) <= 8_000_000;
    const bin = isImg || isPdf ? await getObject(f.storage_key).catch(() => null) : null;
    const info = `파일명: ${f.file_name}\n종류: ${f.mime_type}\n지금 폴더: ${f.folder || '(없음)'}\n이미 있는 폴더: ${folders.map((x) => x.folder).join(', ') || '(없음)'}\n` +
      `회사가 고친 예시: ${rules.slice(0, 20).map((r) => `${r.file_name} → ${r.folder} [${r.tags.join(',')}]`).join(' / ') || '(없음)'}\n` +
      (f.text_content ? `본문 일부:\n${String(f.text_content).slice(0, 2500)}` : '(본문 글자 없음)');
    const schema = { type: 'object', additionalProperties: false, required: ['folder', 'tags', 'title', 'summary', 'confidence', 'security'], properties: {
      folder: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, summary: { type: 'string' }, confidence: { type: 'number' },
      security: { type: 'string', enum: ['public', 'internal', 'confidential'] } } };
    const content = [
      ...(bin && isImg ? [{ type: 'image', source: { type: 'base64', media_type: f.mime_type === 'image/jpg' ? 'image/jpeg' : f.mime_type, data: bin.toString('base64') } }] : []),
      ...(bin && isPdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bin.toString('base64') } }] : []),
      { type: 'text', text: info }] as never;
    const ask = (format: boolean) => provider.chat({ system: ORG_SYSTEM + (format ? '' : '\n반드시 {"folder","tags","title","summary","confidence","security"} JSON 하나만 답하세요.'), tools: [], ...(format ? { format: schema } : {}), messages: [{ role: 'user', content }] });
    try {
      // 구조화 출력이 거절되면(400) 일반 답변 + JSON 추출로 한 번 더
      const r = await ask(true).catch((e: any) => (e?.status === 400 ? ask(false) : Promise.reject(e)));
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenantOf(u)}, ${u.id}, ${crypto.randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens},
          ${r.usage.cache_read_input_tokens ?? 0}, ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, r.usage)}, 'library_organize')`;
      const text = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const m = /\{[\s\S]*\}/.exec(text);
      if (!m) throw new Error('AI 답을 해석하지 못했습니다');
      const j = JSON.parse(m[0]);
      out = { folder: String(j.folder ?? ''), tags: (Array.isArray(j.tags) ? j.tags : []).map(String), title: String(j.title ?? ''), summary: String(j.summary ?? ''), confidence: Number(j.confidence) || 0,
        security: ['public', 'internal', 'confidential'].includes(j.security) ? j.security : undefined };
      by = 'ai';
    } catch (e: any) {
      out = null;
      reason = e?.status ? `AI 서버 오류(${e.status})${e?.error?.error?.message ? ': ' + String(e.error.error.message).slice(0, 120) : ''}` : String(e?.message ?? 'AI 오류').slice(0, 200);
      const { logError } = await import('./log');
      await logError('library.organize', e, { fileId: id });
    }
  }
  if (!out) { // AI 꺼짐·한도 소진·실패 → 파일명 규칙
    const g = ruleGuess(f.file_name, rules);
    out = g ? { ...g } : { folder: '', tags: tokens(f.file_name).slice(0, 4), confidence: 0.3 };
  }
  let folder = opt.keepFolder ? f.folder : cleanFolder(out.folder) || f.folder;
  if (folder !== f.folder && RANK[await folderLevel(u, folder)] < RANK.edit) folder = f.folder; // 권한 없는 폴더로는 옮기지 않는다
  const tags = [...new Set([...f.tags, ...out.tags.map((t) => t.replace(/^#/, '').trim().slice(0, 30)).filter(Boolean)])].slice(0, 20);
  const title = (out.title || '').trim().slice(0, 200) || f.title;
  const description = f.description || (out.summary || '').trim().slice(0, 500) || null;
  const confidence = Math.max(0, Math.min(1, out.confidence));
  // V14 15번 등급 제안: AI 답 + 이름·본문 규칙 중 높은 쪽. 등급 자체는 기밀 관리자가 확인할 때까지 그대로(기본 내부) — 화면에 "기밀 제안" 표시
  const suggested: Security = maxSec(out.security ?? 'internal', ruleSecurity(`${f.file_name} ${title} ${tags.join(' ')} ${String(f.text_content ?? '').slice(0, 3000)}`, await confWords(tenantOf(u))) ?? 'public');
  const security: Security = f.security;
  const result = { by, folder, tags, title, description, confidence, reason, suggested };
  if (opt.preview) { // V14 18번: 관리자 전체 정리 미리보기 — 적용 전까지 아무것도 바꾸지 않는다
    await sql`update library_files set organize_preview = ${sql.json(result as never)} where id = ${id}`;
    return { by, folder, tags, title, description, confidence, needsReview: confidence < 0.6, error: reason, security, suggestedSecurity: suggested, preview: true };
  }
  await applyOrganize(id, prev, result);
  return { by, folder, tags, title, description, confidence, needsReview: confidence < 0.6, error: reason, security, suggestedSecurity: suggested };
}
export async function undoOrganize(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 되돌릴 수 있습니다');
  if (!f.ai_prev) throw badRequest('되돌릴 자동 정리가 없습니다');
  const p = f.ai_prev;
  await db()`update library_files set folder = ${p.folder ?? ''}, title = ${p.title ?? f.title}, tags = ${p.tags ?? []}, description = ${p.description ?? null},
    organized_by = null, ai_confidence = null, needs_review = false, ai_prev = null, updated_at = now() where id = ${id}`;
  return { ok: true };
}
export async function reorganize(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  await requireMenu(u, 'library', 'edit');
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 다시 정리할 수 있습니다');
  return organizeLibraryFile(u, id);
}

type OrgResult = { by: string; folder: string; tags: string[]; title: string; description: string | null; confidence: number; reason: string | null; suggested: Security };
async function applyOrganize(id: string, prev: unknown, r: OrgResult) {
  await db()`update library_files set security_suggested = ${r.suggested}, folder = ${r.folder}, tags = ${r.tags}, title = ${r.title}, description = ${r.description}, organized_by = ${r.by},
    ai_confidence = ${r.confidence}, needs_review = ${r.confidence < 0.6}, ai_prev = ${db().json(prev as never)}, updated_at = now(), organize_preview = null,
    organize_status = ${r.by === 'ai' ? 'done' : 'failed'}, organize_error = ${r.reason} where id = ${id}`;
}
/** 전체 정리 미리보기를 고른 것만 적용 */
export async function applyOrganizePreviews(u: SessionUser, ids: string[]) {
  if (!isAdmin(u)) throw forbidden('대표·본사 관리자만 전체 정리할 수 있습니다');
  const rows = await db()<any[]>`select id, folder, title, tags, description, organize_preview from library_files where tenant = ${tenantOf(u)} and id = any(${ids}::uuid[]) and organize_preview is not null`;
  for (const f of rows) await applyOrganize(f.id, { folder: f.folder, title: f.title, tags: f.tags, description: f.description }, f.organize_preview);
  return { applied: rows.length };
}

// ---------------- V13 4번 폴더 권한 설정 (대표만) ----------------
export const folderPermInput = z.object({ folder: z.string().min(1).max(200), role: z.enum(['admin', 'dept_lead', 'site_manager', 'staff']), level: z.enum(['none', 'view', 'edit', 'delete']).nullable() });
export async function listFolderPerms(u: SessionUser) {
  if (u.role !== 'owner' || u.isDemo) throw forbidden('대표만 폴더 권한을 바꿀 수 있습니다');
  return { perms: await folderPerms(u) };
}
export async function setFolderPerm(u: SessionUser, i: z.infer<typeof folderPermInput>, ip: string | null) {
  if (u.role !== 'owner' || u.isDemo) throw forbidden('대표만 폴더 권한을 바꿀 수 있습니다');
  const sql = db(); const folder = cleanFolder(i.folder);
  if (!folder) throw badRequest('폴더를 고르세요');
  if (i.level === null) await sql`delete from library_folder_perms where tenant = ${tenantOf(u)} and folder = ${folder} and role = ${i.role}`;
  else await sql`insert into library_folder_perms (tenant, folder, role, level, updated_by) values (${tenantOf(u)}, ${folder}, ${i.role}, ${i.level}, ${u.id})
    on conflict (tenant, folder, role) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = now()`;
  const { audit } = await import('./log');
  await audit(sql, u.id, 'library_folder_perm.set', null, null, { folder, role: i.role, level: i.level }, ip);
  return { ok: true };
}

/** V14 3번: 관리자 "전체 정리" — 아직 정리하지 않았거나 실패한 파일을 한 번에 최대 10개씩(화면이 반복 호출) */
export async function organizeAll(u: SessionUser, opt: { preview?: boolean } = {}) {
  if (!isAdmin(u)) throw forbidden('대표·본사 관리자만 전체 정리할 수 있습니다');
  await requireMenu(u, 'library', 'edit');
  const sql = db();
  const rows = await sql<{ id: string }[]>`select id from library_files where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready'
    and source not in ('revenue', 'ai_attach') and (organize_status is null or organize_status in ('failed', 'pending')) and organized_by is distinct from 'ai'
    ${opt.preview ? sql`and organize_preview is null` : sql``}
    order by (organize_status is null) desc, created_at desc limit 10`;
  let ai = 0, failed = 0;
  const previews: any[] = [];
  for (const r of rows) {
    const o: any = await organizeLibraryFile(u, r.id, { preview: opt.preview }).catch(() => null);
    if (o?.by === 'ai') ai++; else failed++;
    if (opt.preview && o) previews.push({ id: r.id, ...o });
  }
  if (opt.preview) { // 미리보기: 같은 파일을 다시 고르지 않게 이번 묶음 다음부터
    const before = await db()<{ id: string; title: string; folder: string }[]>`select id, title, folder from library_files where id = any(${rows.map((r) => r.id)}::uuid[])`;
    return { preview: previews.map((p) => ({ ...p, from: before.find((b) => b.id === p.id) })), ai, failed };
  }
  const [{ left }] = await sql<{ left: number }[]>`select count(*)::int left from library_files where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready'
    and source not in ('revenue', 'ai_attach') and organize_status is null and organized_by is distinct from 'ai'`;
  return { done: rows.length, ai, failed, left };
}

// ---------------- V14 15번 폴더 등급 · 기밀 열람 기록 ----------------
export const folderSecInput = z.object({ folder: z.string().min(1).max(200), security: z.enum(['public', 'internal', 'confidential']).nullable() });
export async function listFolderSecurity(u: SessionUser) {
  const sc = await secCtx(u);
  return { folders: sc.folders, confEdit: sc.confEdit };
}
export async function setFolderSecurity(u: SessionUser, i: z.infer<typeof folderSecInput>, ip: string | null) {
  const sc = await secCtx(u);
  const folder = cleanFolder(i.folder);
  const cur = sc.folders.find((x) => x.folder === folder)?.security;
  // 기밀 편집 권한자는 모두, 그 외 대표·관리자는 올리기만(기밀 지정은 기밀 열람 권한 필요)
  if (!sc.confEdit) {
    if (!isAdmin(u)) throw forbidden('폴더 등급은 대표·관리자가 정합니다');
    if (cur === 'confidential' || i.security === null || (i.security === 'confidential' && !sc.confidential) || (cur && SEC_RANK[i.security] < SEC_RANK[cur]))
      throw forbidden('등급을 내리거나 기밀로 정하려면 "기밀 자료" 편집 권한이 필요합니다');
  }
  const sql = db();
  if (i.security === null) await sql`delete from library_folder_security where tenant = ${tenantOf(u)} and folder = ${folder}`;
  else await sql`insert into library_folder_security (tenant, folder, security, updated_by) values (${tenantOf(u)}, ${folder}, ${i.security}, ${u.id})
    on conflict (tenant, folder) do update set security = excluded.security, updated_by = excluded.updated_by, updated_at = now()`;
  const { audit } = await import('./log');
  await audit(sql, u.id, 'library.folder_security_set', null, null, { folder, from: cur ?? null, to: i.security }, ip);
  return { ok: true };
}
/** 기밀 자료 열람·내려받기·AI 참조 기록 (기밀 편집 권한자) */
export async function confidentialLog(u: SessionUser) {
  if (!(await secCtx(u)).confEdit) throw notFound();
  return db()`select a.id, a.action, a.target_id, a.detail, a.created_at, x.name as user_name from audit_logs a left join users x on x.id = a.actor_id
    where a.action like 'library.confidential_%' and a.actor_id in (select id from users where tenant = ${tenantOf(u)}) order by a.id desc limit 200`;
}

// ---------------- V14 18번 폴더 탐색기: 만들기·이름 바꾸기(옮기기)·삭제·여러 파일 옮기기 ----------------
export const folderInput = z.object({ path: z.string().min(1).max(200) });
export const folderRenameInput = z.object({ from: z.string().min(1).max(200), to: z.string().min(1).max(200) });
export const moveInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), folder: z.string().max(200) });
export async function createFolder(u: SessionUser, i: z.infer<typeof folderInput>) {
  denyDemo(u);
  await requireMenu(u, 'library', 'edit');
  const path = cleanFolder(i.path);
  if (!path) throw badRequest('폴더 이름을 입력하세요');
  await requireFolder(u, path, 'edit');
  await db()`insert into library_folders (tenant, path, created_by) values (${tenantOf(u)}, ${path}, ${u.id}) on conflict do nothing`;
  return { ok: true, path };
}
const under = (path: string) => [path, path + '/%'];
export async function renameFolder(u: SessionUser, i: z.infer<typeof folderRenameInput>, ip: string | null) {
  denyDemo(u);
  await requireMenu(u, 'library', 'edit');
  const from = cleanFolder(i.from), to = cleanFolder(i.to);
  if (!from || !to) throw badRequest('폴더를 고르세요');
  if (to === from || to.startsWith(from + '/')) throw badRequest('자기 안으로는 옮길 수 없습니다');
  await requireFolder(u, from, 'delete'); await requireFolder(u, to, 'edit');
  const sql = db(); const t = tenantOf(u); const [eq, like] = under(from);
  // 보이지 않는(등급 밖) 파일이 있으면 옮기지 않는다 — 남의 기밀 파일을 모르게 옮기는 일 방지
  const sc = await secCtx(u);
  const files = await sql<any[]>`select id, folder, security, created_by from library_files where tenant = ${t} and deleted_at is null and (folder = ${eq} or folder like ${like})`;
  if (files.some((f) => !canSeeSec(sc, u, f))) throw forbidden('이 폴더에 볼 수 없는 등급의 자료가 있어 옮길 수 없습니다 — 기밀 편집 권한자에게 요청하세요');
  const re = (p: string) => to + p.slice(from.length);
  await sql.begin(async (tx) => {
    for (const f of files) await tx`update library_files set folder = ${re(f.folder)}, updated_at = now() where id = ${f.id}`;
    for (const r of await tx<{ path: string }[]>`select path from library_folders where tenant = ${t} and (path = ${eq} or path like ${like})`)
      await tx`insert into library_folders (tenant, path, created_by) values (${t}, ${re(r.path)}, ${u.id}) on conflict do nothing`;
    await tx`delete from library_folders where tenant = ${t} and (path = ${eq} or path like ${like})`;
    await tx`insert into library_folders (tenant, path, created_by) values (${t}, ${to}, ${u.id}) on conflict do nothing`;
    for (const r of await tx<{ folder: string }[]>`select distinct folder from library_folder_perms where tenant = ${t} and (folder = ${eq} or folder like ${like})`)
      await tx`update library_folder_perms set folder = ${re(r.folder)} where tenant = ${t} and folder = ${r.folder}`;
    for (const r of await tx<{ folder: string }[]>`select folder from library_folder_security where tenant = ${t} and (folder = ${eq} or folder like ${like})`)
      await tx`update library_folder_security set folder = ${re(r.folder)} where tenant = ${t} and folder = ${r.folder}`;
    const { audit } = await import('./log');
    await audit(tx, u.id, 'library.folder_rename', null, null, { from, to, files: files.length }, ip);
  });
  return { ok: true, moved: files.length };
}
export async function deleteFolder(u: SessionUser, i: z.infer<typeof folderInput>) {
  denyDemo(u);
  const path = cleanFolder(i.path);
  await requireFolder(u, path, 'delete');
  const sql = db(); const t = tenantOf(u); const [eq, like] = under(path);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from library_files where tenant = ${t} and deleted_at is null and (folder = ${eq} or folder like ${like})`;
  if (n) throw new HttpError(409, 'not_empty', `폴더 안에 자료가 ${n}개 있습니다. 먼저 옮기거나 지우세요`);
  await sql`delete from library_folders where tenant = ${t} and (path = ${eq} or path like ${like})`;
  return { ok: true };
}
/** 여러 파일 한 번에 옮기기 — 파일마다 기존 권한 검사, 못 옮긴 것은 이유와 함께 */
export async function moveFiles(u: SessionUser, i: z.infer<typeof moveInput>) {
  const folder = cleanFolder(i.folder);
  const done: string[] = []; const skipped: { id: string; reason: string }[] = [];
  for (const id of i.ids) {
    try { await updateLibraryFile(u, id, { folder }); done.push(id); } catch (e: any) { skipped.push({ id, reason: String(e?.message ?? '실패') }); }
  }
  if (folder) await db()`insert into library_folders (tenant, path, created_by) values (${tenantOf(u)}, ${folder}, ${u.id}) on conflict do nothing`;
  return { moved: done.length, skipped };
}

/**
 * V38 4: 업무에 올린 파일을 자료실에도 자동 등록 — 같은 파일 하나(storage_key 공유, 복사 없음), 폴더 = 프로젝트 이름 또는 "업무 첨부/연-월",
 * 등급은 이름 규칙(기밀 단어면 기밀, 아니면 내부), 그 업무를 볼 수 있는 사람만 자료실에서도 보임. 회사 설정으로 끌 수 있음(기본 켬).
 * 자료실에서 고른 파일을 첨부한 경우(이미 자료실에 있음)·링크는 건너뜀. 실패해도 첨부 자체는 그대로.
 */
export async function registerTaskAttachment(u: SessionUser, a: { id: string; task_id: string | null; storage_key: string | null; file_name: string; mime_type: string; source: string }, size: number) {
  if (!a.task_id || !a.storage_key || a.source === 'library') return null;
  const sql = db();
  const t = tenantOf(u);
  const [ten] = await sql<{ on: boolean }[]>`select attach_to_library as on from tenants where id = ${t}`;
  if (ten && !ten.on) return null;
  const [dup] = await sql`select 1 from library_files where tenant = ${t} and storage_key = ${a.storage_key} limit 1`;
  if (dup) return null;
  const [task] = await sql<{ title: string; project: string | null }[]>`select t.title, p.name as project from tasks t left join projects p on p.id = t.project_id where t.id = ${a.task_id}`;
  if (!task) return null;
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  const folder = cleanFolder(task.project ? `업무 첨부/${task.project}` : `업무 첨부/${month}`);
  const title = a.file_name.replace(/\.[^.]+$/, '').slice(0, 200) || a.file_name;
  // 등급(V34-C5): 이름 규칙이 기밀이면 기밀로 저장 → 기밀 권한 없는 사람은 자료실 목록에서 안 보임(관리자가 내리기).
  // 업무 화면 첨부는 이 행의 등급과 무관하게 기존 규칙(storageSecurity 가 task_attach 행을 보지 않음)
  const suggested = ruleSecurity(`${a.file_name} ${task.title}`, await confWords(t));
  const security = suggested ?? 'internal';
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, storage_key, upload_status, tags, description, source, created_by, task_id, security, security_suggested)
    values (${t}, ${folder}, ${title}, ${a.file_name}, ${a.mime_type}, ${size}, ${a.storage_key}, 'ready', ${['업무 첨부']}, ${`업무: ${task.title}`}, 'task_attach', ${u.id}, ${a.task_id}, ${security}, ${suggested})
    returning id`;
  return f.id;
}
/** 회사 설정: 업무 첨부 자료실 자동 등록 켜기/끄기 */
export async function getAttachToLibrary(u: SessionUser) {
  const [r] = await db()<{ on: boolean; w: string | null }[]>`select attach_to_library as on, conf_words as w from tenants where id = ${tenantOf(u)}`;
  return { on: r?.on ?? true, confWords: await confWords(tenantOf(u)), confWordsDefault: !r?.w?.trim(), defaults: DEFAULT_CONF_WORDS };
}
/** 업무 첨부 자료실 자동 저장 켜기/끄기 · 기밀 이름 규칙 단어(빈 목록 = 기본) — 회사 정보·디자인 편집 권한 */
export async function setAttachToLibrary(u: SessionUser, i: { on?: boolean; confWords?: string[] | null }) {
  const { requireAnyMenu } = await import('./menuPerms');
  await requireAnyMenu(u, ['company', 'ops'], 'edit');
  const sql = db();
  if (i.on !== undefined) await sql`update tenants set attach_to_library = ${i.on} where id = ${tenantOf(u)}`;
  if (i.confWords !== undefined) {
    const list = (i.confWords ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 200);
    await sql`update tenants set conf_words = ${list.length ? list.join(', ') : null} where id = ${tenantOf(u)}`;
  }
  return getAttachToLibrary(u);
}
