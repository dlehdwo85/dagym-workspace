import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { db } from '../db';
import { getObject, putObject } from '../storage';
import { costUsd, modelFor } from './provider';
import { companyProfiles, profileText } from '../companyProfiles';
import { logError } from '../log';

/**
 * V22 문서 엔진 — Claude 의 Agent Skills(xlsx·docx·pptx·pdf) + 코드 실행으로 서식 있는 파일을 만들고 고친다.
 * - 대화마다 코드 실행 컨테이너를 재사용(이어서 "더 다듬기"), 참고 파일은 Files API 에 한 번만 올림(library_files.anthropic_file_id)
 * - 결과 파일 + 첫 페이지 미리보기(preview.png)를 받아 작업 결과로 보관 — 자료실 저장은 사람이 [자료실에 저장]을 눌러야 한다
 * - 회사 정보·로고·브랜드 색은 조직 설정(company_profiles)에서 데이터로 넣는다(다른 회사 정보와 섞지 않게)
 * - 사용량: purpose 'doc_engine' 으로 따로 기록(월 한도 합산), 이어받기(pause_turn·max_tokens) 최대 8번
 * - 결과 파일 id 는 응답 전체에서 찾고(도구 종류가 달라도), 없으면 한 번 더 저장을 요청 → 그래도 없으면 Files API 목록에서 찾는다
 * - 단계별 진단은 ai_doc_jobs.debug 에 남긴다(운영 실패 원인 확인용)
 */
const SKILL: Record<string, string | null> = { xlsx: 'xlsx', docx: 'docx', pptx: 'pptx', pdf: 'pdf', chart: null, none: null };
const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', csv: 'text/csv', md: 'text/markdown', txt: 'text/plain',
};
const extOf = (n: string) => (n.toLowerCase().split('.').pop() ?? '');
let client: Anthropic | null = null;
const api = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.ANTHROPIC_BASE_URL || undefined, maxRetries: 1, timeout: 590_000 }));

const SYSTEM = `당신은 회사 문서·디자인 담당입니다. 코드 실행과 문서 스킬로 실제 파일을 만듭니다.
규칙:
- 결과 파일은 /mnt/user-data/outputs/ 에 저장합니다(환경 변수 OUTPUT_DIR 이 있으면 그 폴더에도 복사). 파일 이름은 한국어 제목 그대로(확장자 포함). 저장 뒤 ls -la 로 확인하세요.
- 코드는 한 번에 아주 길게 쓰지 말고 단계(데이터 준비 → 파일 만들기 → 미리보기 점검)로 나눠 실행하세요.
- 문서(xlsx·docx·pptx·pdf)를 만들면 LibreOffice 로 PDF 변환(soffice --headless --convert-to pdf) 후 첫 페이지를 pdftoppm -png -r 130 -f 1 -l 1 로 /mnt/user-data/outputs/preview.png 에 저장하고, 그 이미지를 직접 보고 점검하세요: 글자 잘림·겹침·정렬·페이지 수. 문제가 있으면 고쳐 다시 저장(점검은 최대 2번).
- 1페이지 요청이면 인쇄 설정(A4, 한 페이지에 맞춤)과 행 높이·글자 크기를 조정해 PDF 가 1페이지가 되게 하세요. 그래도 넘치면 억지로 줄이지 말고 마지막 줄에 "1페이지 초과: 이유"를 쓰세요.
- 회사 정보는 아래 [회사] 데이터만 씁니다. 다른 회사(참고 양식의 회사 등)의 상호·사업자번호·주소·전화·로고를 결과에 남기지 마세요.
- 숫자는 참고 자료·지시에 있는 값만 쓰고, 계산은 코드로 합니다. 모르는 값은 칸을 비우고 "확인 필요"로 표시.
- 디자인: 회사 브랜드 색을 강조색으로, 표는 얇은 테두리·머리글 채우기, 넉넉한 여백, 숫자 오른쪽 정렬·천 단위 쉼표, 원화는 "원".
- 분석 요청이면 코드로 계산한 결과만 답하고, 차트가 도움이 되면 chart.png 로 저장.
- 마지막 답은 한국어 2~4줄 요약 + 마지막 줄 "PAGES: n"(문서가 아니면 생략).`;

type Job = { id: string; tenant: string; user_id: string; thread_id: string | null; mode: string; kind: string; title: string; instructions: string; company_key: string | null;
  ref_file_ids: string[]; base_job_id: string | null; version: number; started_at: Date };

/** 응답 블록 어디에 있든 file_id 를 모은다(bash·text_editor 결과, 그 밖의 도구 결과 포함) */
export function collectFileIds(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) { for (const x of node) collectFileIds(x, out); return out; }
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    if (typeof o.file_id === 'string' && o.type !== 'container_upload') out.push(o.file_id);
    for (const [k, v] of Object.entries(o)) if (k !== 'file_id' && v && typeof v === 'object') collectFileIds(v, out);
  }
  return out;
}
const countTypes = (content: any[]) => content.reduce<Record<string, number>>((m, b) => ((m[b.type] = (m[b.type] ?? 0) + 1), m), {});
/** 잘린 응답을 이어 보낼 때: 결과가 없는 마지막 서버 도구 호출은 뺀다 */
function trimDangling(content: any[]) {
  const done = new Set(content.filter((b) => b.tool_use_id).map((b) => b.tool_use_id));
  return content.filter((b, i) => !(b.type === 'server_tool_use' && !done.has(b.id) && i === content.length - 1) && !(b.type === 'text' && !b.text));
}

async function anthropicFileFor(libId: string): Promise<{ id: string; name: string } | null> {
  const sql = db();
  const [f] = await sql<{ id: string; file_name: string; mime_type: string; storage_key: string; anthropic_file_id: string | null }[]>`
    select id, file_name, mime_type, storage_key, anthropic_file_id from library_files where id = ${libId} and deleted_at is null`;
  if (!f) return null;
  if (f.anthropic_file_id) return { id: f.anthropic_file_id, name: f.file_name };
  const buf = await getObject(f.storage_key);
  const up = await api().files.upload({ file: await toFile(buf, f.file_name, { type: f.mime_type || 'application/octet-stream' }) });
  await sql`update library_files set anthropic_file_id = ${up.id} where id = ${f.id}`;
  return { id: up.id, name: f.file_name };
}

/** 작업 하나 실행 (중복 실행 방지: queued → running 으로 바꾼 쪽만) */
export async function processDocJob(id: string) {
  const sql = db();
  const [job] = await sql<Job[]>`update ai_doc_jobs set status = 'running', started_at = now()
    where id = ${id} and (status = 'queued' or (status = 'running' and started_at < now() - interval '10 minutes')) returning *`;
  if (!job) return { skipped: true };
  let inTok = 0, outTok = 0, cost = 0;
  const debug: { steps: any[]; container?: string | null; found?: number; fallback?: string; lastText?: string; skipped?: string[]; error?: string } = { steps: [] };
  const saveDebug = () => sql`update ai_doc_jobs set debug = ${sql.json(debug as never)} where id = ${job.id}`.catch(() => {});
  const model = modelFor('default');
  try {
    // 참고 파일 + (고치기면) 직전 버전 결과 + 회사 로고 → 컨테이너에 올림
    const uploads: { id: string; name: string; role: string }[] = [];
    for (const r of job.ref_file_ids) { const f = await anthropicFileFor(r); if (f) uploads.push({ ...f, role: '참고 자료' }); }
    if (job.base_job_id) {
      const [b] = await sql<{ result_anthropic_file_id: string | null; result_name: string | null; result_key: string | null; result_mime: string | null }[]>`
        select result_anthropic_file_id, result_name, result_key, result_mime from ai_doc_jobs where id = ${job.base_job_id}`;
      if (b?.result_anthropic_file_id) uploads.push({ id: b.result_anthropic_file_id, name: b.result_name ?? '이전 버전', role: '고칠 이전 버전' });
      else if (b?.result_key) {
        const up = await api().files.upload({ file: await toFile(await getObject(b.result_key), b.result_name ?? 'base', { type: b.result_mime ?? 'application/octet-stream' }) });
        uploads.push({ id: up.id, name: b.result_name ?? '이전 버전', role: '고칠 이전 버전' });
      }
    }
    const profiles = await companyProfiles(job.tenant, sql);
    const company = profiles.find((p) => p.key === job.company_key) ?? profiles.find((p) => p.is_default) ?? null;
    if (company?.logo_file_id) { const f = await anthropicFileFor(company.logo_file_id); if (f) uploads.push({ ...f, role: '회사 로고' }); }
    const companyBlock = company ? profileText(company) : '[회사] 조직 설정에 회사 정보가 없습니다 — 공급자 칸은 비워 두고 "회사 정보 설정 필요"로 표시';
    const brief = `${companyBlock}\n\n작업: ${job.mode === 'edit' ? `이전 버전(v${job.version - 1})을 고쳐 v${job.version} 만들기` : job.mode === 'analyze' ? '자료 분석' : '새로 만들기'}\n` +
      `파일 종류: ${job.kind}\n제목: ${job.title}\n` + (uploads.length ? `올린 파일:\n${uploads.map((u) => `- ${u.name} (${u.role})`).join('\n')}\n` : '') + `\n요청:\n${job.instructions}`;
    const skill = SKILL[job.kind];
    const [th] = job.thread_id ? await sql<{ container_id: string | null }[]>`select container_id from ai_threads where id = ${job.thread_id}` : [];
    let container: string | null = th?.container_id ?? null;
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: [...uploads.map((u) => ({ type: 'container_upload' as const, file_id: u.id })), { type: 'text', text: brief }] }];
    const outputs: string[] = [];
    const uploadedIds = new Set(uploads.map((u) => u.id));
    let text = '', nudged = false;
    for (let step = 0; step < 8; step++) {
      const params = {
        model, max_tokens: 20000, system: SYSTEM, messages,
        container: { ...(container ? { id: container } : {}), ...(skill ? { skills: [{ type: 'anthropic' as const, skill_id: skill, version: 'latest' }] } : {}) },
        tools: [{ type: 'code_execution_20260521' as const, name: 'code_execution' as const }],
        betas: ['code-execution-2025-08-25'], output_config: { effort: 'medium' as const },
      };
      const r = await api().beta.messages.create(params as never).catch(async (e: any) => {
        // 지난 컨테이너가 만료됐으면 새 컨테이너로 한 번 더
        if (container && (e?.status === 400 || e?.status === 404)) { container = null; return api().beta.messages.create({ ...params, container: skill ? { skills: params.container.skills } : undefined } as never); }
        throw e;
      }) as Anthropic.Beta.BetaMessage;
      inTok += r.usage.input_tokens; outTok += r.usage.output_tokens; cost += costUsd(r.model ?? model, r.usage);
      container = r.container?.id ?? container;
      const ids = collectFileIds(r.content).filter((x) => !uploadedIds.has(x));
      outputs.push(...ids);
      const stepText = (r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (stepText) text = stepText; // 마지막 단계의 글이 요약
      debug.steps.push({ stop: r.stop_reason, types: countTypes(r.content as any[]), files: ids.length, out: r.usage.output_tokens });
      debug.container = container;
      if (r.stop_reason === 'refusal') throw new Error('이 요청은 처리할 수 없습니다');
      if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content as never }); continue; }
      if (r.stop_reason === 'max_tokens') {
        messages.push({ role: 'assistant', content: trimDangling(r.content as any[]) as never }, { role: 'user', content: '답이 길이 제한으로 잘렸습니다. 코드를 짧게 나눠 남은 단계를 이어서 진행하고, 결과 파일을 /mnt/user-data/outputs/ 에 저장한 뒤 요약과 PAGES: n 을 쓰세요.' });
        continue;
      }
      // 끝났는데 결과 파일이 없으면 한 번만 저장을 다시 요청
      if (!outputs.length && job.mode !== 'analyze' && !nudged) {
        nudged = true;
        messages.push({ role: 'assistant', content: trimDangling(r.content as any[]) as never }, { role: 'user', content: '결과 파일이 전달되지 않았습니다. 만든 파일을 /mnt/user-data/outputs/ 에 다시 저장(cp)하고 ls -la 로 확인한 뒤, 요약과 PAGES: n 을 쓰세요.' });
        continue;
      }
      break;
    }
    // 그래도 없으면 Files API 목록에서 이 작업 이후에 생긴 내려받을 수 있는 파일
    if (!outputs.length && job.mode !== 'analyze') {
      try {
        const since = new Date(job.started_at).getTime() - 5_000;
        const norm = (x: string) => x.replace(/\s+/g, '').toLowerCase();
        const seen: string[] = [];
        const page = container ? await api().beta.files.list({ scope_id: container, limit: 50 } as never).catch(() => null) : null;
        for (const f of (page?.data ?? []) as any[]) if (f.downloadable && !uploadedIds.has(f.id)) seen.push(f.id);
        if (!seen.length) {
          const all = await api().files.list({ limit: 50 } as never);
          // 범위 없는 목록은 같은 키의 다른 회사 파일이 섞일 수 있어 → 이 작업 시작 뒤 + 제목이 같은 파일만
          for (const f of all.data as any[]) if (f.downloadable && !uploadedIds.has(f.id) && Date.parse(f.created_at) >= since && norm(f.filename ?? '').includes(norm(job.title))) seen.push(f.id);
        }
        debug.fallback = `files.list ${seen.length}`;
        outputs.push(...seen.reverse());
      } catch (e: any) { debug.fallback = `files.list 실패 ${e?.status ?? ''}`; }
    }
    debug.found = new Set(outputs).size;
    debug.lastText = text.slice(0, 300);
    await saveDebug();
    if (container && job.thread_id) await sql`update ai_threads set container_id = ${container} where id = ${job.thread_id}`;
    // 결과 파일 받기 — 같은 이름이 여러 번이면 마지막 것
    const files: { fileId: string; name: string; buf: Buffer }[] = [];
    for (const fid of [...new Set(outputs)]) {
      let meta: Awaited<ReturnType<Anthropic['files']['retrieveMetadata']>>, buf: Buffer;
      try { meta = await api().files.retrieveMetadata(fid); buf = Buffer.from(await (await api().files.download(fid)).arrayBuffer()); }
      catch (e: any) { (debug.skipped ??= []).push(`${fid}:${e?.status ?? 'err'}`); continue; }
      const name = (meta.filename || 'output').split('/').pop()!;
      const i = files.findIndex((f) => f.name === name);
      if (i >= 0) files.splice(i, 1);
      files.push({ fileId: fid, name, buf });
    }
    const want = job.kind === 'chart' ? ['png'] : job.kind === 'none' ? ['xlsx', 'docx', 'pptx', 'pdf', 'png', 'csv'] : [job.kind];
    const main = [...files].reverse().find((f) => want.includes(extOf(f.name)) && !/^preview/i.test(f.name)) ?? (job.mode === 'analyze' ? [...files].reverse().find((f) => !/^preview/i.test(f.name)) : undefined);
    const preview = [...files].reverse().find((f) => /^preview.*\.png$/i.test(f.name)) ?? (main && extOf(main.name) === 'png' ? main : undefined);
    const pages = Number(/PAGES:\s*(\d+)/.exec(text)?.[1]) || null;
    const summary = text.replace(/PAGES:\s*\d+\s*$/m, '').trim().slice(0, 2000);
    if (!main && job.mode !== 'analyze') throw new Error(files.length ? `결과 파일 형식이 다릅니다(${files.map((f) => f.name).join(', ').slice(0, 120)})` : '결과 파일을 받지 못했습니다');
    const base = `ai-doc/${job.tenant}/${job.id}`;
    if (main) await putObject(`${base}/${main.name}`, main.buf, MIME[extOf(main.name)] ?? 'application/octet-stream');
    if (preview && preview !== main) await putObject(`${base}/preview.png`, preview.buf, 'image/png');
    await sql`update ai_doc_jobs set status = 'done', finished_at = now(), summary = ${summary || null}, pages = ${pages},
      result_key = ${main ? `${base}/${main.name}` : null}, result_name = ${main?.name ?? null}, result_mime = ${main ? MIME[extOf(main.name)] ?? 'application/octet-stream' : null},
      result_size = ${main?.buf.length ?? null}, result_anthropic_file_id = ${main?.fileId ?? null},
      preview_key = ${preview ? (preview === main ? `${base}/${main!.name}` : `${base}/preview.png`) : null},
      input_tokens = ${inTok}, output_tokens = ${outTok}, cost_usd = ${cost} where id = ${job.id}`;
    return { done: true };
  } catch (e: any) {
    await logError('ai.doc_engine', e, { jobId: job.id });
    debug.error = String(e?.message ?? e).slice(0, 300); await saveDebug();
    const msg = e?.status ? `AI 서버 오류(${e.status})` : String(e?.message ?? '문서 작업 실패').slice(0, 300);
    await sql`update ai_doc_jobs set status = 'failed', finished_at = now(), error = ${msg}, input_tokens = ${inTok}, output_tokens = ${outTok}, cost_usd = ${cost} where id = ${job.id}`;
    return { failed: msg };
  } finally {
    if (inTok || outTok) await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${job.tenant}, ${job.user_id}, ${crypto.randomUUID()}, 'anthropic', ${model}, ${inTok}, ${outTok}, 0, 0, ${cost}, 'doc_engine')`.catch(() => {});
  }
}

/** 정기 실행 안전망: 응답 뒤 처리가 끊겼던 작업을 다시 */
export async function docJobsJob() {
  const rows = await db()<{ id: string }[]>`select id from ai_doc_jobs where (status = 'queued' and created_at < now() - interval '1 minute')
    or (status = 'running' and started_at < now() - interval '10 minutes') order by created_at limit 3`;
  for (const r of rows) await processDocJob(r.id);
  return { processed: rows.length };
}
