/**
 * V15 메일 발송 (가입 확인·비밀번호 재설정). Resend HTTP API 를 쓴다 — 키가 없으면 보내지 않는다.
 * - 운영: RESEND_API_KEY + MAIL_FROM(예: "워크인 <no-reply@도메인>") 필요. 도메인 인증은 Resend 화면에서.
 * - 개발·시험(운영이 아닐 때)만 응답에 확인 링크(devLink)를 돌려준다. 운영에서 키가 없으면 "발송 미설정" 오류.
 */
export const mailConfigured = () => !!process.env.RESEND_API_KEY && !!process.env.MAIL_FROM;
export const mailDevMode = () => !mailConfigured() && (process.env.NODE_ENV !== 'production' || process.env.MAIL_DEV === '1');

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<'sent' | 'dev'> {
  if (!mailConfigured()) {
    if (mailDevMode()) return 'dev';
    throw new Error('메일 발송이 설정되지 않았습니다(RESEND_API_KEY·MAIL_FROM)');
  }
  const r = await fetch(`${process.env.RESEND_API_BASE ?? 'https://api.resend.com'}/emails`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`메일 발송 실패 (${r.status}) ${(await r.text()).slice(0, 200)}`);
  return 'sent';
}

export const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export type MailButton = { label: string; url: string };
/**
 * 워크인 메일 틀(대표 11/19 — 가입 확인 메일이 글자뿐이고 네이버 메일 앱에서 주소가 안 눌림): 로고·제목·본문·큰 단추 + 단추 아래 주소 글자.
 * 가입 흐름 메일(이메일 확인·승인·환영·거절·비밀번호 재설정)이 같은 틀을 쓴다. 표(table)와 줄 안 스타일만 — 메일 앱은 바깥 스타일·스크립트를 지운다.
 * 주소 글자는 단추가 안 눌리는 메일 앱(그림·단추를 막는 설정)에서도 누르거나 복사할 수 있게 링크 + 그대로 보이는 글자로 둔다.
 */
/** links = 단추 아래 덧붙이는 작은 링크 줄(예: 앱 받기) — 주소 글자도 함께 보여 눌리지 않는 앱에서 복사할 수 있게 */
export function mailHtml(title: string, lines: string[], button?: MailButton, links: MailButton[] = []) {
  const logo = `${appUrl()}/icon-192.png`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f4f6fa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827">
<tr><td style="padding:24px 24px 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:8px"><img src="${esc(logo)}" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px"></td>
<td style="font-size:15px;color:#0f766e;font-weight:700">워크인</td></tr></table></td></tr>
<tr><td style="padding:4px 24px 12px;font-size:20px;font-weight:700;line-height:1.4">${esc(title)}</td></tr>
<tr><td style="padding:0 24px ${button ? 16 : 24}px;font-size:15px;line-height:1.6;color:#374151">${lines.map(esc).join('<br>')}</td></tr>
${button ? `<tr><td align="center" style="padding:0 24px 12px"><a href="${esc(button.url)}" style="display:block;background:#0f766e;color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;padding:16px 12px;border-radius:10px;text-align:center">${esc(button.label)}</a></td></tr>
<tr><td style="padding:0 24px 24px;font-size:12px;line-height:1.6;color:#6b7280">단추가 눌리지 않으면 아래 주소를 눌러 주세요. 그래도 안 되면 주소를 길게 눌러 복사한 뒤 인터넷 창에 붙여 넣으세요.<br><a href="${esc(button.url)}" style="color:#0f766e;text-decoration:underline;word-break:break-all">${esc(button.url)}</a></td></tr>` : ''}
${links.map((l) => `<tr><td style="padding:0 24px 20px;font-size:14px;line-height:1.6;color:#374151">${esc(l.label)}: <a href="${esc(l.url)}" style="color:#0f766e;font-weight:600">${esc(l.url.replace(/^https?:\/\//, ''))}</a></td></tr>`).join('')}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px"><tr><td style="padding:12px 8px 0;font-size:11px;line-height:1.6;color:#9ca3af;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif">이 메일은 워크인에서 자동으로 보낸 안내 메일입니다.</td></tr></table>
</td></tr></table></body></html>`;
}
/** 글자 판(HTML 을 못 보는 메일 앱·미리보기): 제목 · 본문 · 단추 이름과 주소 */
export const mailText = (title: string, lines: string[], button?: MailButton, links: MailButton[] = []) => [title, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...links.map((l) => `${l.label}: ${l.url}`)].join('\n');
/** 틀을 써서 보내기 — 제목 앞에 [워크인] */
export async function sendFramedMail(to: string, title: string, lines: string[], button?: MailButton, subject?: string, links: MailButton[] = []) {
  return sendMail(to, subject ?? `[워크인] ${title}`, mailText(title, lines, button, links), mailHtml(title, lines, button, links));
}
