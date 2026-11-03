import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { HttpError, badRequest } from './errors';
import { appUrl, mailConfigured, mailDevMode, sendMail } from './mail';
import { SITE } from './landingPages';
import { sidoIn } from './sales/region';

/**
 * #949(대표 승인 11/04 03:4x '광고로만 유입에 대한 제안을 승인합니다'): 입찰 공고 아침 메일 무료 구독 — 광고 유입용 무료 미끼.
 * - 소개 페이지 /landing/bid-alerts 에서 이메일·관심 지역(시·도)·관심 분야만 받고 [무료로 받기]. 회사 가입·카드 없음.
 * - 매일 아침(KST BID_ALERT_HOUR, 기본 7시) 정기 실행이 구독자마다 조건에 맞는 새 공고(지난 메일 뒤 처음 본 것, 마감 전, 취소 아님) 최대 10건을 한 통으로. 새 공고가 없는 날은 보내지 않는다.
 * - 메일 맨 아래 '워크인 14일 체험' 한 줄(가입 링크 utm_source=bid_alert) · 수신 거부 한 번 누름(token) · 개인정보 안내 한 줄 · 열람 측정 1×1 그림.
 * - 측정(bidAlertStats): 구독·수신 거부·보낸 메일·열람·체험 가입(tenants.signup_utm->>'source' = 'bid_alert') → 플랫폼 운영 가입 흐름 칸.
 * - 앱(아이폰·안드로이드) 안에는 이 페이지·링크를 두지 않는다(#942 — /landing/* 는 앱에서 로그인으로 보냄).
 */
export const SIDO_LIST = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'] as const;
/** 관심 분야 — 기존 수집 분류(다짐 주민공동시설·하이링크 출입/키오스크)와 그 밖 관리·용역 */
export const BID_ALERT_FIELDS: { key: string; name: string; words: string[] }[] = [
  { key: 'community', name: '주민공동시설 위탁운영', words: ['주민공동시설', '주민운동시설', '커뮤니티', '위탁운영', '위탁 운영', '헬스', '피트니스', '수영장', '골프', 'GX', '독서실', '키즈', '사우나', '체육시설', '체력단련'] },
  { key: 'facility', name: '시설관리·관리용역', words: ['시설관리', '시설물', '관리용역', '관리 용역', '승강기', '소방', '전기안전', '기계설비', '위탁관리', '주택관리'] },
  { key: 'cleaning', name: '청소·미화·방역', words: ['청소', '미화', '방역', '소독', '위생'] },
  { key: 'access', name: '출입통제·키오스크·보안', words: ['출입', '키오스크', '주차', '차량', '보안', 'CCTV', '경비', '안면', '얼굴인식', '무인'] },
  { key: 'repair', name: '보수·공사', words: ['공사', '보수', '도장', '방수', '교체', '설치', '리모델링'] },
  { key: 'goods', name: '물품·그 밖 용역', words: [] }, // 위 분야에 안 걸리는 나머지
];
const FIELD_KEYS = BID_ALERT_FIELDS.map((f) => f.key);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const subscribeInput = z.object({
  email: z.string().trim().toLowerCase().max(120).regex(EMAIL_RE, '이메일 주소를 확인해 주세요'),
  regions: z.array(z.enum(SIDO_LIST)).max(SIDO_LIST.length).default([]),
  fields: z.array(z.string()).min(1, '관심 분야를 하나 이상 골라 주세요').max(FIELD_KEYS.length).refine((a) => a.every((k) => FIELD_KEYS.includes(k)), '관심 분야 값이 맞지 않습니다'),
  agree: z.literal(true, { errorMap: () => ({ message: '개인정보 수집·이용에 동의해 주세요' }) }),
  utm: z.object({ source: z.string().max(80), medium: z.string().max(80), campaign: z.string().max(120), page: z.string().regex(/^[a-z0-9-]{1,40}$/) }).partial().optional(),
});
export type SubscribeInput = z.infer<typeof subscribeInput>;
const sql = () => db();
const token = () => randomBytes(18).toString('base64url');

/** 신청(같은 이메일이면 조건만 바꾸고 다시 받게) — 한 주소(IP)에서 한 시간 20건까지 */
export async function subscribe(i: SubscribeInput, ip: string | null) {
  const s = sql();
  if (ip) {
    const [{ n }] = await s<{ n: number }[]>`select count(*)::int n from bid_alert_subscribers where created_ip = ${ip} and created_at > now() - interval '1 hour'`;
    if (n >= 20) throw new HttpError(429, 'too_many', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  const utm = i.utm && Object.values(i.utm).some(Boolean) ? i.utm : null;
  const fields = [...new Set(i.fields)]; const regions = [...new Set(i.regions)];
  const [row] = await s<{ id: string; existed: boolean }[]>`insert into bid_alert_subscribers (email, regions, fields, token, status, utm, created_ip)
    values (${i.email}, ${regions}, ${fields}, ${token()}, 'active', ${utm ? s.json(utm as never) : null}, ${ip})
    on conflict (email) do update set regions = excluded.regions, fields = excluded.fields, status = 'active', unsubscribed_at = null, utm = coalesce(bid_alert_subscribers.utm, excluded.utm)
    returning id, (xmax <> 0) as existed`;
  return { ok: true, resubscribed: row.existed, regions, fields };
}

/** 수신 거부(메일 맨 아래 한 번) — 토큰이 없어도 조용히 ok(이미 지웠거나 잘못된 링크) */
export async function unsubscribe(t: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(t)) return { ok: false };
  const r = await sql()`update bid_alert_subscribers set status = 'unsubscribed', unsubscribed_at = coalesce(unsubscribed_at, now()) where token = ${t} returning id`;
  return { ok: r.length > 0 };
}
/** 열람(1×1 그림) — 그날 보낸 메일이 있을 때만 셈 */
export async function recordOpen(t: string, day: string) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(t) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const s = sql();
  const r = await s`update bid_alert_sends d set opened_at = coalesce(d.opened_at, now()) from bid_alert_subscribers b where b.token = ${t} and d.subscriber_id = b.id and d.day = ${day}::date returning d.subscriber_id`;
  if (!r.length) return false;
  await s`update bid_alert_subscribers set open_count = open_count + 1, last_opened_at = now() where id = ${r[0].subscriber_id}`;
  return true;
}

// ---------------- 공고 고르기 ----------------
type Row = Record<string, any>;
const SRC: Record<string, string> = { kapt_bid: 'K-apt', g2b_bid: '나라장터', nuri_bid: '누리장터', g2b_prespec: '나라장터 사전규격', lh_bid: 'LH', onbid: '온비드', vendor_recruit: '협력사 모집', dapa_bid: '국방전자조달' };
const srcLabel = (t: string) => SRC[t] ?? (/g2b/.test(t) ? '나라장터' : /kapt/.test(t) ? 'K-apt' : t || '공고');
const txt = (r: Row, ...k: string[]) => k.map((x) => String(r[x] ?? '')).join(' ');
const canceled = (r: Row) => r.notice_kind === 'cancel' || /취소/.test(String(r.current_status ?? '')) || /취소/.test(String(r.notice_state ?? ''));
export type AlertItem = { id: string; title: string; issuer: string | null; region: string | null; deadline: string | null; dday: number | null; url: string; source: string; field: string | null };
/** 분야 판정: 제목·분류·수집 분야 글에 분야 낱말이 있으면 그 분야, 어디에도 없으면 '물품·그 밖 용역'(goods) */
export function fieldOf(r: Row): string {
  const hay = txt(r, 'title', 'bid_category', 'notice_type', 'facility_name', 'fit_business') + ' ' + (Array.isArray(r.matched_keywords) ? r.matched_keywords.join(' ') : '');
  const low = hay.toLowerCase();
  for (const f of BID_ALERT_FIELDS) if (f.words.some((w) => low.includes(w.toLowerCase()))) return f.key;
  return 'goods';
}
const kstDay = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kstHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const ddayOf = (deadline: string | null, day: string) => { if (!deadline) return null; const d = kstDay(new Date(deadline)); return Math.round((Date.parse(`${d}T00:00:00+09:00`) - Date.parse(`${day}T00:00:00+09:00`)) / 864e5); };
/** 구독자 조건(지역·분야)에 맞는 새 공고 — 마감 지난 것·취소·주소 없는 것 제외, 최근 수집 순, 최대 10건 */
export function pickItems(sub: { regions: string[]; fields: string[] }, rows: { src_id: string; row: Row }[], sinceMs: number, day: string, max = 10): AlertItem[] {
  const out: AlertItem[] = [];
  const sorted = [...rows].sort((a, b) => String(b.row.first_seen_at ?? '').localeCompare(String(a.row.first_seen_at ?? '')));
  for (const { src_id, row: r } of sorted) {
    const seen = Date.parse(String(r.first_seen_at ?? '')); if (!Number.isFinite(seen) || seen < sinceMs) continue;
    if (canceled(r) || !/^https?:\/\//.test(String(r.source_url ?? ''))) continue;
    const dday = ddayOf(r.deadline_at ? String(r.deadline_at) : null, day); if (dday !== null && dday < 0) continue;
    const field = fieldOf(r); if (sub.fields.length && !sub.fields.includes(field)) continue;
    const sido = sidoIn(r.region, r.office_address, r.issuer, r.title);
    if (sub.regions.length && (!sido || !sub.regions.includes(sido))) continue;
    out.push({ id: src_id, title: String(r.title ?? '').trim(), issuer: r.issuer ? String(r.issuer) : null, region: sido, deadline: r.deadline_at ? String(r.deadline_at) : null, dday, url: String(r.source_url), source: srcLabel(String(r.source_type ?? '')), field });
    if (out.length >= max) break;
  }
  return out;
}

// ---------------- 메일 ----------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const mdw = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return `${m}/${dd}(${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`; };
const when = (iso: string) => { const d = new Date(iso); const day = kstDay(d); const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); return `${mdw(day)} ${hm}`; };
const dd = (n: number | null) => (n === null ? '' : n === 0 ? 'D-day' : `D-${n}`);
/** 가입 링크(웹) — 앱 안에서는 이 메일 링크를 쓰지 않음(#942). utm_source=bid_alert 로 체험 전환을 센다 */
export const TRIAL_URL = `${SITE}/signup?utm_source=bid_alert&utm_medium=email&utm_campaign=morning`;
export const PRIVACY_LINE = '이 메일은 work-in.dev 에서 입찰 공고 아침 메일을 신청한 분께 보냅니다. 이메일 주소는 이 메일을 보내는 데만 쓰고, 수신 거부하면 30일 안에 지웁니다.';
export function alertMail(sub: { token: string; regions: string[]; fields: string[] }, items: AlertItem[], day: string) {
  const base = appUrl();
  const unsub = `${base}/api/public/bid-alerts/unsubscribe?t=${encodeURIComponent(sub.token)}`;
  const pixel = `${base}/api/public/bid-alerts/open?t=${encodeURIComponent(sub.token)}&d=${day}`;
  const cond = `${sub.regions.length ? sub.regions.join('·') : '전국'} · ${BID_ALERT_FIELDS.filter((f) => sub.fields.includes(f.key)).map((f) => f.name).join('·') || '모든 분야'}`;
  const subject = `[워크인] ${mdw(day)} 새 입찰 공고 ${items.length}건 — ${items[0]?.title.slice(0, 40) ?? ''}`;
  const rows = items.map((i, n) => {
    const l2 = [i.issuer, i.region, i.deadline ? `마감 ${when(i.deadline)} ${dd(i.dday)}`.trim() : '마감 미정', i.source].filter(Boolean).join(' · ');
    return `<tr><td style="padding:12px 16px;border-top:1px solid #E5E7EB"><div style="font-size:15px;line-height:22px;font-weight:700;color:#0F172A"><span style="color:#94A3B8;margin-right:4px">${n + 1}.</span><a href="${esc(i.url)}" style="color:#0F172A;text-decoration:none">${esc(i.title)}</a></div><div style="margin-top:3px;font-size:13px;line-height:20px;color:#475569">${esc(l2)}</div><div style="margin-top:2px;font-size:12px;color:#64748B"><a href="${esc(i.url)}" style="color:#0F766E;text-decoration:underline">원문 보기</a></div></td></tr>`;
  }).join('');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F6F5"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F6F5"><tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:680px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:10px;font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0F172A" data-bid-alert="1">
<tr><td style="padding:18px 16px 14px;background:#ECFDF5;border-radius:10px 10px 0 0"><div style="font-size:12px;font-weight:700;color:#0F766E">워크인 입찰 공고 아침 메일</div><div style="margin-top:4px;font-size:18px;font-weight:800">${mdw(day)} 새 공고 ${items.length}건</div><div style="margin-top:4px;font-size:12px;color:#475569">받는 조건: ${esc(cond)} · 새 공고가 있는 날만 보냅니다</div></td></tr>
${rows}
<tr><td style="padding:16px;border-top:1px solid #E5E7EB;background:#F8FAFC;font-size:13px;line-height:20px;color:#334155" data-bid-alert-trial="1">이 공고를 담당·마감·첨부가 든 업무로 넘기고 팀과 함께 관리하려면 <a href="${esc(TRIAL_URL)}" style="color:#0F766E;font-weight:700;text-decoration:underline">워크인 14일 무료 체험</a>으로 시작할 수 있습니다.</td></tr>
<tr><td style="padding:12px 16px 18px;font-size:11px;line-height:17px;color:#94A3B8">${esc(PRIVACY_LINE)} <a href="${esc(unsub)}" style="color:#64748B;text-decoration:underline" data-bid-alert-unsub="1">수신 거부</a></td></tr>
</table><img src="${esc(pixel)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0"></td></tr></table></body></html>`;
  const text = [`[워크인] ${mdw(day)} 새 입찰 공고 ${items.length}건 (${cond})`, '',
    ...items.map((i, n) => `${n + 1}. ${i.title}\n   ${[i.issuer, i.region, i.deadline ? `마감 ${when(i.deadline)} ${dd(i.dday)}`.trim() : '마감 미정', i.source].filter(Boolean).join(' · ')}\n   ${i.url}`),
    '', `이 공고를 담당·마감·첨부가 든 업무로 넘기고 팀과 함께 관리하려면 워크인 14일 무료 체험: ${TRIAL_URL}`, '', PRIVACY_LINE, `수신 거부: ${unsub}`].join('\n');
  return { subject, html, text };
}

// ---------------- 정기 발송 ----------------
/** tick: KST BID_ALERT_HOUR(기본 7시)부터 구독자마다 하루 1번 — 새 공고가 있으면 메일, 없으면 보내지 않고 날만 기록. 수신 거부 30일 지난 줄은 지움 */
export async function bidAlertTick() {
  const s = sql(); const day = kstDay(); const hour = Number(process.env.BID_ALERT_HOUR ?? 7);
  if (kstHour() < hour) return { skipped: 'hour' };
  await s`delete from bid_alert_subscribers where status = 'unsubscribed' and unsubscribed_at < now() - interval '30 days'`;
  const subs = await s<{ id: string; email: string; regions: string[]; fields: string[]; token: string; last_sent_day: string | null }[]>`select id, email, regions, fields, token, last_sent_day::text from bid_alert_subscribers
    where status = 'active' and (last_sent_day is null or last_sent_day < ${day}::date) order by created_at limit 200`;
  if (!subs.length) return { sent: 0, subscribers: 0 };
  if (!mailConfigured() && !mailDevMode()) return { sent: 0, subscribers: subs.length, error: '메일 발송 미설정' };
  const from = new Date(Date.now() - 36 * 36e5).toISOString().slice(0, 10);
  const rows = await s<{ src_id: string; row: Row }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'first_seen_at' >= ${from} limit 4000`;
  let sent = 0, empty = 0; const errors: string[] = [];
  for (const sub of subs) {
    // 지난 메일(또는 신청) 뒤 처음 본 공고만 — 처음이면 어제 0시(KST)부터
    const sinceMs = sub.last_sent_day ? Date.parse(`${sub.last_sent_day}T00:00:00+09:00`) : Date.parse(`${day}T00:00:00+09:00`) - 864e5;
    const items = pickItems(sub, rows, sinceMs, day);
    if (!items.length) { empty++; await s`update bid_alert_subscribers set last_sent_day = ${day}::date where id = ${sub.id}`; continue; }
    const m = alertMail(sub, items, day);
    try {
      await sendMail(sub.email, m.subject, m.text, m.html);
      await s`insert into bid_alert_sends (day, subscriber_id, n) values (${day}::date, ${sub.id}, ${items.length}) on conflict (day, subscriber_id) do update set n = excluded.n`;
      await s`update bid_alert_subscribers set last_sent_day = ${day}::date, sent_count = sent_count + 1 where id = ${sub.id}`;
      sent++;
    } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); if (errors.length >= 3) break; }
  }
  return { sent, empty, subscribers: subs.length, ...(errors.length ? { error: errors[0] } : {}) };
}

/** 플랫폼 운영 측정: 구독(활성·수신 거부·최근 n일 신청)·보낸 메일·열람·체험 가입(utm_source = bid_alert) */
export async function bidAlertStats(days = 30) {
  const s = sql();
  const [c] = await s<{ active: number; unsub: number; recent: number }[]>`select count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'unsubscribed')::int unsub,
    count(*) filter (where created_at > now() - make_interval(days => ${days}))::int recent from bid_alert_subscribers`;
  const [m] = await s<{ sent: number; opened: number }[]>`select count(*)::int sent, count(*) filter (where opened_at is not null)::int opened from bid_alert_sends where day > (now() at time zone 'Asia/Seoul')::date - ${days}::int`;
  const [t] = await s<{ signups: number }[]>`select count(*)::int signups from tenants where kind = 'company' and signup_utm->>'source' = 'bid_alert' and created_at > now() - make_interval(days => ${days})`;
  return { days, subscribers: c.active, unsubscribed: c.unsub, newSubscribers: c.recent, sent: m.sent, opened: m.opened, signups: t.signups };
}
/** 소개 페이지 폼 선택지(서버·클라이언트 공용) */
export const bidAlertOptions = () => ({ regions: [...SIDO_LIST], fields: BID_ALERT_FIELDS.map(({ key, name }) => ({ key, name })) });
/** 공개 설명(소개 페이지·시험) — kit-ko-copy: 과장·확인 안 된 숫자 없음, 요금은 '14일 무료 체험'만 */
export const BID_ALERT_COPY = {
  kicker: '입찰 공고 아침 메일 · 무료',
  h1: '관심 지역 입찰 공고, 매일 아침 메일로 받으세요',
  intro: '나라장터·아파트(K-apt) 관리 입찰·협력사 모집 공고 가운데 관심 지역·분야에 맞는 새 공고를 매일 아침 한 통으로 보내 드립니다. 이메일만 적으면 됩니다. 회사 가입도, 카드도 없습니다.',
  done: '신청됐습니다. 내일 아침 7시부터 새 공고가 있는 날 메일이 갑니다. 그만 받으려면 메일 맨 아래 [수신 거부]를 한 번 누르면 됩니다.',
  consent: '이메일 주소를 아침 메일을 보내는 데만 쓰고, 수신 거부하면 30일 안에 지우는 데 동의합니다(개인정보 수집·이용 동의).',
  button: '무료로 받기',
} as const;
export { badRequest };
