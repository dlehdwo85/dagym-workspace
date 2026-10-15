'use client';
import { useState } from 'react';
import { Copy, MessageCircle, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { api, broadcastRefresh } from './client';
import { Button, cx, inputCls, toast } from './ui';
import { kakaoEnabled, kakaoText, shareKakao } from './kakao';
import { isNativeApp } from './native';

const copyText = (s: string) => navigator.clipboard?.writeText(s).then(() => true, () => false) ?? Promise.resolve(false);

/** V28-2A [카카오톡으로 보내기] — 휴대폰은 카카오톡 앱, PC 는 카카오 공유 창 또는 QR 로 휴대폰에 넘김. [보냈어요]를 누르면 보관함·업무 기록에 남긴다 */
export function KakaoSend({ taskId, body, msgId, onLogged, big }: { taskId: string; body: string; msgId?: number; onLogged?: () => void; big?: boolean }) {
  const [step, setStep] = useState<'idle' | 'opened' | 'done'>('idle');
  const [qr, setQr] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const cut = kakaoText(body).cut;
  if (!kakaoEnabled()) return <span className="self-center text-xs text-ink-3">카카오톡 키가 아직 없습니다 — 복사해서 보내 주세요</span>;

  async function open() {
    if (cut && await copyText(body)) toast.info('본문이 길어 앞부분만 들어갑니다 — 전체 내용을 복사해 두었으니 대화창에 붙여넣으세요');
    try {
      await shareKakao({ text: body, url: `${location.origin}/tasks/${taskId}`, buttonTitle: '업무 보기' });
      setStep('opened');
    } catch (e: any) { toast.error(e?.message || '카카오톡을 열지 못했습니다 — 복사해서 보내 주세요'); }
  }
  async function toPhone() {
    const url = `${location.origin}/share/kakao?t=${taskId}${msgId ? `&m=${msgId}` : ''}`;
    setQr(await QRCode.toDataURL(url, { margin: 1, width: 200 }).catch(() => null));
    setStep('opened');
  }
  /** 앱 웹뷰에서 공유 창이 안 열릴 때: 복사하고 카카오톡만 연다 */
  async function copyAndOpen() {
    await copyText(body); toast.ok('복사했습니다 — 카카오톡에서 붙여넣으세요');
    location.href = 'kakaotalk://launch';
    setStep('opened');
  }
  async function done(sent: boolean) {
    if (!sent) { setStep('idle'); setQr(null); return; }
    try {
      await api('/api/mail/kakao-log', { body: { taskId, body, to: to.trim() || undefined } });
      toast.ok('카카오톡 보낸 기록을 남겼습니다'); setStep('done'); broadcastRefresh(); onLogged?.();
    } catch (e: any) { toast.error(e.message); }
  }
  if (step === 'done') return <span className="self-center text-xs font-medium text-emerald-700" data-testid="kakao-logged">카카오톡 보낸 기록을 남겼습니다</span>;
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  return (
    <div className={cx('flex w-full flex-col gap-1.5', big && 'gap-3')} data-testid="kakao-send">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={open} data-testid="kakao-open"
          className={cx('inline-flex items-center gap-1 rounded-input bg-[#FEE500] px-2.5 py-1 text-xs font-semibold text-[#191600] hover:brightness-95', big && 'w-full justify-center py-3 text-base')}>
          <MessageCircle className={big ? 'size-5' : 'size-3.5'} />카카오톡으로 보내기</button>
        {!touch && !big && <Button size="sm" variant="ghost" onClick={toPhone} data-testid="kakao-qr"><Smartphone />휴대폰으로 넘기기</Button>}
        {isNativeApp() && <Button size="sm" variant="ghost" onClick={copyAndOpen}><Copy />안 열리면: 복사하고 카카오톡 열기</Button>}
      </div>
      {cut && <p className="text-[11px] text-ink-3">카카오톡 공유는 200자까지 — 앞부분만 들어가고 전체는 복사해 둡니다</p>}
      {step === 'opened' && (
        <div className="space-y-2 rounded-input border border-line p-2 text-xs" data-testid="kakao-confirm">
          {qr && <div className="flex items-center gap-3"><img src={qr} alt="휴대폰으로 찍으면 워크인에서 카카오톡 보내기가 열립니다" className="size-32" />
            <p className="text-ink-2">휴대폰 카메라로 찍으면 워크인(로그인 필요)에서 같은 내용이 열립니다. 거기서 [카카오톡으로 보내기] → [보냈어요]를 누르면 기록됩니다.</p></div>}
          {qr ? <Button size="sm" variant="secondary" onClick={() => done(false)}>닫기</Button> : <>
            <p className="text-ink-2">카카오톡에서 보냈나요? 누구에게 보냈는지 적어 두면 보관함에서 찾기 쉽습니다.</p>
            <input className={cx(inputCls, 'py-1 text-xs')} value={to} onChange={(e) => setTo(e.target.value)} placeholder="받는 사람(선택) 예: 관리소장님" maxLength={100} data-testid="kakao-to" />
            <div className="flex gap-1.5"><Button size="sm" onClick={() => done(true)} data-testid="kakao-sent">보냈어요</Button><Button size="sm" variant="secondary" onClick={() => done(false)}>안 보냄</Button></div></>}
        </div>
      )}
    </div>
  );
}
