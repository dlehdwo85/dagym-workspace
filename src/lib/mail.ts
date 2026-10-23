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
