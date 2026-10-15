import { z } from 'zod';
import { db } from '../db';
import { forbidden, notFound } from '../errors';
import { getObject } from '../storage';
import { audit } from '../log';
import { tenantOf, type SessionUser } from '../types';
import { isAdmin } from '../access';

/** V22 문서 작업 결과 — 만든 사람만 본다. 자료실 저장·업무 첨부는 사람이 누를 때만 */
async function own(u: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const [j] = await db()<any[]>`select * from ai_doc_jobs where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!j || j.user_id !== u.id) throw notFound('파일 작업이 없습니다');
  return j;
}
export async function getDocJob(u: SessionUser, id: string) {
  const j = await own(u, id);
  // 같은 문서의 버전들(v1 → v2 → …)
  const versions = await db()`with recursive up as (select id, base_job_id from ai_doc_jobs where id = ${j.id} union all select p.id, p.base_job_id from ai_doc_jobs p join up on p.id = up.base_job_id),
      root as (select id from up where base_job_id is null limit 1),
      down as (select id, version, status, created_at from ai_doc_jobs where id = (select id from root) union all select c.id, c.version, c.status, c.created_at from ai_doc_jobs c join down on c.base_job_id = down.id)
    select id, version, status, created_at from down order by version, created_at`;
  return { job: { id: j.id, title: j.title, kind: j.kind, mode: j.mode, version: j.version, status: j.status, pages: j.pages, summary: j.summary, error: j.error,
    resultName: j.result_name, resultSize: j.result_size, hasFile: !!j.result_key, hasPreview: !!j.preview_key, savedFileId: j.saved_file_id, costUsd: Number(j.cost_usd), createdAt: j.created_at, finishedAt: j.finished_at,
    ...(isAdmin(u) && j.debug ? { debug: j.debug } : {}), ...(isAdmin(u) ? { costKrw: Math.round(Number(j.cost_usd) * (Number(process.env.USD_KRW) || 1400)), model: j.model } : {}) }, // 운영 진단·작업 비용(대표·관리자만)
    versions };
}
export async function docJobFile(u: SessionUser, id: string, what: 'file' | 'preview') {
  const j = await own(u, id);
  const key = what === 'file' ? j.result_key : j.preview_key;
  if (!key) throw notFound(what === 'file' ? '결과 파일이 없습니다' : '미리보기가 없습니다');
  const data = await getObject(key);
  const name = what === 'file' ? j.result_name : 'preview.png';
  return new Response(new Uint8Array(data), { headers: {
    'content-type': what === 'file' ? j.result_mime ?? 'application/octet-stream' : 'image/png',
    'content-disposition': `${what === 'file' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'private, max-age=300',
  } });
}
export const saveDocInput = z.object({ folder: z.string().max(200).optional(), title: z.string().trim().min(1).max(200).optional(), taskId: z.string().uuid().optional(), asTemplate: z.boolean().optional() });
export async function saveDocJob(u: SessionUser, id: string, i: z.infer<typeof saveDocInput>) {
  const j = await own(u, id);
  if (j.status !== 'done' || !j.result_key) throw forbidden('아직 결과 파일이 없습니다');
  const { saveGeneratedFile, folderLevel, cleanFolder, attachLibraryToTask, assertConfidentialAudience } = await import('../library');
  const { RANK } = await import('../menuPerms');
  // V22 부록 2: [양식으로 저장] = 폴더 "양식"·태그 "양식" → 다음부터 칸 채우기(코드 실행 없이 거의 무료)
  const folder = cleanFolder(i.folder ?? '') || (i.asTemplate ? '양식' : 'AI 문서');
  if (RANK[await folderLevel(u, folder)] < RANK.edit) throw forbidden(`"${folder}" 폴더에 저장할 권한이 없습니다`);
  if (i.taskId && j.confidential) await assertConfidentialAudience(i.taskId);
  const title = i.title ?? (i.asTemplate ? `${j.title} 양식` : `${j.title}${j.version > 1 ? ` v${j.version}` : ''}`);
  const ext = (j.result_name as string).split('.').pop();
  const f = await saveGeneratedFile(u, { fileName: `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()}.${ext}`, mime: j.result_mime, data: await getObject(j.result_key), title, folder,
    tags: i.asTemplate ? ['양식', 'AI'] : ['AI', `v${j.version}`], description: `AI 비서 문서 작업(v${j.version})${j.summary ? ` — ${String(j.summary).slice(0, 200)}` : ''}`, source: 'ai', security: j.confidential ? 'confidential' : undefined });
  const sql = db();
  await sql`insert into library_folders (tenant, path, created_by) values (${tenantOf(u)}, ${folder}, ${u.id}) on conflict do nothing`;
  if (i.taskId) await attachLibraryToTask(u, f.id, i.taskId);
  if (!i.asTemplate) await sql`update ai_doc_jobs set saved_file_id = ${f.id} where id = ${j.id}`;
  await audit(sql, u.id, 'ai.doc_saved', 'library_file', f.id, { job: j.id, version: j.version, taskId: i.taskId ?? null }, null);
  return { fileId: f.id, template: !!i.asTemplate, link: i.taskId ? `/tasks/${i.taskId}` : `/library?file=${f.id}` };
}
