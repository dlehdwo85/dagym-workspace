// #1149(대표 11/24 '지원사업을 업무로 넘길 때 첨부파일이 안 넘어옴'): K-Startup 은 공공데이터포털 목록에 첨부가 없고 상세 화면에만 내려받기 링크(/afile/fileDownload/…)가 있음
// → 우리가 진행 중인(관심·준비·신청) 공고만 상세 화면을 한 번 읽어 첨부(이름·주소)를 저장하고, 이미 만든 업무에 붙인다(자료실 '영업/지원사업/…' 한 번 저장 → 업무 연결, 입찰 #507 과 같은 방식)
// 내려받기가 막히면(로그인 필요 등) 업무 설명에 '공고 첨부 n건 중 m건 자동 첨부 실패 — 공고문 내려받기' 줄이 남는다(autoAttach 의 기존 규칙)
import { db } from '../db';

const KS = 'https://www.k-startup.go.kr';
const EXT_END = /\.(?:hwpx?|pdf|docx?|xlsx?|pptx?|zip|jpg|png)\s*$/i;
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** 상세 화면 HTML 에서 첨부 내려받기 링크와 파일 이름(링크 둘레의 '이름.확장자') */
export function kstartupFilesFromHtml(html: string, base = KS): { name: string; url: string }[] {
  const out: { name: string; url: string }[] = []; const seen = new Set<string>();
  const re = /\/afile\/fileDownload\/[A-Za-z0-9_\-./%=?&]+/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const path = m[0].replace(/&amp;/g, '&').replace(/["')]+$/, '');
    if (seen.has(path)) continue; seen.add(path);
    // 이름 = 링크 바로 앞(같은 줄)의 글자 조각 중 '이름.확장자'로 끝나는 마지막 것 → 없으면 링크 뒤 조각 → 없으면 '첨부 n'
    const nodes = (chunk: string) => [...chunk.matchAll(/>([^<>]{1,200})</g)].map((x) => strip(x[1])).filter((t) => EXT_END.test(t));
    const before = nodes(html.slice(Math.max(0, m.index - 800), m.index)); const after = nodes(html.slice(m.index, Math.min(html.length, m.index + 400)));
    const name = (before[before.length - 1] ?? after[0] ?? `첨부 ${out.length + 1}`).slice(0, 150);
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
      and coalesce(p.raw->>'files_checked_at', '') < to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS')
      and (${opt.programId ?? null}::uuid is null or p.id = ${opt.programId ?? null}::uuid)
      -- 로컬 11/24(#1149 Next OI 첨부 0개): 예전엔 첨부 없는 공고 전체에서 5건을 먼저 고른 뒤 '진행 중 업무가 있는 공고'만 남겨,
      -- 업무가 있는 공고가 그 5건 밖이면 영영 차례가 오지 않았음 → 처음부터 진행 중 업무(관심·신청 준비·신청)가 있는 공고만 고름
      and (${opt.programId ?? null}::uuid is not null or exists (select 1 from support_work w where w.program_id = p.id and w.withdrawn_at is null and w.status in ('interest', 'preparing', 'applied')))
    order by p.apply_end nulls last limit ${opt.max ?? 20}`;
  const ids = new Set(rows.map((r) => r.id));
  let filled = 0, attached = 0; const errors: string[] = [];
  for (const p of rows.filter((r) => ids.has(r.id))) {
    const url = base ? `${base}/${encodeURIComponent(p.source_id)}` : p.url ?? `${KS}/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${encodeURIComponent(p.source_id)}`;
    try {
      const files = kstartupFilesFromHtml(await fetchHtml(url), base ?? KS);
      await sql`update support_programs set raw = coalesce(raw, '{}'::jsonb) || ${sql.json({ files_checked_at: new Date().toISOString().slice(0, 19), files_found: files.length, files_error: null } as never)}${files.length ? sql`, attachments = ${sql.json(files as never)}` : sql``} where id = ${p.id}`;
      if (!files.length) continue;
      filled++;
      // 그 공고로 만든 열린 업무(회사마다) → 자료실 저장 + 업무에 붙임(같은 파일은 한 번)
      const works = await sql<{ tenant: string; task_id: string; owner_id: string | null; created_by: string | null }[]>`select w.tenant, w.task_id, w.owner_id, w.created_by from support_work w join tasks t on t.id = w.task_id
        where w.program_id = ${p.id} and w.withdrawn_at is null and t.deleted_at is null and t.status <> 'done'`;
      for (const w of works) {
        const { actorOf } = await import('./bidTasks');
        const u = (await actorOf(sql, w.owner_id)) ?? (await actorOf(sql, w.created_by));
        if (!u || u.tenant !== w.tenant) continue;
        const r = await (await import('./autoAttach')).attachSourceFiles(u, { kind: 'support', id: p.id, taskIds: [w.task_id] }).catch((e) => { errors.push(String(e?.message ?? e).slice(0, 80)); return null; });
        attached += r?.ok ?? 0;
      }
    } catch (e) { errors.push(`${p.source_id}: ${String((e as Error)?.message ?? e).slice(0, 80)}`); await sql`update support_programs set raw = coalesce(raw, '{}'::jsonb) || ${sql.json({ files_checked_at: new Date().toISOString().slice(0, 19), files_error: String((e as Error)?.message ?? e).slice(0, 120) } as never)} where id = ${p.id}`; }
  }
  return { checked: ids.size, filled, attached, errors: errors.slice(0, 5) };
}
