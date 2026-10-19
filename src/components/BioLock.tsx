'use client';
import { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { BIO_KEY, bioAuthenticate, bioAvailable, isNativeApp, onAppActive } from './native';
import { Button, toast } from './ui';

/**
 * 로컬 10/19(대표) 앱 자동 로그인 + 생체 인증: 앱은 늘 로그인 유지, 켜 두면 앱을 열거나 돌아올 때(1분 넘게 뒤에 있던 뒤) 지문·얼굴로 잠금 해제.
 * 서버 세션은 그대로(화면만 가림). 켜고 끄기는 설정 › 보안. 플러그인이 없는 빌드에서는 보이지 않음
 */
export function BioLock() {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const on = () => { try { return localStorage.getItem(BIO_KEY) === '1'; } catch { return false; } };
  async function unlock() {
    setBusy(true);
    const ok = await bioAuthenticate();
    setBusy(false);
    if (ok) setLocked(false);
  }
  useEffect(() => {
    if (!isNativeApp() || !on()) return;
    let hidden = 0;
    setLocked(true); unlock();
    document.addEventListener('visibilitychange', () => { if (document.hidden) hidden = Date.now(); });
    onAppActive(() => { if (on() && hidden && Date.now() - hidden > 60_000) { setLocked(true); unlock(); } });
  }, []);  
  if (!locked) return null;
  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-white p-6 text-center" data-testid="bio-lock">
      <Fingerprint className="size-12 text-brand-600" aria-hidden />
      <p className="text-lg font-bold">워크인 잠금</p>
      <p className="text-sm text-ink-2">지문·얼굴 또는 기기 잠금 번호로 풀어 주세요.</p>
      <Button onClick={unlock} disabled={busy}>{busy ? '확인 중…' : '잠금 해제'}</Button>
    </div>
  );
}

/** 설정 › 보안: 앱에서만 보이는 생체 인증 켜기/끄기(켤 때 한 번 확인) */
export function BioLockSetting() {
  const [avail, setAvail] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => { bioAvailable().then(setAvail); try { setOn(localStorage.getItem(BIO_KEY) === '1'); } catch {} }, []);
  if (!avail) return null;
  async function toggle(v: boolean) {
    if (v && !(await bioAuthenticate('생체 인증 잠금 켜기'))) return toast.error('확인되지 않아 켜지 않았습니다');
    try { localStorage.setItem(BIO_KEY, v ? '1' : '0'); } catch {}
    setOn(v); toast.ok(v ? '앱을 열 때 지문·얼굴로 잠금을 풉니다' : '생체 인증 잠금을 껐습니다');
  }
  return (
    <div className="mt-4" data-testid="bio-setting">
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={on} onChange={(e) => toggle(e.target.checked)} />
        <span><b className="font-medium">생체 인증 잠금 (이 앱)</b><span className="block text-xs text-ink-2">앱은 항상 로그인이 유지됩니다. 켜면 앱을 열거나 1분 넘게 뒤에 있다 돌아올 때 지문·얼굴로 확인합니다.</span></span></label>
    </div>
  );
}
