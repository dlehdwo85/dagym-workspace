'use client';
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { api } from './client';
import { readUtm } from './conversion';

const LOOK: Record<string, { label: string; cls: string; mark: React.ReactNode }> = {
  kakao: { label: '카카오', cls: 'bg-[#FEE500] text-[#191600] hover:brightness-95', mark: <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden><path fill="currentColor" d="M12 3C6.5 3 2 6.6 2 11c0 2.8 1.9 5.3 4.7 6.7l-1 3.6c-.1.3.3.6.6.4l4.2-2.8c.5.1 1 .1 1.5.1 5.5 0 10-3.6 10-8S17.5 3 12 3z" /></svg> },
  naver: { label: '네이버', cls: 'bg-[#03C75A] text-white hover:brightness-95', mark: <span className="text-[15px] font-black leading-none" aria-hidden>N</span> },
  google: { label: 'Google', cls: 'border border-line bg-white text-ink hover:bg-slate-50', mark: <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.2-4.8 3.2-8.1z" /><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.8 14c-.2-.7-.4-1.3-.4-2s.1-1.4.4-2V7.1H2.1A11 11 0 0 0 1 12c0 1.8.4 3.4 1.1 4.9L5.8 14z" /><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 12 1 11 11 0 0 0 2.1 7.1L5.8 10C6.7 7.3 9.1 5.4 12 5.4z" /></svg> },
};

/** V29 소셜 가입·로그인 버튼 — 키가 등록된 제공자만(없으면 아무것도 안 보임) */
export function SocialButtons({ verb = '시작', invite, mode = 'login', onReady }: { verb?: string; invite?: string; mode?: 'login' | 'link'; onReady?: (n: number) => void }) {
  const [ps, setPs] = useState<string[]>([]);
  useEffect(() => { api('/api/auth/oauth/providers').then((r) => { setPs(r.providers); onReady?.(r.providers.length); }).catch(() => onReady?.(0)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ps.length) return null;
  const href = (p: string) => {
    const q = new URLSearchParams({ mode, client: Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web' });
    if (invite) q.set('invite', invite);
    const u = readUtm();
    if (u?.source) q.set('utm_source', u.source); if (u?.medium) q.set('utm_medium', u.medium); if (u?.campaign) q.set('utm_campaign', u.campaign);
    return `/api/auth/oauth/${p}/start?${q}`;
  };
  return (
    <div className="space-y-2" data-testid="social-buttons">
      {ps.map((p) => (
        <a key={p} href={href(p)} className={`flex h-11 w-full items-center justify-center gap-2 rounded-input text-[15px] font-semibold ${LOOK[p].cls}`} data-testid={`social-${p}`}>
          {LOOK[p].mark}{LOOK[p].label}로 {verb}
        </a>
      ))}
    </div>
  );
}
export function OrDivider({ text = '또는 이메일로' }: { text?: string }) {
  return <div className="flex items-center gap-3 text-xs text-ink-3"><span className="h-px flex-1 bg-line" />{text}<span className="h-px flex-1 bg-line" /></div>;
}
