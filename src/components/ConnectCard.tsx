'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleDashed, Plug, X } from 'lucide-react';
import { useApi } from './client';
import { useSession } from './session';
import { cx } from './ui';

/** V32 3 홈 "연결하면 좋아요" — 회사 관리자에게 메일·문자·카카오톡·동료 초대 연결 상태(✓/연결하기). 다 되거나 닫으면 안 보임 */
export function ConnectCard() {
  const s = useSession();
  const show = !s.tenant?.internal && ['owner', 'admin'].includes(s.user.role);
  const st = useApi<{ workEmail: string | null; phone: string | null; mailChannel: string | null; people: number }>(show ? '/api/onboarding' : null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem('wos_connect_card') === 'off'); } catch { setHidden(false); } }, []);
  if (!show || hidden || !st.data) return null;
  const d = st.data;
  const items: [string, boolean, string, string][] = [
    ['메일', !!d.mailChannel && !!d.workEmail, '/settings', d.mailChannel ? '답장 받을 주소 정하기' : '발송 방식 연결하기'],
    ['문자', !!d.phone, '/settings', '휴대폰 번호 넣기(서명)'],
    ['카카오톡', true, '', '업무에서 바로 보내기'],
    ...(s.tenant?.personal ? [] : [['동료 초대', d.people > 1, '/admin/users', '초대하기'] as [string, boolean, string, string]]),
  ];
  if (items.every((x) => x[1])) return null;
  const close = () => { try { localStorage.setItem('wos_connect_card', 'off'); } catch {} setHidden(true); };
  return (
    <section className="rounded-card border border-brand-200 bg-brand-50/60 p-3" data-testid="connect-card">
      <div className="flex items-center gap-2"><Plug className="size-4 text-brand-700" /><h2 className="text-sm font-semibold">연결하면 좋아요</h2>
        <button type="button" onClick={close} className="ml-auto rounded p-1 text-ink-3 hover:bg-white" aria-label="닫기"><X className="size-4" /></button></div>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-4">
        {items.map(([l, ok, href, cta]) => (
          <li key={l} className={cx('flex items-center gap-1.5 rounded-input bg-white px-2.5 py-2 text-sm', ok && 'text-ink-2')}>
            {ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <CircleDashed className="size-4 shrink-0 text-ink-3" />}
            <b className="font-medium">{l}</b>
            {ok ? <span className="ml-auto text-xs text-ink-3">{href ? '연결됨' : cta}</span> : <Link href={href} className="ml-auto text-xs font-medium text-brand-700 underline">{cta}</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}
