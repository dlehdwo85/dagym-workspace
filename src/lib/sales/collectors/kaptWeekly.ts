// 200차(대표 10/26 #699·#678): 신규 공동주택 단지 1순위 원천 — K-apt 소통마당 › 자료실 › 기본정보 「K-apt 관리비공개의무단지 기본정보(YYYY.MM.DD.)」 주 1회 엑셀.
// · 전국 의무단지(약 2만 2천 곳) 71칸 — 단지코드·사용승인일·가입일·세대수·주택관리업자·관리사무소 연락처·부대복리시설·주민운동시설 … 공공데이터포털 키·활용신청 없이 받음.
// · 받는 길(화면과 같은 순서·같은 세션): 자료실 목록(CSRF) → 목록 조각(기본정보 글) → 글 보기 → 파일 목록 → 내려받기. 새 글이 있을 때만 내려받음(약 12MB).
// · 시트는 풀면 약 145MB — 줄 단위로 흘려 읽고(eachXlsxRow), 사용승인 18개월 전 ~ 1년 뒤 단지만 '준공·입주 시설'에 단지 코드로 넣음
//   (186차 단지 목록 수집기·K-apt 사업자선정 파생 줄과 같은 단지면 한 줄). 원천 우선순위는 prospects.ts COMPLEX_RANK.
// · 같은 단지가 한국부동산원 줄(부동산원 단지 번호 키)로 이미 있으면 그 줄에 합침 — 지역 + 단지명·도로명주소 + 사용승인일(store.upsertProspects, 별칭 키 alias_keys · 부동산원 다음 실행은 빈 칸만 채움).
// · 글 제목의 추출일 = 원본 기준일(collector_asof) — 준공·입주 시설 탭 '원본 기준일' 줄.
import { db } from '../../db';
import { krPhone } from '../../phone';
import { addDaysYmd, regionFromAddress, todayKst, toYmd } from './files';
import { RECENT_COMPLETION_DAYS } from './prospects';
import { setSourceAsOf, upsertProspects } from './store';
import { eachXlsxRow } from './xlsx';
import type { Collector, CollectorCtx, CollectorResult, SourceStat } from './types';

export const KAPT_WEB_LIST = 'https://www.k-apt.go.kr/web/board/webReference/boardList.do';
const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
const WEB = () => (T() ? `${T()}/kapt-web` : process.env.KAPT_WEB_BASE?.trim().replace(/\/$/, '') || 'https://www.k-apt.go.kr');
const P = { list: '/web/board/webReference/boardList.do', ajax: '/web/board/webReference/boardListAjax.do', view: '/web/board/webReference/boardView.do', files: '/web/board/webReference/fileListData.do?seq=BOARD_FILE', down: '/cmm/file/BOARD/fileDownload.do' };
const STATE = 'kapt_weekly_state', SLUG = 'kapt_weekly_complexes', UPCOMING_DAYS = 365, CHUNK = 300, MAX_FILE = 64 * 1024 * 1024;
const TITLE = /관리비공개의무단지\s*기본정보\s*\((\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\)/;
const REQUIRED = ['단지코드', '단지명', '사용승인일', '세대수'];
const str = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s && s !== '-' ? s : null; };
const int = (v: unknown) => { const t = String(v ?? '').replace(/,/g, '').trim(); if (!/^\d+(\.\d+)?$/.test(t)) return null; return Math.round(Number(t)); };
const kd = (d: string) => `${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}.(${'일월화수목금토'[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
type Post = { seq: string; day: string; title: string };
type State = { seq?: string; day?: string; title?: string; file?: string; rows?: number; kept?: number; adopted?: number; at?: string };

/** 자료실 목록 조각(HTML) → 기본정보 글(비밀글 빼고), 추출일 늦은 것부터 */
export function weeklyPosts(html: string): Post[] {
  const out: Post[] = [];
  for (const part of html.split(/goCheck\(/).slice(1)) {
    const m = part.match(/^\s*(\d+)\s*,\s*(\d+)\s*\)/); if (!m || m[2] !== '0') continue;
    const text = part.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const t = text.match(TITLE); if (!t) continue;
    out.push({ seq: m[1], day: `${t[1]}-${t[2].padStart(2, '0')}-${t[3].padStart(2, '0')}`, title: t[0] });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || Number(b.seq) - Number(a.seq));
}

/** 엑셀 한 줄(칸 이름 → 값) → '준공·입주 시설' 한 줄. 사용승인일이 창(18개월 전 ~ 1년 뒤) 밖이거나 없으면 null */
export function weeklyPayload(get: (h: string) => string | null, today: string, asOf: string): Record<string, unknown> | null {
  const code = str(get('단지코드')), name = str(get('단지명')); if (!code || !name) return null;
  const usedate = toYmd(str(get('사용승인일')) ?? undefined);
  if (!usedate || usedate < addDaysYmd(today, -RECENT_COMPLETION_DAYS) || usedate > addDaysYmd(today, UPCOMING_DAYS)) return null;
  const addr = str(get('법정동주소')), road = str(get('도로명주소'));
  const households = int(get('세대수')), dongs = int(get('동수')), floors = int(get('최고층수'));
  const mgr = str(get('관리방식')), company = str(get('주택관리업자')), builder = str(get('시공사')), kind = str(get('단지분류')), sale = str(get('분양형태'));
  const gym = str(get('주민운동시설')), welfare = str(get('부대복리시설'));
  return {
    // 186차 단지 목록 수집기·K-apt 운영 시설 줄과 같은 종류('아파트')·같은 단지 코드 키 — 주상복합 등 단지 분류는 규모 메모에
    facility_type: '아파트', name, region: regionFromAddress(addr ?? road ?? undefined), address: addr && road ? `${addr} (${road})` : addr ?? road,
    operating_status: usedate > today ? '입주예정' : '입주중', completion_date: usedate, household_count: households,
    scale_note: [kind, households != null ? `${households.toLocaleString('ko-KR')}세대` : null, dongs != null ? `${dongs}개 동` : null, floors ? `최고 ${floors}층` : null,
      mgr ? `관리 ${mgr}` : null, builder ? `시공 ${builder}` : null, sale].filter(Boolean).join(' · ') || null,
    management_company: company && !/^(자치관리|해당\s*없음|없음)$/.test(company) ? company : null,
    office_phone: krPhone(str(get('관리사무소 연락처'))),
    amenities: [welfare, gym ? `주민운동시설: ${gym}` : null].filter(Boolean).join(' · ') || null,
    source_slug: SLUG, source_name: 'K-apt 관리비공개의무단지 기본정보(자료실 주간 엑셀)', source_url: KAPT_WEB_LIST,
    source_external_id: code, facility_code: code, source_observed_at: `${asOf}T00:00:00+09:00`,
  };
}

/** 같은 세션(쿠키)으로 K-apt 화면 주소를 부름 */
function webSession(fetchImpl: typeof fetch, base: string, budget: () => number) {
  const jar = new Map<string, string>();
  return async (path: string, init: RequestInit & { ms?: number } = {}) => {
    const { ms, headers, ...rest } = init;
    const res = await fetchImpl(base + path, { ...rest, redirect: 'manual', signal: AbortSignal.timeout(Math.max(2000, ms ?? budget())),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; WorkIn sales collector)', accept: '*/*', ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...((headers ?? {}) as Record<string, string>) } });
    const h = res.headers as Headers & { getSetCookie?: () => string[] };
    for (const c of h.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : [])) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); }
    return res;
  };
}
const csrfOf = (html: string) => html.match(/name="_csrf"\s+content="([^"]+)"/)?.[1] ?? html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] ?? null;
const csrfHeaderOf = (html: string) => html.match(/name="_csrf_header"\s+content="([^"]+)"/)?.[1] ?? 'X-CSRF-TOKEN';
/** 파일 목록 응답(XML <Res><data>… 또는 JSON) → 내려받을 엑셀 하나(이름에 '기본정보'가 있는 .xlsx 먼저) */
export function pickWeeklyFile(body: string): { key: string; name: string } | { error: string } {
  let files: { key: string; name: string }[] = [];
  const t = body.trim();
  if (t.startsWith('{')) { try { const j = JSON.parse(t); if (j.code && j.code !== 'SCC') return { error: String(j.msg ?? j.code) }; files = (Array.isArray(j.data) ? j.data : [j.data]).filter(Boolean).map((x: any) => ({ key: String(x.seq ?? ''), name: String(x.fileName ?? '') })); } catch { return { error: '파일 목록 응답을 읽지 못함' }; } }
  else {
    const code = t.match(/<code>([^<]*)<\/code>/)?.[1]; if (code && code !== 'SCC') return { error: t.match(/<msg>([^<]*)<\/msg>/)?.[1] ?? code };
    files = [...t.matchAll(/<data>([\s\S]*?)<\/data>/g)].map((m) => ({ key: m[1].match(/<seq>([^<]*)<\/seq>/)?.[1] ?? '', name: m[1].match(/<fileName>([^<]*)<\/fileName>/)?.[1] ?? '' }));
  }
  files = files.filter((f) => f.key && /\.xlsx$/i.test(f.name));
  const f = files.find((x) => /기본정보/.test(x.name)) ?? files[0];
  return f ?? { error: '글에 엑셀 파일이 없음' };
}

export const kaptWeeklyComplexes: Collector = {
  slug: SLUG, label: '신규 공동주택 단지(K-apt 자료실 주간 엑셀)', hourKst: 8, againKst: [12, 18],
  source: 'k-apt.go.kr 소통마당 › 자료실 › 기본정보 「K-apt 관리비공개의무단지 기본정보」 주 1회 엑셀(전국 약 2만 2천 단지, 키 없음) — 새 글이 있을 때만 받아 사용승인 18개월 전 ~ 1년 뒤 단지',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const sql = db(); const t0 = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - t0);
    const today = todayKst(), at = new Date(ctx.now()).toISOString();
    const web: SourceStat = { label: 'K-apt 자료실 기본정보', ok: true, calls: 0, received: 0, kept: 0 };
    const fail = (msg: string): CollectorResult => { web.ok = false; web.error = msg; return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: msg, summary: `K-apt 자료실 · ${msg}`, providerMode: 'web_scrape', sources: { kapt_web: web } }; };
    const go = webSession(ctx.fetchImpl, WEB(), () => Math.min(20000, left() - 3000));
    const form = (o: Record<string, string>) => new URLSearchParams(o);
    // 1) 목록 화면(세션·CSRF) → 기본정보 글
    let tok: string | null, hdr: string, posts: Post[];
    try {
      web.calls++; const page = await (await go(P.list)).text(); tok = csrfOf(page); hdr = csrfHeaderOf(page);
      if (!tok) return fail('자료실 화면에서 보안 값(CSRF)을 찾지 못함 — 화면 형식 변경 의심');
      web.calls++; const list = await go(P.ajax, { method: 'POST', body: form({ scode: '01', boardType: '03', pageNo: '1', stype: '', keyword: '', _csrf: tok }), headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', [hdr]: tok } });
      if (!list.ok) return fail(`자료실 목록 ${list.status}`);
      posts = weeklyPosts(await list.text());
    } catch (e) { return fail(`자료실 요청 실패: ${e instanceof Error ? e.message : String(e)}`); }
    if (!posts.length) return fail("자료실 목록에서 '관리비공개의무단지 기본정보' 글을 찾지 못함 — 화면 형식 변경 의심");
    const post = posts[0];
    const [s0] = await sql<{ row: State }[]>`select row from sales_src_rows where scope = 'global' and tbl = ${STATE} and src_id = 'state'`;
    const st: State = s0?.row ?? {};
    if (st.seq === post.seq && !ctx.params?.force) {
      await setSourceAsOf(SLUG, post.day, '추출(주 1회)');
      return { inserted: 0, updated: 0, unchanged: 0, errors: 0, providerMode: 'web_scrape', sources: { kapt_web: { ...web, note: '새 글 없음' } },
        summary: `새 글 없음 — ${kd(post.day)} 추출분 반영됨(사용승인 18개월 전 ~ 1년 뒤 ${st.kept ?? 0}곳) · 보통 매주 금요일 게시` };
    }
    // 2) 글 보기 → 파일 목록 → 내려받기(같은 세션이어야 파일 목록이 열림)
    let bytes: Uint8Array, file: { key: string; name: string };
    try {
      web.calls++; const view = await (await go(P.view, { method: 'POST', body: form({ seq: post.seq, boardSecret: '0', boardType: '03', pageNo: '1', keyword: '', board_pwd: '', scodeT: '01', _csrf: tok }), headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } })).text();
      tok = csrfOf(view) ?? tok; hdr = view.includes('_csrf_header') ? csrfHeaderOf(view) : hdr;
      web.calls++; const fl = await (await go(P.files, { method: 'POST', body: JSON.stringify({ boardType: '03', pageNo: '1', stype: '', keyword: '', seq: post.seq, scode: '01', boardPwd: '', _csrf: tok }), headers: { 'content-type': 'application/json;charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', [hdr]: tok } })).text();
      const f = pickWeeklyFile(fl); if ('error' in f) return fail(`파일 목록: ${f.error}`);
      file = f;
      web.calls++; const dl = await go(`${P.down}?key=${encodeURIComponent(file.key)}&fileName=${encodeURIComponent(file.name)}`, { ms: Math.min(35000, left() - 12000) });
      const ct = dl.headers.get('content-type') ?? '';
      if (!dl.ok || /xml|html|json/i.test(ct)) return fail(`내려받기 ${dl.status}${/xml|html|json/i.test(ct) ? ` (${(await dl.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)})` : ''}`);
      bytes = new Uint8Array(await dl.arrayBuffer());
    } catch (e) { return fail(`내려받기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fail('받은 파일이 엑셀(xlsx)이 아님');
    if (bytes.length > MAX_FILE) return fail(`파일이 너무 큼(${Math.round(bytes.length / 1e6)}MB)`);
    // 3) 줄 단위로 읽기 — 칸 이름 줄(단지코드)을 찾은 뒤부터
    let col: Map<string, number> | null = null, rows = 0; const payloads: Record<string, unknown>[] = []; const seen = new Set<string>();
    try {
      await eachXlsxRow(bytes, (cells) => {
        if (!col) { const vals = [...cells.values()]; if (vals.includes('단지코드') && vals.includes('사용승인일')) col = new Map([...cells].map(([i, v]) => [v.trim(), i])); return; }
        rows++; const c = col; const p = weeklyPayload((h) => { const i = c.get(h); return i == null ? null : cells.get(i) ?? null; }, today, post.day);
        if (p && !seen.has(String(p.facility_code))) { seen.add(String(p.facility_code)); payloads.push(p); }
      });
    } catch (e) { return fail(`엑셀 읽기 실패: ${e instanceof Error ? e.message : String(e)}`); }
    const header = col as Map<string, number> | null;
    const missing = header ? REQUIRED.filter((h) => !header.has(h)) : REQUIRED;
    if (missing.length) return fail(`엑셀 형식 변경 의심 — 필수 칸 없음: ${missing.join(', ')}`);
    web.received = rows; web.kept = payloads.length;
    // 4) 준공·입주 시설에 쓰기(300곳씩, 시간 안에서) — 한국부동산원 줄로 이미 있는 같은 단지는 그 줄에 합침(adopted)
    let inserted = 0, updated = 0, unchanged = 0, errors = 0, adopted = 0; const logs: string[] = [];
    for (let i = 0; i < payloads.length; i += CHUNK) {
      if (left() < 4000) { errors++; logs.push(`시간 한도 근접 — ${payloads.length - i}곳은 다음 실행에서`); break; }
      const r = await upsertProspects(payloads.slice(i, i + CHUNK));
      inserted += r.inserted; updated += r.updated; unchanged += r.unchanged; adopted += r.crossMatched ?? 0; errors += r.errors + r.invalid; if (r.errorLog && logs.length < 5) logs.push(r.errorLog);
    }
    const complete = !logs.some((l) => /시간 한도/.test(l));
    // 다 쓴 글만 '반영됨'으로 남김 — 시간이 모자랐으면 다음 실행이 같은 글을 다시 받음
    if (complete) await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', ${STATE}, 'state', ${sql.json({ seq: post.seq, day: post.day, title: post.title, file: file.name, rows, kept: payloads.length, adopted, at } as never)}, 'workin')
      on conflict (scope, tbl, src_id) do update set row = excluded.row, synced_at = now()`;
    await setSourceAsOf(SLUG, post.day, '추출(주 1회)');
    const n = (v: number) => v.toLocaleString('ko-KR');
    return {
      inserted, updated, unchanged, errors, errorLog: logs.length ? logs.join('\n') : undefined, providerMode: 'web_scrape', sources: { kapt_web: web },
      summary: `K-apt 자료실 ${kd(post.day)} 추출분 · 전국 ${n(rows)}곳 중 사용승인 18개월 전 ~ 1년 뒤 ${n(payloads.length)}곳 → 신규 ${inserted} · 갱신 ${updated} · 변화없음 ${unchanged}`
        + (adopted ? ` · 한국부동산원 줄로 이미 있던 ${adopted}곳은 그 줄에 합침` : ''),
    };
  },
};
