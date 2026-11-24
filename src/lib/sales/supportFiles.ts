// #1149(대표 11/24 '지원사업을 업무로 넘길 때 첨부파일이 안 넘어옴'): K-Startup 은 공공데이터포털 목록에 첨부가 없고 상세 화면에만 내려받기 링크(/afile/fileDownload/…)가 있음
// → 우리가 진행 중인(관심·준비·신청) 공고만 상세 화면을 한 번 읽어 첨부(이름·주소)를 저장하고, 이미 만든 업무에 붙인다(자료실 '영업/지원사업/…' 한 번 저장 → 업무 연결, 입찰 #507 과 같은 방식)
// 내려받기가 막히면(로그인 필요 등) 업무 설명에 '공고 첨부 n건 중 m건 자동 첨부 실패 — 공고문 내려받기' 줄이 남는다(autoAttach 의 기존 규칙)
import { db } from '../db';

const KS = 'https://www.k-startup.go.kr';
/** 읽는 규칙 판(로컬 11/24 2판: 마감 주소 다시 시도·file_bg 이름) — 예전 판으로 읽은 공고는 다음 차례에 다시 읽음 */
export const FILES_V = '2';
const EXT_END = /\.(?:hwpx?|hwt|pdf|docx?|xlsx?|xls|pptx?|zip|7z|rar|egg|jpe?g|png|gif|txt|csv|odt)\s*$/i;
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** 상세 화면 HTML 에서 첨부 내려받기 링크와 파일 이름(링크 둘레의 '이름.확장자') */
export function kstartupFilesFromHtml(html: string, base = KS): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = []; const seen = new Set<string>();
  const re = /\/afile\/fileDownload\/[A-Za-z0-9_\-./%=?&]+/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const path = m[0].replace(/&amp;/g, '&').replace(/["')]+$/, '');
    if (seen.has(path)) continue; seen.add(path);
    // 이름 = 링크 바로 앞(같은 줄)의 글자 조각 중 '이름.확장자'로 끝나는 마지막 것 → 없으면 링크 뒤 조각 → 없으면 '첨부 n'
    // 로컬 11/24: K-Startup 실제 화면은 <a class="file_bg" title="[첨부파일] 이름">이름</a> 뒤에 [바로보기]·[다운로드] — 그 이름을 먼저(확장자 목록과 무관)
    const win = html.slice(Math.max(0, m.index - 1200), m.index);
    const fileBg = [...win.matchAll(/class="file_bg"[^>]*>([^<]{1,200})</g)].map((x) => strip(x[1])).filter(Boolean);
    const nodes = (chunk: string) => [...chunk.matchAll(/>([^<>]{1,200})</g)].map((x) => strip(x[1])).filter((t) => EXT_END.test(t));
    const before = nodes(html.slice(Math.max(0, m.index - 800), m.index)); const after = nodes(html.slice(m.index, Math.min(html.length, m.index + 400)));
    const name = (fileBg[fileBg.length - 1] ?? before[before.length - 1] ?? after[0] ?? `첨부 ${out.length + 1}`).slice(0, 150);
    out.push({ name, url: new URL(path, base).toString() });
  }
  return out.slice(0, 20);
}

async function fetchHtml(url: string, ms = 10_000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; workin-support/1.0)', accept: 'text/html' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

/** 첨부가 비어 있는 진행 중 K-Startup 공고(최대 max건)의 상세 화면을 읽어 첨부를 채우고, 그 공고로 만든 열린 업무에 붙임 */
export async function fillSupportAttachments(opt: { max?: number; programId?: string } = {}) {
  const sql = db();
  const base = process.env.SALES_COLLECT_TEST_BASE ? `${process.env.SALES_COLLECT_TEST_BASE.replace(/\/$/, '')}/kstartup` : null;
  const rows = await sql<{ id: string; url: string | null; source_id: string }[]>`select p.id, p.url, p.source_id from support_programs p
    where p.source = 'kstartup' and coalesce(jsonb_array_length(case when jsonb_typeof(p.attachments) = 'array' then p.attachments else '[]'::jsonb end), 0) = 0
      and (coalesce(p.raw->>'files_checked_at', '') < to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS') or coalesce(p.raw->>'files_v', '') <> ${FILES_V}) -- 읽는 규칙이 바뀌면 하루 기다리지 않고 한 번 다시
      and (${opt.programId ?? null}::uuid is null or p.id = ${opt.programId ?? null}::uuid)
      -- 로컬 11/24(#1149 Next OI 첨부 0개): 예전엔 첨부 없는 공고 전체에서 5건을 먼저 고른 뒤 '진행 중 업무가 있는 공고'만 남겨,
      -- 업무가 있는 공고가 그 5건 밖이면 영영 차례가 오지 않았음 → 처음부터 진행 중 업무(관심·신청 준비·신청)가 있는 공고만 고름
      and (${opt.programId ?? null}::uuid is not null or exists (select 1 from support_work w where w.program_id = p.id and w.withdrawn_at is null and w.status in ('interest', 'preparing', 'applied')))
    order by p.apply_end nulls last limit ${opt.max ?? 20}`;
  const ids = new Set(rows.map((r) => r.id));
  let filled = 0, attached = 0; const errors: string[] = [];
  for (const p of rows.filter((r) => ids.has(r.id))) {
    // 같은 공고를 두 곳(바로 채우기·정기 실행)이 동시에 읽어 업무에 첨부가 두 번 붙지 않게 — 한 번에 한 곳만 '맡음'(맡을 때 시도 시각을 먼저 찍음)
    const [claimed] = await sql`update support_programs set raw = coalesce(raw, '{}'::jsonb) || ${sql.json({ files_checked_at: new Date().toISOString().slice(0, 19), files_v: FILES_V } as never)}
      where id = ${p.id} and (coalesce(raw->>'files_checked_at', '') < to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS') or coalesce(raw->>'files_v', '') <> ${FILES_V}) returning id`;
    if (!claimed) continue;
    const url = base ? `${base}/${encodeURIComponent(p.source_id)}` : p.url ?? `${KS}/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${encodeURIComponent(p.source_id)}`;
    // 로컬 11/24: 모집이 끝난 공고는 '진행 중' 주소가 내려받기 링크 없는 화면을 주고(브라우저는 스크립트로 넘어감) '마감' 주소(bizpbanc-deadline.do)에 첨부가 있음 → 없으면 마감 주소로 한 번 더
    const deadlineUrl = base ? `${base.replace(/\/kstartup$/, '/kstartup-deadline')}/${encodeURIComponent(p.source_id)}`
      : /bizpbanc-ongoing\.do/.test(url) ? url.replace('bizpbanc-ongoing.do', 'bizpbanc-deadline.do') : `${KS}/web/contents/bizpbanc-deadline.do?schM=view&pbancSn=${encodeURIComponent(p.source_id)}`;
    try {
      let files = kstartupFilesFromHtml(await fetchHtml(url), base ?? KS);
      if (!files.length && deadlineUrl !== url) files = kstartupFilesFromHtml(await fetchHtml(deadlineUrl), base ?? KS);
      await sql`update support_programs set raw = coalesce(raw, '{}'::jsonb) || ${sql.json({ files_checked_at: new Date().toISOString().slice(0, 19), files_found: files.length, files_error: null, files_v: FILES_V } as never)}${files.length ? sql`, attachments = ${sql.json(files as never)}` : sql``} where id = ${p.id}`;
      if (!files.length) continue;
      filled++;
      // 그 공고로 만든 업무(회사마다) → 자료실 저장 + 업무에 붙임(같은 파일은 한 번)
      // 로컬 11/24: 업무가 '완료'여도 공고가 관심·신청 준비·신청이면 붙임(완료 업무에 기록으로 남는 것은 해가 없음 — 신청 뒤 결과 확인 때 공고문을 다시 봄)
      attached += await attachToWorks(sql, p.id, errors);
    } catch (e) { errors.push(`${p.source_id}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); await sql`update support_programs set raw = coalesce(raw, '{}'::jsonb) || ${sql.json({ files_checked_at: new Date().toISOString().slice(0, 19), files_error: String((e as Error)?.message ?? e).slice(0, 120), files_v: FILES_V } as never)} where id = ${p.id}`; }
  }
  // 이미 첨부를 읽은 공고인데 그때 업무가 '완료'라 붙지 않았던 것(로컬 11/24 179564·179175·179470) — 업무마다 한 번만 이어서 붙임
  const late = await sql<{ id: string }[]>`select distinct p.id from support_programs p join support_work w on w.program_id = p.id join tasks t on t.id = w.task_id
    where p.source = 'kstartup' and coalesce(jsonb_array_length(case when jsonb_typeof(p.attachments) = 'array' then p.attachments else '[]'::jsonb end), 0) > 0
      and w.withdrawn_at is null and w.status in ('interest', 'preparing', 'applied') and t.deleted_at is null
      and not (coalesce(p.raw->'files_tasks', '[]'::jsonb) ? w.task_id::text)
      and not exists (select 1 from attachments a where a.task_id = w.task_id and a.source = 'sales_auto' and a.deleted_at is null)
      and (${opt.programId ?? null}::uuid is null or p.id = ${opt.programId ?? null}::uuid)
    limit ${opt.max ?? 20}`;
  for (const l of late) attached += await attachToWorks(sql, l.id, errors);
  return { checked: ids.size, filled, attached, late: late.length, errors: errors.slice(0, 5) };
}

/** 공고의 진행 중(관심·신청 준비·신청) 업무에 첨부를 붙이고, 붙인 업무를 공고에 기록(raw.files_tasks — 같은 업무는 한 번, 다른 곳과 동시에 하지 않게 먼저 맡음) */
async function attachToWorks(sql: ReturnType<typeof db>, programId: string, errors: string[]) {
  const works = await sql<{ tenant: string; task_id: string; owner_id: string | null; created_by: string | null }[]>`select w.tenant, w.task_id, w.owner_id, w.created_by from support_work w join tasks t on t.id = w.task_id
    where w.program_id = ${programId} and w.withdrawn_at is null and w.status in ('interest', 'preparing', 'applied') and t.deleted_at is null`;
  let n = 0;
  for (const w of works) {
    const [claimed] = await sql`update support_programs set raw = jsonb_set(coalesce(raw, '{}'::jsonb), '{files_tasks}', coalesce(raw->'files_tasks', '[]'::jsonb) || to_jsonb(${w.task_id}::text))
      where id = ${programId} and not (coalesce(raw->'files_tasks', '[]'::jsonb) ? ${w.task_id}::text) returning id`;
    if (!claimed) continue;
    const { actorOf } = await import('./bidTasks');
    const u = (await actorOf(sql, w.owner_id)) ?? (await actorOf(sql, w.created_by));
    if (!u || u.tenant !== w.tenant) continue;
    const r = await (await import('./autoAttach')).attachSourceFiles(u, { kind: 'support', id: programId, taskIds: [w.task_id] }).catch((e) => { errors.push(String(e?.message ?? e).slice(0, 80)); return null; });
    n += r?.ok ?? 0;
  }
  return n;
}
