import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';

/**
 * 190차(대표 #689 '브랜드 키트를 AI 마케터가 자동 제작하는 버튼'): 브랜드 키트 [AI로 채우기].
 * 소개·주력 상품·말투 한 줄·말투 프로필·금지어·사실 카드·주제 풀·피드 틀 성격·바탕 색·표지 머리말 후보를 한 번에 초안으로 — 저장하지 않음
 * (화면에서 칸마다 고르고 고쳐 [고른 칸 저장] = 사람 확인 · 저장은 기존 PATCH /api/marketing/auto/brands/[id]).
 * 재료(근거): 회사 소개(AI 프로필)·회사 정보(상호·전화·주소·누리집)·이 브랜드의 승인·게시 글·마케팅 공간 자료실 문서 가운데 브랜드 이름이 든 것
 * (기밀 파일·기밀 폴더·AI 대화 첨부·매출 자료 제외, 메일 주소는 가림)·이 브랜드 사진의 AI 설명·로고.
 * 사실 칸(전화·링크·누리집·주소·운영 시간·요금·숫자·다른 이름·검색 키워드)은 재료에 그대로 있는 값만 남기고, 나머지는 빼서 '뺀 것'으로 알린다.
 * 소개·상품 문장도 재료에 없는 숫자나 다른 브랜드 이름이 들면 그 문장을 뺀다(kit-ko-copy: 확인된 숫자만).
 * 색 = 지금 정한 색(피드 틀·영상 끝 화면·브랜드 색) → 로고에서 뽑은 색 → AI 제안. 표지 머리말은 후보만(결정 15-26: 비워 두면 AI 가 글마다 다르게).
 */
const RISKY = ['최고', '1위', '유일', '최초', '100%', '무조건', '완벽', '국내 최대', '보장']; // 표시광고법·광고 심사에서 자주 걸리는 말(원고 지시문과 같은 목록)
const STYLES = ['trust', 'tech', 'event', 'product'] as const;
const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const cut = (x: unknown, n: number) => [...String(x ?? '').trim()].slice(0, n).join('').trim();
const listOf = (x: unknown, n: number, max: number) => [...new Set((Array.isArray(x) ? x : []).map((y) => cut(y, n)).filter(Boolean))].slice(0, max);
const brandName = (b: { name?: unknown }) => String(b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
const digits = (s: string) => s.replace(/\D/g, '');
/** 숫자 덩어리(쉼표 뺌) — '06:00', '55000', '1.5' */
const nums = (s: string) => s.replace(/,/g, '').match(/\d+(?:[.:]\d+)*/g) ?? [];
export const urlKey = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/** 재료 글을 이어 붙여 사실 칸을 대조 — 띄어쓰기·쉼표는 무시, 전화는 숫자만 */
export class Evidence {
  private flat: string; private low: string; private urls: string; private runs: Set<string>;
  constructor(parts: string[]) {
    const plain = parts.filter(Boolean).join('\n');
    this.low = plain.toLowerCase(); this.flat = plain.replace(/[\s,]+/g, '');
    this.urls = this.low.replace(/https?:\/\//g, '').replace(/www\./g, '');
    this.runs = new Set(plain.replace(/(\d)[-.\s)(]+(?=\d)/g, '$1').match(/\d+/g) ?? []);
  }
  has(s: string) { const f = s.replace(/[\s,]+/g, ''); return !!f && this.flat.includes(f); }
  word(s: string) { return !!s.trim() && this.low.includes(s.trim().toLowerCase()); }
  numbers(s: string) { return nums(s).every((n) => this.flat.includes(n)); }
  phone(p: string) { const d = digits(p); return d.length >= 8 && this.runs.has(d); }
  url(u: string) { const k = urlKey(u); return k.length >= 4 && this.urls.includes(k); }
}
const sentences = (s: string) => s.split(/(?<=[.!?。])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

/** 로고에서 바탕 색 뽑기 — 투명·흰색·회색(채도 없음)은 빼고 가장 많은 색 묶음의 평균. 흑백 로고면 null */
export async function logoHex(buf: Buffer): Promise<string | null> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(buf, { density: 96 }).rotate().resize(64, 64, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const groups = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 160 || Math.max(r, g, b) - Math.min(r, g, b) < 28) continue; // 투명·흰·검정·회색
    const k = `${r >> 5}.${g >> 5}.${b >> 5}`;
    const x = groups.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }; x.n++; x.r += r; x.g += g; x.b += b; groups.set(k, x);
  }
  const top = [...groups.values()].sort((p, q) => q.n - p.n)[0];
  if (!top || top.n < 12) return null;
  return `#${[top.r, top.g, top.b].map((v) => Math.round(v / top.n).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

type Facts = { phone?: string; link?: string; website?: string; address?: string; hours?: string; prices?: string; numbers?: string; aliases?: string[]; keywords?: string[] };
export type KitDraft = {
  intro: string; products: string; tone: string; bannedWords: string[];
  voice: { topics: string; audience: string; offer: string; phrases: string[]; avoid: string[]; formality: 'polite' | 'casual' | 'mixed'; emoji: 'none' | 'few' | 'many'; emojis: string[]; examples: string[] };
  facts: Facts; topics: string[]; feed: { style: (typeof STYLES)[number] | null; templates: string[] };
  color: { hex: string | null; from: 'current' | 'logo' | 'ai' | null }; kickers: string[];
};

export async function kitDraft(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('자동 제작 설정은 관리자가 합니다');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [b] = await sql<any[]>`select id, name, color, tone, intro, products, banned_words, voice, facts, topic_pool, feed, video from mkt_brands where id = ${id} and tenant = ${t}`;
  if (!b) throw notFound();
  const Q = await import('./mktQuality');
  const own = brandName(b);
  const facts0 = Q.factsOf(b.facts);
  const names = Q.brandAliases(b).filter((x) => [...x].length >= 2);
  const likeAny = (names.length ? names : [own]).map((x) => `%${x.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant: t } as SessionUser, sql);
  const profiles = (await (await import('./companyProfiles')).companyProfiles(t, sql)).slice(0, 5);
  const posts = await sql<{ title: string; body: string }[]>`select c.title, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = coalesce(c.approved_version, c.current_version)
    where c.tenant = ${t} and c.brand_id = ${id} and c.status in ('published', 'approved') and not c.is_test and length(trim(v.body)) > 20
    order by (c.status = 'published') desc, coalesce(c.published_at, c.scheduled_at, c.updated_at) desc limit 8`;
  const docs = await sql<{ id: string; title: string; text: string }[]>`select f.id, f.title, left(f.text_content, 4000) as text from library_files f
    where f.tenant = ${t} and f.deleted_at is null and f.upload_status = 'ready' and f.space = 'marketing' and coalesce(f.security, 'internal') <> 'confidential'
      and coalesce(f.source, '') not in ('ai', 'ai_attach', 'revenue') and f.text_content is not null and length(trim(f.text_content)) > 40
      and f.mime_type not like 'image/%' and f.mime_type not like 'video/%'
      and not exists (select 1 from library_folder_security fs where fs.tenant = f.tenant and fs.security = 'confidential' and (f.folder = fs.folder or left(f.folder, length(fs.folder) + 1) = fs.folder || '/'))
      and (f.title ilike any(${likeAny}) or f.folder ilike any(${likeAny}) or coalesce(f.description, '') ilike any(${likeAny}) or exists (select 1 from unnest(f.tags) tg where tg ilike any(${likeAny})))
    order by f.updated_at desc limit 4`;
  const M = await import('./mktPhotos');
  const photos = await sql<{ caption: string }[]>`select library_files.vision->>'caption' as caption from library_files where ${M.poolCond(sql, t)} and coalesce(library_files.vision->>'caption', '') <> ''
      and (library_files.title ilike any(${likeAny}) or library_files.folder ilike any(${likeAny}) or exists (select 1 from unnest(library_files.tags) tg where tg ilike any(${likeAny})))
    order by library_files.updated_at desc limit 20`;
  const voice0 = (b.voice ?? {}) as Record<string, unknown>;
  if (!b.intro && !b.products && !co.business && !co.customers && !posts.length && !docs.length && !voice0.audience && !voice0.offer)
    throw badRequest('재료가 없습니다 — 회사 소개(브랜드 키트 위 \'회사 소개·말투·주의할 점\')나 브랜드 소개를 한 줄이라도 적거나, 마케팅 공간 자료실에 브랜드 이름이 든 소개 자료를 올려 주세요');

  // ---- 재료 글(AI 에 보내는 것 = 대조에 쓰는 것) ----
  const profileText = profiles.map((p) => [`- ${p.name}`, p.phone && `전화 ${p.phone}`, p.address && `주소 ${p.address}`, p.website && `누리집 ${p.website}`].filter(Boolean).join(' · ')).join('\n');
  const kitText = [b.intro && `소개: ${b.intro}`, b.products && `주력 상품: ${b.products}`, b.tone && `말투: ${b.tone}`, Q.factsText(facts0), (b.topic_pool ?? []).length ? `[이미 있는 주제 — 겹치지 않게]\n${(b.topic_pool as string[]).join('\n')}` : ''].filter(Boolean).join('\n');
  const postText = posts.map((x, k) => `${k + 1}) ${x.title}\n${cut(x.body, 700)}`).join('\n\n');
  const docText = docs.map((d) => `《${d.title}》\n${cut(String(d.text).replace(MAIL, '[메일]'), 1500)}`).join('\n\n');
  const photoText = photos.map((p) => `- ${cut(p.caption, 80)}`).join('\n');
  const parts = [
    `[브랜드] ${own}`,
    `[우리 회사] ${co.name}${co.industries.length ? ` · 업종: ${co.industries.join('·')}` : ''}${co.business ? `\n사업 소개: ${co.business}` : ''}${co.customers ? `\n주요 고객: ${co.customers}` : ''}${co.tone ? `\n말투: ${co.tone}` : ''}${co.cautions ? `\n주의할 점: ${co.cautions}` : ''}`,
    profileText && `[회사 정보(상호별)]\n${profileText}`, kitText && `[지금 브랜드 키트]\n${kitText}`,
    postText && `[이 브랜드의 승인·게시 글]\n${postText}`, docText && `[자료실 문서(마케팅 공간)]\n${docText}`, photoText && `[이 브랜드 사진 설명]\n${photoText}`,
  ].filter(Boolean) as string[];
  const ev = new Evidence(parts);
  const others = Q.otherBrandNames(await Q.otherBrands(t, id));

  const P = await import('./ai/provider');
  if (!P.aiEnabled()) throw badRequest('AI 비서가 꺼져 있어 초안을 만들 수 없습니다');
  const A = await import('./mktAuto');
  await A.assertMktAi(t);
  const p = P.anthropicProvider({ tier: await A.makeTier(t), maxTokens: 8000 }); // 만드는 일 = 글 모델 · 주제 20개까지 한 번에
  const r = await p.chat({
    system: `회사 마케팅 담당 AI 마케터입니다. 아래 [재료]만 근거로 '${own}' 브랜드의 브랜드 키트 초안을 만듭니다. JSON 하나로만 답합니다.
- intro: 브랜드 소개 2~3문장(무엇을 하는 곳인지·누구를 위한지). 재료에 없는 숫자·실적·순위·수상은 쓰지 않음
- products: 주력 상품·서비스, 항목마다 한 줄(최대 6개). 가격은 재료에 적힌 것만
- tone: 글 말투 한 줄(예: 친근하지만 전문적인 존댓말)
- voice: topics(주로 다루는 주제 한 줄)·audience(고객 한 줄)·offer(파는 것 한 줄)·phrases(재료 글에 실제로 나온 자주 쓰는 말, 최대 8개)·avoid(이 브랜드가 쓰지 않을 상투어·과장, 최대 8개)·formality(polite 존댓말·casual 반말·mixed)·emoji(none·few·many)·emojis(어울리는 이모지 최대 5개)
- bannedWords: 이 브랜드 글에 쓰면 안 되는 말(과장·최상급·보장, 업종에서 오해를 부르는 말) 최대 10개
- facts: 재료에 글자 그대로 있는 값만 옮겨 적습니다. 없으면 ""·[]. 절대 지어내지 않음
  phone(대표 전화)·link(상담·예약 링크)·website(누리집)·address(주소)·hours(운영 시간)·prices(요금·혜택)·numbers('숫자 — 근거' 한 줄씩)·aliases(재료에 나온 이 브랜드의 영문·약칭)·keywords(블로그 검색 키워드 '지역+업종' 최대 5개, 재료에 나온 지역만)
- topics: 돌아가며 쓸 주제 20개, 30자 안팎. 누가(고객 한 명)·어떤 상황에서·무엇을 얻는지 보이게. 막연한 주제('○○의 모든 것'·'월말 정리') 금지, 숫자·가격·후기는 주제에 넣지 않음, 형식을 섞기(자주 묻는 질문·체크리스트·실제 장면·비교·흔한 오해·처음 쓰는 사람 안내), 이미 있는 주제와 겹치지 않게
- style: 피드 틀 성격 — trust(신뢰형: 진한 바탕·실사) · tech(기술·앱형: 휴대폰 화면·비교) · event(매장 이벤트형: 강한 색 포스터·가격) · product(제품 화면형: 화면 카드·큰 글씨) 가운데 하나
- color: 브랜드 바탕 색 제안 #RRGGBB(흰 글자가 잘 읽히는 진한 색, 업종·말투에 어울리게)
- kickers: 표지 머리말 후보 5개(16자 안, 서로 다른 모양 — 질문형·시리즈 이름·꼬리표). 숫자·가격 없이
다른 브랜드·다른 회사 이야기는 쓰지 않습니다${others.length ? `(${others.slice(0, 12).join(', ')})` : ''}.`,
    tools: [], messages: [{ role: 'user', content: `[재료]\n${parts.join('\n\n')}` }],
    format: { type: 'object', additionalProperties: false, required: ['intro', 'products', 'tone', 'voice', 'bannedWords', 'facts', 'topics', 'style', 'color', 'kickers'],
      properties: { intro: { type: 'string' }, products: { type: 'array', items: { type: 'string' } }, tone: { type: 'string' },
        voice: { type: 'object', additionalProperties: false, required: ['topics', 'audience', 'offer', 'phrases', 'avoid', 'formality', 'emoji', 'emojis'],
          properties: { topics: { type: 'string' }, audience: { type: 'string' }, offer: { type: 'string' }, phrases: { type: 'array', items: { type: 'string' } }, avoid: { type: 'array', items: { type: 'string' } },
            formality: { type: 'string', enum: ['polite', 'casual', 'mixed'] }, emoji: { type: 'string', enum: ['none', 'few', 'many'] }, emojis: { type: 'array', items: { type: 'string' } } } },
        bannedWords: { type: 'array', items: { type: 'string' } },
        facts: { type: 'object', additionalProperties: false, required: ['phone', 'link', 'website', 'address', 'hours', 'prices', 'numbers', 'aliases', 'keywords'],
          properties: { phone: { type: 'string' }, link: { type: 'string' }, website: { type: 'string' }, address: { type: 'string' }, hours: { type: 'string' }, prices: { type: 'string' }, numbers: { type: 'string' },
            aliases: { type: 'array', items: { type: 'string' } }, keywords: { type: 'array', items: { type: 'string' } } } },
        topics: { type: 'array', items: { type: 'string' } }, style: { type: 'string', enum: [...STYLES] }, color: { type: 'string' }, kickers: { type: 'array', items: { type: 'string' } } } },
  });
  await A.logAi({ tenant: t, created_by: u.id }, p, r, P);
  let o: any = {}; try { o = JSON.parse(A.textOf(r)); } catch { /* 형식 오류 → 아래에서 안내 */ }
  if (!o || typeof o !== 'object' || (!o.intro && !Array.isArray(o.topics))) throw badRequest('초안을 만들지 못했습니다 — 잠시 뒤 다시 눌러 주세요');

  // ---- 근거 대조 ----
  const dropped: string[] = [];
  const otherIn = (s: string) => !!Q.otherBrandIn(s, others, own);
  const grounded = (text: string, label: string, join: string) => {
    const keep: string[] = []; let lost = 0;
    for (const s of sentences(text)) { if (!ev.numbers(s) || otherIn(s)) lost++; else keep.push(s); }
    if (lost) dropped.push(`${label} — 재료에 없는 숫자나 다른 브랜드 이름이 든 문장 ${lost}개를 뺐습니다`);
    return keep.join(join);
  };
  const intro = cut(grounded(cut(o.intro, 1200), '소개', ' '), 1000);
  const products = cut(grounded(listOf(o.products, 200, 6).join('\n'), '주력 상품', '\n'), 1000);
  const f = o.facts ?? {};
  const facts: Facts = {};
  const keep = (k: keyof Facts, label: string, v: string, ok: boolean) => { if (!v) return; if (ok) (facts as Record<string, unknown>)[k] = v; else dropped.push(`${label} '${cut(v, 40)}' — 재료에서 찾지 못해 뺐습니다`); };
  keep('phone', '대표 전화', cut(f.phone, 40), ev.phone(cut(f.phone, 40)));
  keep('link', '상담·예약 링크', cut(f.link, 200), ev.url(cut(f.link, 200)));
  keep('website', '누리집', cut(f.website, 200), ev.url(cut(f.website, 200)));
  keep('address', '주소', cut(f.address, 200), ev.has(cut(f.address, 200)));
  const factOk = (x: string) => (nums(x).length ? ev.numbers(x) : ev.has(x)); // 숫자가 있으면 숫자마다, 없으면 글 그대로 재료에 있어야
  keep('hours', '운영 시간', cut(f.hours, 200), factOk(cut(f.hours, 200)));
  keep('prices', '요금·혜택', cut(f.prices, 500), factOk(cut(f.prices, 500)));
  keep('numbers', '숫자·근거', cut(f.numbers, 1000), !!nums(cut(f.numbers, 1000)).length && ev.numbers(cut(f.numbers, 1000)));
  const aliases = listOf(f.aliases, 40, 10).filter((x) => x.toLowerCase() !== own.toLowerCase());
  const aliasOk = aliases.filter((x) => ev.word(x) && !otherIn(x));
  if (aliasOk.length) facts.aliases = aliasOk;
  if (aliases.length > aliasOk.length) dropped.push(`다른 이름 ${aliases.length - aliasOk.length}개 — 재료에서 찾지 못해 뺐습니다`);
  const kws = listOf(f.keywords, 30, 5).filter((x) => [...x].length >= 2);
  const kwOk = kws.filter((x) => { const place = x.split(/\s+/)[0]; return !/\d/.test(x) && [...place].length >= 2 && ev.word(place) && !otherIn(x); }); // '지역+업종' — 앞 낱말(지역)이 재료에 있어야
  if (kwOk.length) facts.keywords = kwOk;
  if (kws.length > kwOk.length) dropped.push(`검색 키워드 ${kws.length - kwOk.length}개 — 재료에 없는 지역·낱말이라 뺐습니다`);

  const key = (x: string) => x.replace(/[\s'"‘’“”.,!?·]/g, '');
  const have = new Set([...(b.topic_pool ?? []), ...posts.map((x) => x.title)].map(key));
  const topics = listOf(o.topics, 120, 30).filter((x) => !have.has(key(x)) && !otherIn(x)).slice(0, 20);
  const banned0 = new Set((b.banned_words ?? []).map((x: string) => x.toLowerCase()));
  const bannedWords = [...new Set([...listOf(o.bannedWords, 30, 10), ...RISKY])].filter((x) => !banned0.has(x.toLowerCase()) && !own.includes(x)).slice(0, 20);
  const v = o.voice ?? {};
  const voice: KitDraft['voice'] = { topics: cut(v.topics, 300), audience: cut(v.audience, 300), offer: cut(v.offer, 300), phrases: listOf(v.phrases, 60, 8), avoid: listOf(v.avoid, 60, 8),
    formality: ['polite', 'casual', 'mixed'].includes(v.formality) ? v.formality : 'polite', emoji: ['none', 'few', 'many'].includes(v.emoji) ? v.emoji : 'few',
    emojis: listOf(v.emojis, 4, 5), examples: Array.isArray(voice0.examples) ? (voice0.examples as string[]).slice(0, 5) : [] };
  const kickers = listOf(o.kickers, 16, 8).filter((x) => !/\d/.test(x) && !otherIn(x)).slice(0, 5);
  const F = await import('./mktFeedTemplates');
  const style = (STYLES as readonly string[]).includes(o.style) ? (o.style as (typeof STYLES)[number]) : null;

  // ---- 색: 지금 정한 색 → 로고 → AI ----
  const D = await import('./mktCarouselDraw');
  const cur = await D.brandColorInfo(t, b).catch(() => ({ color: null, from: null }));
  let color: KitDraft['color'] = { hex: null, from: null };
  if (cur.color && cur.from && cur.from !== 'company') color = { hex: cur.color.toUpperCase(), from: 'current' };
  else {
    const same = (n: string) => n.replace(/\s+/g, '').toLowerCase() === own.replace(/\s+/g, '').toLowerCase();
    const ids = [b.video?.logoFileId, profiles.find((x) => same(x.name))?.logo_file_id].filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
    for (const fid of ids) {
      const [lf] = await sql<{ storage_key: string | null; mime_type: string }[]>`select storage_key, mime_type from library_files where id = ${fid} and tenant = ${t} and deleted_at is null and coalesce(security, 'internal') <> 'confidential'`;
      if (!lf?.storage_key || !lf.mime_type.startsWith('image/')) continue;
      const S = await import('./storage');
      const hex = await S.getObject(lf.storage_key).then(logoHex).catch(() => null);
      if (hex) { color = { hex, from: 'logo' }; break; }
    }
    const ai = D.okColor(cut(o.color, 7));
    if (!color.hex && ai && D.lum(ai) < 0.6) color = { hex: ai.toUpperCase(), from: 'ai' };
  }
  const draft: KitDraft = { intro, products, tone: cut(o.tone, 200), bannedWords, voice, facts, topics,
    feed: { style, templates: style ? [...F.FEED_STYLES[style].templates] : [] }, color, kickers };
  return { draft, dropped, sources: { company: !!(co.business || co.customers), profiles: profiles.length, posts: posts.length, docs: docs.map((d) => ({ id: d.id, title: d.title })), photos: photos.length, logo: color.from === 'logo' } };
}
