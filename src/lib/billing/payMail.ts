import { db } from '../db';
import { appUrl } from '../mail';

/**
 * 302차 #862(대표 11/01 '앱 결제 없이 웹에서 결제하도록 안내할 때 편리하게'): 체험 끝·결제 실패·미납 안내 메일을 휴대폰에서 바로 결제되게.
 * 앱 밖(관리자 이메일)으로만 보냄 — 앱 화면·알림·푸시에는 결제 권유·웹 주소·가격을 넣지 않는다(App Store 3.1.1·3.1.3(f), 구글 결제 정책 · 298차 #861).
 * 메일: 회사 이름 · 사용 인원 · 추천 요금제 · 월 금액(부가세 포함) · [결제하기] 버튼(로그인 안 돼 있으면 로그인 뒤 결제 화면으로 돌아옴) + 글자만 보는 메일 앱용 본문
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

export type PayMail = { subject: string; text: string; html: string; url: string; plan: { code: string; name: string; seats: number; amount: number } | null };

export async function payMail(tenant: string, o: { title: string; lines: string[]; button?: string }): Promise<PayMail> {
  const sql = db();
  const [t] = await sql<{ name: string; plan_code: string | null; chosen_plan: string | null }[]>`select t.name, s.plan_code, s.chosen_plan from tenants t
    left join tenant_subscriptions s on s.tenant = t.id where t.id = ${tenant}`;
  const plans = await sql<{ code: string }[]>`select code from plans where public and active and code not in ('trial', 'free', 'team_free', 'w_free') order by sort`;
  // 추천 요금제 = 체험 중 고른 요금제 → 지금 요금제 → 공개 요금제 첫 번째
  const code = [t?.chosen_plan, t?.plan_code].find((c) => c && plans.some((p) => p.code === c)) ?? plans[0]?.code ?? null;
  const q = code ? await (await import('./index')).quote(tenant, code, 'monthly', sql).catch(() => null) : null;
  const plan = q ? { code: q.plan.code as string, name: String(q.plan.name), seats: q.seats, amount: q.amount } : null;
  const url = `${appUrl()}/admin/usage?pay=1${plan ? `&plan=${encodeURIComponent(plan.code)}` : ''}`;
  const name = t?.name ?? '';
  const facts: [string, string][] = [['회사', name], ...(plan ? [['사용 인원', `${plan.seats}명`], ['추천 요금제', plan.name], ['월 금액', `${won(plan.amount)} (부가세 포함)`]] as [string, string][] : [])];
  const button = o.button ?? '결제하기';
  const text = [o.title, '', ...o.lines, '', ...facts.map(([k, v]) => `${k}: ${v}`), '', `${button}: ${url}`, '로그인이 필요하면 로그인 뒤 결제 화면으로 바로 이어집니다. 휴대폰에서도 결제할 수 있어요.'].join('\n');
  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f4f6fa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827">
<tr><td style="padding:24px 24px 8px;font-size:13px;color:#0f766e;font-weight:700">워크인</td></tr>
<tr><td style="padding:0 24px 12px;font-size:20px;font-weight:700;line-height:1.4">${esc(o.title)}</td></tr>
<tr><td style="padding:0 24px 16px;font-size:15px;line-height:1.6;color:#374151">${o.lines.map((l) => esc(l)).join('<br>')}</td></tr>
<tr><td style="padding:0 24px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;font-size:14px">
${facts.map(([k, v], i) => `<tr><td style="padding:10px 12px;color:#6b7280;width:96px;${i ? 'border-top:1px solid #f1f5f9;' : ''}">${esc(k)}</td><td style="padding:10px 12px;font-weight:600;${i ? 'border-top:1px solid #f1f5f9;' : ''}">${esc(v)}</td></tr>`).join('\n')}
</table></td></tr>
<tr><td align="center" style="padding:8px 24px 8px"><a href="${esc(url)}" data-pay-button="1" style="display:block;background:#0f766e;color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;padding:16px 12px;border-radius:10px;text-align:center">${esc(button)}</a></td></tr>
<tr><td style="padding:4px 24px 24px;font-size:12px;line-height:1.6;color:#6b7280">로그인이 필요하면 로그인 뒤 결제 화면으로 바로 이어집니다. 휴대폰에서도 결제할 수 있어요.<br>데이터는 그대로 남아 있습니다.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject: `[워크인] ${o.title}`, text, html, url, plan };
}

/** 공간 관리자(대표·관리자)에게 결제 안내 메일 — 실패해도 정기 실행은 계속 */
export async function sendPayMail(tenant: string, o: { title: string; lines: string[]; button?: string }) {
  const sql = db();
  const admins = await sql<{ email: string }[]>`select email from users where tenant = ${tenant} and status = 'active' and role in ('owner','admin')`;
  if (!admins.length) return 0;
  const m = await payMail(tenant, o);
  const { sendMail } = await import('../mail');
  let n = 0;
  for (const a of admins) if (await sendMail(a.email, m.subject, m.text, m.html).then(() => true, () => false)) n++;
  return n;
}
