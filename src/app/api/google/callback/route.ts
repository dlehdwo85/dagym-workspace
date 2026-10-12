import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { currentUser } from '@/lib/auth';
import { exchangeCode, saveTokens } from '@/lib/google/client';
import { logError } from '@/lib/log';

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  const back = (q: string) => NextResponse.redirect(`${base}/settings/google?${q}`, 302);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${base}/login?next=/settings/google`, 302);
  if (p.get('error')) return back(`error=${encodeURIComponent(p.get('error')!)}`);
  const sql = db();
  const [st] = await sql`delete from google_oauth_states where state = ${p.get('state') ?? ''} and created_at > now() - interval '15 minutes' returning user_id, mode`;
  if (!st || st.user_id !== user.id) return back('error=state');
  try {
    const t = await exchangeCode(p.get('code') ?? '');
    const scopes = t.scope.split(' ');
    if (!scopes.some((s) => s.includes('calendar.events'))) return back('error=scope_denied');
    await saveTokens(user.id, t);
    await sql`insert into sync_logs (user_id, direction, action, status, detail) values (${user.id}, 'auth', 'connect', 'ok', ${sql.json({ scopes })})`;
    return back(`connected=1&mode=${st.mode}`);
  } catch (e) {
    await logError('google-callback', e);
    return back('error=exchange');
  }
}
