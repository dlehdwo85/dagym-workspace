import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { badRequest } from './errors';
import { audit } from './log';
import { notify } from './notifications';
import { unzip } from './textExtract';
import { createTask } from './tasks';
import { todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';

/**
 * V30 P1 ① 엑셀·CSV 로 업무 한꺼번에 가져오기.
 * 1) 파일 → 표(첫 시트, 첫 줄 = 머리글) 2) 머리글로 열 짝 추측 3) 미리보기(담당자 이름·이메일 맞추기·날짜·우선순위·상태 해석, 오류 줄 표시) 4) 만들기.
 * 서버는 표를 기억하지 않는다 — 화면이 표·짝을 그대로 다시 보낸다(최대 500줄).
 */
export const MAX_ROWS = 500;
export const FIELDS = ['title', 'description', 'assignee', 'dueDate', 'startDate', 'priority', 'status', 'project', 'tags'] as const;
export type Field = typeof FIELDS[number];
export const FIELD_LABEL: Record<Field, string> = { title: '제목', description: '설명', assignee: '담당자', dueDate: '마감일', startDate: '시작일', priority: '우선순위', status: '상태', project: '프로젝트', tags: '태그' };
const HINTS: Record<Field, RegExp> = {
  title: /^(제목|업무|업무명|할\s*일|task|title|name|작업|항목|내용 ?요약)$/i,
  description: /^(설명|내용|상세|비고|메모|notes?|description)$/i,
  assignee: /^(담당|담당자|담당자명|assignee|owner|담당 ?이메일|책임자|처리자)$/i,
  dueDate: /^(마감|마감일|기한|완료 ?예정일?|due|due ?date|deadline|종료일)$/i,
  startDate: /^(시작|시작일|start|start ?date)$/i,
  priority: /^(우선순위|중요도|priority|긴급도)$/i,
  status: /^(상태|진행 ?상태|status|진행)$/i,
  project: /^(프로젝트|project|현장|분류)$/i,
  tags: /^(태그|tags?|라벨|labels?)$/i,
};

// ── 파일 읽기 ──────────────────────────────────────────────
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');
const colIndex = (ref: string) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** CSV(따옴표·줄바꿈 안 칸 처리). 엑셀 한글 CSV 는 CP949 일 수 있어 UTF-8 이 깨지면 EUC-KR 로 다시 읽는다 */
export function parseCsv(buf: Buffer): string[][] {
  let text = buf.toString('utf8');
  if (text.includes('�')) { try { text = new TextDecoder('euc-kr').decode(buf); } catch { /* 그대로 */ } }
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n', 1)[0].match(/\t/g)?.length ?? 0) > (text.split('\n', 1)[0].match(/,/g)?.length ?? 0) ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** xlsx 첫 시트. 날짜 서식 칸(숫자)은 YYYY-MM-DD 로 */
export function parseXlsx(buf: Buffer): string[][] {
  const z = unzip(buf);
  if (!z.size) throw badRequest('엑셀 파일을 열 수 없습니다 — .xlsx 또는 .csv 로 저장해 주세요');
  const get = (k: string) => z.get(k)?.().toString('utf8') ?? '';
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  // 날짜 서식 번호(14~22 기본, 사용자 서식은 y·m·d 가 들어간 것)
  const styles = get('xl/styles.xml');
  const custom = new Map([...styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), unxml(m[2])]));
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '').matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map((m) => Number(m[1]));
  const isDateFmt = (id: number) => (id >= 14 && id <= 22) || (id >= 176 && /[yd]/i.test(custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, '') ?? ''));
  const wb = get('xl/workbook.xml'); const rels = get('xl/_rels/workbook.xml.rels');
  const rid = /<sheet\b[^>]*?r:id="([^"]*)"/.exec(wb)?.[1];
  const target = rid ? new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1] : null;
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`) : 'xl/worksheets/sheet1.xml';
  const xml = get(path);
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rn = Number(/\br="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1]; const t = /\bt="(\w+)"/.exec(c[1])?.[1]; const st = Number(/\bs="(\d+)"/.exec(c[1])?.[1] ?? -1);
      const body = c[2] ?? ''; const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (t === 'inlineStr') val = unxml([...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
      else if (t === 's') val = shared[Number(v)] ?? '';
      else if (v !== undefined) {
        val = unxml(v);
        if (!t && st >= 0 && isDateFmt(xfs[st] ?? 0) && /^\d+(\.\d+)?$/.test(val)) val = serialDate(Number(val));
      }
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows[rn] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}
const serialDate = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);

export const parseInput = z.object({ fileName: z.string().max(200), data: z.string().max(4_400_000) });
/** 파일(base64) → 머리글·줄·추측한 짝 */
export function parseFile(i: z.infer<typeof parseInput>) {
  const buf = Buffer.from(i.data, 'base64');
  if (buf.length > 3 * 1024 * 1024) throw badRequest('파일이 너무 큽니다(3MB 까지) — 필요 없는 열·시트를 지우거나 CSV 로 저장해 주세요');
  const ext = i.fileName.toLowerCase().split('.').pop();
  if (ext === 'xls') throw badRequest('예전 엑셀 파일(.xls)은 열 수 없습니다. 엑셀에서 [다른 이름으로 저장]을 눌러 .xlsx나 CSV로 다시 저장해 주세요');
  const all = (ext === 'xlsx' ? parseXlsx(buf) : parseCsv(buf)).map((r) => r.map((c) => String(c ?? '').trim()));
  const nonEmpty = all.filter((r) => r.some((c) => c));
  if (!nonEmpty.length) throw badRequest('파일에 내용이 없습니다');
  const [head, ...rows] = nonEmpty;
  const width = Math.max(head.length, ...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, k) => head[k] || `열 ${k + 1}`);
  if (rows.length > MAX_ROWS) throw badRequest(`한 번에 ${MAX_ROWS}줄까지 가져올 수 있습니다(지금 ${rows.length}줄) — 파일을 나눠 주세요`);
  return { headers, rows: rows.map((r) => Array.from({ length: width }, (_, k) => r[k] ?? '')), mapping: guessMapping(headers) };
}
export function guessMapping(headers: string[]) {
  const m: Partial<Record<Field, number>> = {};
  headers.forEach((h, k) => { const f = FIELDS.find((x) => m[x] === undefined && HINTS[x].test(h.replace(/\s*\(.*\)\s*$/, '').trim())); if (f) m[f] = k; });
  if (m.title === undefined && headers.length) m.title = 0;
  return m;
}

// ── 값 해석 ───────────────────────────────────────────────
/** 2026-10-20 · 2026.10.20 · 2026/10/20 · 10/20 · 10월 20일 · 20261020 · 오늘·내일 */
export function parseDate(s: string, today = todaySeoul()): string | null | undefined {
  const t = s.trim(); if (!t) return null;
  const y0 = Number(today.slice(0, 4));
  const ok = (y: number, mo: number, d: number) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : undefined;
  };
  let m;
  if (t === '오늘') return today;
  if (t === '내일') return new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
  if ((m = /^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})\s*일?(\s.*)?$/.exec(t))) return ok(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t))) return ok(2000 + +m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(t))) return ok(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-./월\s]+(\d{1,2})\s*일?$/.exec(t))) return ok(y0, +m[1], +m[2]);
  if ((m = /^\d{5}(\.\d+)?$/.exec(t))) return serialDate(Number(t)); // 엑셀 날짜 숫자 그대로 저장된 CSV
  return undefined;
}
const PRIORITY: [RegExp, 'low' | 'normal' | 'high' | 'urgent'][] = [[/^(긴급|급함|매우 ?높음|urgent|최상|p0)$/i, 'urgent'], [/^(높음|상|high|중요|p1)$/i, 'high'], [/^(보통|중|normal|medium|일반|p2)$/i, 'normal'], [/^(낮음|하|low|p3)$/i, 'low']];
const STATUS: [RegExp, 'todo' | 'in_progress' | 'on_hold' | 'done'][] = [[/^(진행 ?전|대기|할 ?일|todo|to do|예정|미착수|시작 ?전)$/i, 'todo'], [/^(진행 ?중|진행|in ?progress|doing|작업 ?중)$/i, 'in_progress'], [/^(보류|on ?hold|중단|hold)$/i, 'on_hold'], [/^(완료|done|끝|종료|complete(d)?)$/i, 'done']];

export const previewInput = z.object({
  headers: z.array(z.string().max(200)).max(60),
  rows: z.array(z.array(z.string().max(5000)).max(60)).min(1).max(MAX_ROWS),
  mapping: z.object(Object.fromEntries(FIELDS.map((f) => [f, z.number().int().min(0).max(59).optional()])) as Record<Field, z.ZodOptional<z.ZodNumber>>),
  /** 이름이 안 맞은 담당자 값 → 사람(화면에서 고름). null = 담당 없음으로 */
  assigneeMap: z.record(z.string().max(200), z.string().uuid().nullable()).optional(),
  projectId: z.string().uuid().nullable().optional(),
  skipRows: z.array(z.number().int().min(0)).max(MAX_ROWS).optional(),
});
type PreviewInput = z.infer<typeof previewInput>;

type Person = { id: string; name: string; email: string; work_email: string | null; title: string | null };
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
const TITLES = /(대표이사|대표|이사|부장|차장|과장|대리|주임|사원|팀장|실장|소장|매니저|님)$/;

async function people(u: SessionUser): Promise<Person[]> {
  return db()<Person[]>`select id, name, email, work_email, title from users where tenant = ${tenantOf(u)} and status = 'active' and deleted_at is null order by name`;
}
/** 이메일 → 이름 그대로 → 직급 뗀 이름("김철수 과장"·"김과장"은 이름+직급 일치일 때만). 둘 이상이면 동명이인 */
export function matchPerson(raw: string, list: Person[]): { id: string | null; why?: 'none' | 'many' } {
  const v = raw.trim(); if (!v) return { id: null };
  const email = /<?([^\s<>]+@[^\s<>]+)>?/.exec(v)?.[1]?.toLowerCase();
  if (email) { const p = list.find((x) => x.email.toLowerCase() === email || x.work_email?.toLowerCase() === email); return p ? { id: p.id } : { id: null, why: 'none' }; }
  const n = norm(v);
  const pick = (c: Person[]) => c.length === 1 ? { id: c[0].id } : c.length > 1 ? { id: null, why: 'many' as const } : null;
  const exact = pick(list.filter((x) => norm(x.name) === n)); if (exact) return exact;
  const base = n.replace(TITLES, '');
  const byBase = pick(list.filter((x) => norm(x.name) === base || norm(`${x.name}${x.title ?? ''}`) === n)); if (byBase) return byBase;
  // "김과장" = 성 + 직급
  const t = TITLES.exec(n)?.[1];
  if (t && base.length === 1) { const c = pick(list.filter((x) => x.name.startsWith(base) && (x.title ?? '').includes(t))); if (c) return c; }
  return { id: null, why: 'none' };
}

export async function previewImport(u: SessionUser, i: PreviewInput) {
  if (i.mapping.title === undefined) throw badRequest('제목 열을 골라 주세요');
  const list = await people(u);
  const projects = i.mapping.project !== undefined
    ? await db()<{ id: string; name: string }[]>`select p.id, p.name from projects p join org_units o on o.id = p.org_unit_id where o.tenant = ${tenantOf(u)}`
    : [];
  const today = todaySeoul();
  const skip = new Set(i.skipRows ?? []);
  const col = (r: string[], f: Field) => (i.mapping[f] !== undefined ? r[i.mapping[f]!] ?? '' : '').trim();
  const unmatched = new Map<string, { value: string; why: 'none' | 'many'; rows: number }>();
  const rows = i.rows.map((r, k) => {
    const errors: string[] = []; const warnings: string[] = [];
    const title = col(r, 'title');
    if (!r.some((c) => c.trim())) return { row: k, skip: true, empty: true, errors, warnings };
    if (!title) errors.push('제목이 비어 있습니다'); else if (title.length > 200) errors.push('제목이 200자를 넘습니다');
    const aRaw = col(r, 'assignee');
    let assigneeId: string | null = null;
    if (aRaw) {
      if (i.assigneeMap && aRaw in i.assigneeMap) assigneeId = i.assigneeMap[aRaw];
      else {
        const m = matchPerson(aRaw, list); assigneeId = m.id;
        if (!m.id) { const e = unmatched.get(aRaw) ?? { value: aRaw, why: m.why ?? 'none', rows: 0 }; e.rows++; unmatched.set(aRaw, e); warnings.push(m.why === 'many' ? `"${aRaw}" 이름이 같은 사람이 여럿 — 골라 주세요` : `"${aRaw}" 를 찾지 못함 — 골라 주세요(안 고르면 담당 없음)`); }
      }
    }
    const dRaw = col(r, 'dueDate'); const dueDate = parseDate(dRaw, today);
    if (dueDate === undefined) errors.push(`마감일 "${dRaw}" 을 읽지 못했습니다(예: 2026-10-20)`);
    const sRaw = col(r, 'startDate'); const startDate = parseDate(sRaw, today);
    if (startDate === undefined) errors.push(`시작일 "${sRaw}" 을 읽지 못했습니다`);
    if (startDate && dueDate && startDate > dueDate) errors.push('시작일이 마감일보다 늦습니다');
    const pRaw = col(r, 'priority'); const priority = pRaw ? PRIORITY.find(([re]) => re.test(pRaw))?.[1] : 'normal';
    if (!priority) { warnings.push(`우선순위 "${pRaw}" → 보통`); }
    const stRaw = col(r, 'status'); const status = stRaw ? STATUS.find(([re]) => re.test(stRaw))?.[1] : 'todo';
    if (!status) warnings.push(`상태 "${stRaw}" → 진행 전`);
    if (status === 'done') errors.push('완료된 업무는 가져오지 않습니다(빼고 진행)');
    const prRaw = col(r, 'project');
    let projectId = i.projectId ?? null;
    if (prRaw) { const p = projects.find((x) => norm(x.name) === norm(prRaw)); if (p) projectId = p.id; else warnings.push(`프로젝트 "${prRaw}" 없음 — 프로젝트 없이`); }
    const tags = col(r, 'tags').split(/[,#;\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20).map((x) => x.slice(0, 30));
    return {
      row: k, skip: skip.has(k), errors, warnings,
      task: { title: title.slice(0, 200), description: col(r, 'description').slice(0, 20000) || undefined, assigneeId, assigneeRaw: aRaw || null,
        assigneeName: list.find((x) => x.id === assigneeId)?.name ?? null, dueDate: dueDate ?? null, startDate: startDate ?? null,
        priority: priority ?? 'normal', status: status === 'done' ? 'todo' : status ?? 'todo', projectId, tags },
    };
  });
  const ready = rows.filter((r) => !r.skip && !r.errors.length && r.task);
  return {
    rows, unmatched: [...unmatched.values()], people: list.map((p) => ({ id: p.id, name: p.name, title: p.title })),
    counts: { total: rows.filter((r) => !('empty' in r && r.empty)).length, ready: ready.length, errors: rows.filter((r) => !r.skip && r.errors.length).length, skipped: rows.filter((r) => r.skip && !('empty' in r && r.empty)).length },
  };
}

/** 만들기: 오류 없는 줄만. 담당자마다 배정 알림 1건(묶음). batch 로 묶어 되돌리기 가능 */
export async function applyImport(u: SessionUser, i: PreviewInput, ip: string | null) {
  const p = await previewImport(u, i);
  const ready = p.rows.filter((r) => !r.skip && !r.errors.length && r.task);
  if (!ready.length) throw badRequest('만들 업무가 없습니다 — 오류 줄을 고치거나 빼 주세요');
  await (await import('./plans')).assertTaskQuota(u, ready.length);
  const importId = randomUUID();
  const created: { row: number; id: string }[] = []; const failed: { row: number; message: string }[] = [];
  for (const r of ready) {
    const t = r.task!;
    try {
      const { id } = await createTask(u, { title: t.title, description: t.description, assigneeId: t.assigneeId, dueDate: t.dueDate, startDate: t.startDate,
        priority: t.priority, status: t.status as never, projectId: t.projectId, tags: t.tags, approvalRequired: false }, { quiet: true, skipQuota: true });
      created.push({ row: r.row, id });
    } catch (e: any) { failed.push({ row: r.row, message: e?.message ?? '만들지 못했습니다' }); }
  }
  if (created.length) {
    const sql = db();
    await sql`update tasks set import_id = ${importId} where id = any(${created.map((c) => c.id)}::uuid[])`;
    const by = new Map<string, number>();
    for (const c of created) { const a = ready.find((r) => r.row === c.row)!.task!.assigneeId; if (a && a !== u.id) by.set(a, (by.get(a) ?? 0) + 1); }
    for (const [a, n] of by) await notify(sql, { userIds: [a], type: 'task_assigned', title: `새 업무 ${n}건 배정`, body: `${u.name}님이 엑셀로 업무 ${n}건을 배정했습니다`,
      link: '/tasks?view=mine', actorId: u.id, dedupeKey: `import:${importId}:${a}` });
    await audit(sql, u.id, 'tasks.import', 'import', importId, { created: created.length, failed: failed.length }, ip);
  }
  return { importId, created: created.length, failed, skipped: p.counts.errors + p.counts.skipped };
}

/** 방금 가져온 묶음 되돌리기(만든 사람·관리자만, 24시간 안, 휴지통으로) */
export async function undoImport(u: SessionUser, importId: string, ip: string | null) {
  const sql = db();
  const rows = await sql<{ id: string; created_by: string; created_at: Date }[]>`select t.id, t.created_by, t.created_at from tasks t join org_units o on o.id = t.org_unit_id
    where t.import_id = ${importId} and o.tenant = ${tenantOf(u)} and t.deleted_at is null`;
  if (!rows.length) throw badRequest('되돌릴 업무가 없습니다');
  if (!['owner', 'admin'].includes(u.role) && rows.some((r) => r.created_by !== u.id)) throw badRequest('직접 가져온 업무만 되돌릴 수 있습니다');
  if (rows.some((r) => Date.now() - new Date(r.created_at).getTime() > 86400000)) throw badRequest('가져온 지 하루가 지나 한꺼번에 되돌릴 수 없습니다 — 업무 목록에서 지워 주세요');
  await sql`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = any(${rows.map((r) => r.id)}::uuid[])`;
  await audit(sql, u.id, 'tasks.import_undo', 'import', importId, { count: rows.length }, ip);
  return { removed: rows.length };
}

/** 예시 양식(CSV): 회사 사람 이름으로 채워서 그대로 올려 보면 맞춰지게 */
export async function templateCsv(u: SessionUser) {
  const list = (await people(u)).slice(0, 3);
  const n = (k: number) => list[k % Math.max(1, list.length)]?.name ?? '';
  const d = (k: number) => new Date(Date.parse(todaySeoul()) + k * 86400000).toISOString().slice(0, 10);
  const rows = [['제목', '담당자', '마감일', '우선순위', '상태', '설명', '태그'],
    ['현장 안전 점검표 제출', n(0), d(3), '높음', '진행 전', '월간 안전 점검표 작성 후 사진 첨부', '안전,점검'],
    ['10월 회원 이용 현황 정리', n(1), d(5), '보통', '진행 중', '', '보고'],
    ['소방 설비 업체 견적 받기', n(2), d(7), '긴급', '', '업체 3곳 비교', '견적']];
  const esc = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
