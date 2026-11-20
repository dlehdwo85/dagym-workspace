import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { Download, MonitorSmartphone, Share, Smartphone } from 'lucide-react';
import { hostSplit } from '@/lib/hostSplit';
import { SITE } from '@/lib/landingPages';
import { APPSTORE_URL, APP_GET_PATH, PLAY_URL, deviceOf, type Device } from '@/lib/storeLinks';

/**
 * 앱 받기(대표 11/20 "사이트 주소를 공유하면 직원들이 앱을 내려받은 후 진행할 수 있도록") — 직원에게 이 주소 하나만 알려 주면 된다.
 * 기기에 맞는 길 하나를 크게: 안드로이드 = Google Play · 아이폰 = App Store(주소가 생기기 전에는 홈 화면에 추가하는 방법) · PC = QR + 두 스토어 + 웹 로그인.
 * 바로 스토어로 넘기지 않고 한 화면을 두는 까닭: 받은 뒤 무엇으로 로그인하는지(회사에서 받은 이메일·초대 링크)를 여기서 알려 줘야 직원이 혼자 끝낸다.
 * 앱 안·앱이 띄운 로그인 창에서는 이 화면에 오지 않는다(미들웨어가 로그인으로 — 스토어 심사: 앱 안에 스토어·가입 길 없음). 요금 글자는 두지 않는다.
 */
const TITLE = '워크인 앱 받기';
const DESC = '워크인 휴대폰 앱을 받는 곳입니다. 회사에서 받은 이메일과 비밀번호로 로그인하세요.';
export const metadata: Metadata = {
  title: TITLE, description: DESC, metadataBase: new URL(SITE), alternates: { canonical: APP_GET_PATH }, robots: { index: true, follow: true },
  openGraph: { type: 'website', url: `${SITE}${APP_GET_PATH}`, siteName: '워크인', title: TITLE, description: DESC, locale: 'ko_KR', images: [{ url: '/landing/og.png', width: 1200, height: 630, alt: '워크인' }] },
};

const btn = 'inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-input bg-brand-600 px-5 py-3 text-base font-semibold text-white hover:bg-brand-700';
const btn2 = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-input border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-slate-50';
const OS: Device[] = ['android', 'ios', 'pc'];

function Steps({ items, testid }: { items: React.ReactNode[]; testid: string }) {
  return (
    <ol className="mt-5 space-y-3 text-left text-sm text-ink-2" data-testid={testid}>
      {items.map((x, n) => (
        <li key={n} className="flex gap-3"><span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700" aria-hidden>{n + 1}</span><span className="leading-relaxed">{x}</span></li>
      ))}
    </ol>
  );
}
const AFTER = [
  <>앱을 설치하고 엽니다.</>,
  <>회사에서 받은 <b className="text-ink">이메일과 비밀번호</b>로 로그인합니다. 초대 링크를 받았다면 먼저 그 링크에서 비밀번호를 정하세요.</>,
  <>알림을 허용하면 마감·회의·메시지를 제때 받습니다.</>,
];

export default async function AppGetPage({ searchParams }: { searchParams: Promise<{ os?: string }> }) {
  const sp = await searchParams;
  const ua = (await headers()).get('user-agent') ?? '';
  const os: Device = OS.includes(sp.os as Device) ? (sp.os as Device) : deviceOf(ua);
  const h = hostSplit(); const app = h.on ? `https://${h.app}` : ''; // 주소 분리를 켠 곳에서는 로그인이 app. 에 있다
  const here = `${SITE}${APP_GET_PATH}`;
  const qr = os === 'pc' ? await QRCode.toString(here, { type: 'svg', margin: 1, width: 176, errorCorrectionLevel: 'M' }).catch(() => '') : '';
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="mx-auto flex max-w-xl items-center px-4 py-4">
        <Link href="/" aria-label="워크인"><img src="/brand/lockup-light.svg" alt="WorkIn 워크인" className="h-8 w-auto" width={160} height={48} /></Link>
        <a href={`${app}/login`} className="ml-auto rounded-input px-3 py-2 text-sm font-semibold text-ink-2 hover:text-ink" data-testid="app-get-login">로그인</a>
      </header>
      <main className="mx-auto max-w-xl px-4 pb-12" data-testid="app-get" data-os={os}>
        <div className="break-keep rounded-card border border-line bg-white p-6 text-center shadow-card sm:p-8">
          <img src="/icon-192.png" alt="" className="mx-auto size-16 rounded-card" width={64} height={64} />
          <h1 className="mt-4 text-2xl font-bold tracking-tight" data-testid="app-get-title">워크인 앱 받기</h1>
          <p className="mt-1.5 text-sm text-ink-2">업무·일정·메시지 알림을 휴대폰에서 바로 받습니다.</p>

          {os === 'android' && <>
            <a href={PLAY_URL} className={`${btn} mt-6`} data-testid="app-get-play"><Download className="size-5" />Google Play 에서 받기</a>
            <Steps testid="app-get-steps" items={AFTER} />
          </>}

          {os === 'ios' && (APPSTORE_URL ? <>
            <a href={APPSTORE_URL} className={`${btn} mt-6`} data-testid="app-get-appstore"><Download className="size-5" />App Store 에서 받기</a>
            <Steps testid="app-get-steps" items={AFTER} />
          </> : <>
            <p className="mt-6 rounded-input bg-slate-50 px-4 py-3 text-sm text-ink-2" data-testid="app-get-ios-soon"><b className="text-ink">아이폰 앱은 준비 중입니다.</b><br />지금은 홈 화면에 추가해서 앱처럼 쓰세요.</p>
            <Steps testid="app-get-ios-steps" items={[
              <><b className="text-ink">Safari</b> 로 아래 [워크인 열기]를 눌러 로그인합니다.</>,
              <>화면 아래 <Share className="inline size-4 align-[-3px]" aria-label="공유" /> 공유 단추를 누릅니다.</>,
              <><b className="text-ink">홈 화면에 추가</b>를 누르면 홈 화면에 워크인 아이콘이 생깁니다.</>,
            ]} />
            <a href={`${app}/login`} className={`${btn} mt-6`} data-testid="app-get-open"><Smartphone className="size-5" />워크인 열기</a>
          </>)}

          {os === 'pc' && <>
            <div className="mt-6 flex flex-col items-center gap-5 sm:flex-row sm:items-start sm:justify-center sm:text-left">
              {qr && <div className="shrink-0 rounded-input border border-line bg-white p-2" role="img" aria-label="앱 받기 주소 QR" data-testid="app-get-qr" dangerouslySetInnerHTML={{ __html: qr }} />}
              <div className="max-w-xs">
                <p className="flex items-center justify-center gap-1.5 text-sm font-semibold sm:justify-start"><MonitorSmartphone className="size-4 text-brand-600" />휴대폰 카메라로 QR 을 비추세요</p>
                <p className="mt-1 text-sm text-ink-2">이 화면이 휴대폰에서 열리고, 기기에 맞는 스토어로 안내합니다.</p>
                <p className="mt-2 break-all font-mono text-xs text-ink-3" data-testid="app-get-url">{here.replace(/^https?:\/\//, '')}</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start" data-testid="app-get-stores">
                  <a href={PLAY_URL} target="_blank" rel="noopener noreferrer" className={btn2} data-testid="app-get-play">Google Play</a>
                  {APPSTORE_URL ? <a href={APPSTORE_URL} target="_blank" rel="noopener noreferrer" className={btn2} data-testid="app-get-appstore">App Store</a>
                    : <span className="inline-flex min-h-[48px] items-center rounded-input border border-dashed border-line px-4 py-2.5 text-sm text-ink-3" data-testid="app-get-appstore-soon">App Store 준비 중</span>}
                </div>
              </div>
            </div>
            <p className="mt-6 border-t border-line pt-5 text-sm text-ink-2">PC 에서는 설치 없이 웹으로 씁니다. <a href={`${app}/login`} className="font-semibold text-brand-700 underline" data-testid="app-get-web">웹으로 로그인</a></p>
          </>}
        </div>

        <nav className="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-3" aria-label="다른 기기 안내" data-testid="app-get-other">
          <span>다른 기기라면</span>
          {os !== 'android' && <Link href={`${APP_GET_PATH}?os=android`} className="underline" data-testid="app-get-os-android">안드로이드</Link>}
          {os !== 'ios' && <Link href={`${APP_GET_PATH}?os=ios`} className="underline" data-testid="app-get-os-ios">아이폰</Link>}
          {os !== 'pc' && <Link href={`${APP_GET_PATH}?os=pc`} className="underline" data-testid="app-get-os-pc">PC</Link>}
        </nav>
        <p className="mt-4 text-center text-[11px] text-ink-3"><Link href="/terms" className="underline">이용약관</Link> · <Link href="/privacy" className="underline">개인정보 처리방침</Link></p>
      </main>
    </div>
  );
}
