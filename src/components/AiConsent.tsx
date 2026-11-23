'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, useApi } from './client';
import { isIosApp } from './inApp';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Modal, fmtDateTime, toast } from './ui';
import { AI_CONSENT_COPY as C, aiRecipients } from '@/lib/ai/consentCopy';

/**
 * AI 동의(대표 11/19 결정 — 애플 5.1.2): 바깥 AI 로 보내기 전에 무엇을·어디로·왜 보내는지 알리고 허락을 받는다.
 * - 처음 들어오면 한 번(아직 정하지 않은 사람). [나중에 정하기]는 이 기기에서 다시 조르지 않고, AI 단추를 누를 때 다시 뜬다.
 * - 동의하지 않은 사람이 AI 단추를 누르면 서버가 403 ai_consent → client 가 'wos-ai-consent' 를 알리고 여기서 창을 띄운다.
 * 글은 src/lib/ai/consentCopy.ts 한곳.
 * 대표 11/23 #1087: 웹·안드로이드 앱은 필수 동의 — 아직 동의하지 않은 사람(정하지 않음·예전에 '쓰지 않기')은 들어오면 닫을 수 없는 동의 화면
 * ([동의하고 계속] · [로그아웃]), 설정에서는 끌 수 없음(탈퇴 안내). 아이폰 앱은 1.2.0 심사 통과 전까지 예전 그대로(선택).
 */
/** 필수 동의를 쓰는지(아이폰 앱만 예외 — 심사 통과 뒤 같은 방식으로) */
export const aiConsentRequired = () => !isIosApp();
type St = { state: 'agreed' | 'declined' | 'none'; at: string | null; version: string; stt: boolean };
const laterKey = (v: string) => `wos_ai_later_${v}`;
export const openAiConsent = () => window.dispatchEvent(new Event('wos-ai-consent-open'));

/** 접어 둔 자세한 내용(동의 창·가입 목록 한 줄이 함께 씀): 세 줄 · 무엇을 · 어디로(나라) · 왜 · 동의하지 않으면 · 국외 이전(시기·방법·보유 기간) */
export function AiConsentDetail({ stt, required }: { stt: boolean; required?: boolean }) {
  const points = required ? [C.points[0], C.points[1], C.corePoint] : C.points;
  const H = ({ children }: { children: React.ReactNode }) => <h3 className="mt-3 text-[13px] font-semibold text-ink">{children}</h3>;
  const L = ({ items, testid }: { items: string[]; testid?: string }) => <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2" data-testid={testid}>{items.map((x) => <li key={x}>{x}</li>)}</ul>;
  return (
    <>
      <ul className="mt-3 space-y-1 text-ink-2" data-testid="ai-consent-points">{points.map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />{x}</li>)}</ul>
      <H>{C.whatTitle}</H><L items={C.what(stt)} />
      <H>{C.whereTitle}</H>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2" data-testid="ai-consent-recipients">{aiRecipients(stt).map((r) => <li key={r.name}><b className="text-ink">{r.name}</b>({r.country}) — {r.what}</li>)}</ul>
      <H>{C.whyTitle}</H><L items={C.why(stt)} />
      <H>{C.declineTitle}</H><L items={required ? C.requiredDecline : C.decline} />
      <H>{C.transferTitle}</H><L items={C.transfer(stt)} testid="ai-consent-transfer" />
      <p className="mt-2 text-xs text-ink-3"><Link href="/privacy" target="_blank" className="underline">개인정보 처리방침</Link> · <Link href="/ai-notice" target="_blank" className="underline">AI 이용 안내</Link></p>
    </>
  );
}

export function AiConsentNotice({ stt, required }: { stt: boolean; required?: boolean }) {
  return (
    <div className="text-sm leading-relaxed" data-testid="ai-consent-notice">
      {/* 대표 11/20 #1086 '약관처럼 상세를 접어서': 펼치지 않아도 보이는 것 = 한 문장(무엇을 위해·누구에게). 세 줄·항목·나라·까닭·국외 이전은 [자세히 보기] 안 */}
      <p data-testid="ai-consent-lead">{C.lead(stt)}</p>
      <details className="group mt-3 rounded-input border border-line" data-testid="ai-consent-more">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-ink hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 text-ink-3 transition-transform group-open:rotate-90" aria-hidden />{C.more}<span className="font-normal text-ink-3">— {C.moreHint}</span></summary>
        <div className="border-t border-line px-3 pb-3"><AiConsentDetail stt={stt} required={required} /></div>
      </details>
    </div>
  );
}

/**
 * 대표 11/20 #1086: 가입·초대 수락·요금제 동의 목록의 한 줄 — "[선택] AI 기능 이용 동의 — 답을 만들 때 필요한 내용만 AI 회사(Anthropic)에 보내 처리 [자세히 ▾]".
 * 기본은 체크 안 됨(선택). 체크하면 그 사람의 AI 동의(지금 판)로 저장 → 로그인 뒤 창이 다시 뜨지 않음. 체크하지 않으면 '아직 안 정함'(거절 아님).
 */
export function AiConsentLine({ checked, onChange, stt = false, required = false }: { checked: boolean; onChange: (v: boolean) => void; stt?: boolean; /** #1087 웹·안드로이드 = 필수 */ required?: boolean }) {
  const tag = required ? C.requiredTag : C.optionalTag;
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm" data-testid="ai-consent-line">
      <div className="flex items-start gap-2">
        <label className="flex min-w-0 flex-1 items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={`${tag} AI 기능 이용 동의`} data-testid="agree-ai" />
          <span><span className={required ? 'text-red-600' : 'text-ink-3'}>{tag}</span> {C.lineLabel} <span className="text-ink-3">— {C.line(stt)}</span></span>
        </label>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex shrink-0 items-center gap-0.5 text-xs text-ink-3 underline hover:text-ink" data-testid="ai-consent-line-more">
          {C.lineMore}<ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /></button>
      </div>
      {open && <div className="ml-6 mt-1.5 rounded-input border border-line bg-slate-50 px-3 pb-3 text-xs leading-relaxed" data-testid="ai-consent-line-detail"><AiConsentDetail stt={stt} required={required} /></div>}
    </div>
  );
}

/** 앱 틀에 한 번 올려 두는 문지기 — 창 두 가지(전체 안내 / 막혔을 때 짧은 안내) */
export function AiConsentGate({ off }: { off?: boolean }) {
  const [st, setSt] = useState<St | null>(null);
  const [open, setOpen] = useState<false | 'full' | 'blocked' | 'required'>(false);
  const [req, setReq] = useState(false); // #1087 필수 동의(아이폰 앱 말고) — 첫 그림 뒤에 정함
  useEffect(() => setReq(aiConsentRequired()), []);
  const [fromBlock, setFromBlock] = useState(false); // AI 단추를 눌렀다가 온 길이면 동의 뒤 '한 번 더 눌러 주세요'
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<St>('/api/account/ai-consent').then((r) => { setSt(r); return r; }).catch(() => null), []);
  // 처음 들어오면: 아직 정하지 않았고, 이 기기에서 '나중에'를 누른 적이 없으면 — 다른 창(처음 사용 안내 등)이 닫힌 뒤에
  useEffect(() => {
    if (off) return;
    let alive = true; let t: ReturnType<typeof setTimeout>;
    load().then((r) => {
      const must = aiConsentRequired();
      if (!alive || !r || r.state === 'agreed' || (!must && r.state !== 'none')) return;
      if (!must) { try { if (localStorage.getItem(laterKey(r.version))) return; } catch {} }
      let tries = 0;
      const tryOpen = () => {
        if (!alive) return;
        if (document.querySelector('[data-modal-root], [data-tour-root]') && tries++ < 60) { t = setTimeout(tryOpen, 2000); return; }
        setFromBlock(false); setOpen(must ? 'required' : 'full');
      };
      t = setTimeout(tryOpen, 1200);
    });
    return () => { alive = false; clearTimeout(t); };
  }, [off, load]);
  // AI 단추를 눌렀는데 서버가 막음(403 ai_consent) · 설정의 [내용 다시 보기]
  useEffect(() => {
    if (off) return;
    let last = 0; // 한 화면이 여러 요청을 한꺼번에 보내도 창은 한 번(1분에 한 번) — 그사이에는 화면의 안내 한 줄만
    const blocked = () => {
      if (Date.now() - last < 60_000) return;
      last = Date.now();
      load().then((r) => { if (!r || r.state === 'agreed') return; setFromBlock(true); setOpen((o) => o || (aiConsentRequired() ? 'required' : r.state === 'declined' ? 'blocked' : 'full')); });
    };
    const show = () => { load().then((r) => { setFromBlock(false); setOpen(aiConsentRequired() && r?.state !== 'agreed' ? 'required' : 'full'); }); };
    window.addEventListener('wos-ai-consent', blocked); window.addEventListener('wos-ai-consent-open', show);
    return () => { window.removeEventListener('wos-ai-consent', blocked); window.removeEventListener('wos-ai-consent-open', show); };
  }, [off, load]);
  if (off || !st) return null;
  async function decide(agreed: boolean) {
    setBusy(true);
    try {
      const r = await api<St>('/api/account/ai-consent', { method: 'PUT', body: { agreed } });
      setSt(r); setOpen(false); window.dispatchEvent(new Event('wos-ai-consent-changed'));
      toast.ok(agreed ? (fromBlock ? 'AI 기능을 켰습니다 — 방금 누른 것을 한 번 더 눌러 주세요' : req ? '동의했습니다' : 'AI 기능을 켰습니다') : 'AI 기능을 쓰지 않습니다 — 설정 › 개인정보·AI 에서 언제든 바꿀 수 있습니다');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  const later = () => { try { localStorage.setItem(laterKey(st.version), '1'); } catch {} setOpen(false); };
  return (
    <>
      <Modal open={open === 'full'} onClose={later} title={C.title}>
        <div data-testid="ai-consent">
          <AiConsentNotice stt={st.stt} required={req} />
          {/* 단추 줄은 창 아래에 붙여 둔다 — [자세히 보기]를 펼쳐 글이 길어져도(휴대폰) 단추가 늘 보이게 */}
          <div className="sticky bottom-0 -mx-5 -mb-[calc(var(--sab)+20px)] mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-white px-5 pb-[calc(var(--sab)+12px)] pt-3 sm:-mb-5 sm:pb-4" data-testid="ai-consent-actions">
            {req && st.state === 'agreed' ? <Button variant="secondary" onClick={() => setOpen(false)} data-testid="ai-consent-close">닫기</Button> /* 필수 동의를 한 사람의 [내용 다시 보기] */
              : <>
                <button type="button" className="mr-auto h-9 rounded-input px-2 text-sm text-ink-3 hover:bg-slate-100" onClick={later} data-testid="ai-consent-later">{C.later}</button>
                <Button variant="secondary" disabled={busy} onClick={() => decide(false)} data-testid="ai-consent-refuse">{C.refuse}</Button>
                <Button disabled={busy} onClick={() => decide(true)} data-testid="ai-consent-agree">{C.agree}</Button>
              </>}
          </div>
        </div>
      </Modal>
      {/* #1087 필수 동의(웹·안드로이드): 닫기·나중에·쓰지 않기 없음 — [동의하고 계속] 또는 [로그아웃] */}
      <Modal open={open === 'required'} onClose={() => {}} locked title={C.requiredTitle}>
        <div data-testid="ai-consent-required">
          <p className="mb-2 text-sm font-medium text-ink" data-testid="ai-consent-required-lead">{C.requiredLead}</p>
          <AiConsentNotice stt={st.stt} required />
          <div className="sticky bottom-0 -mx-5 -mb-[calc(var(--sab)+20px)] mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-white px-5 pb-[calc(var(--sab)+12px)] pt-3 sm:-mb-5 sm:pb-4">
            <button type="button" className="mr-auto h-9 rounded-input px-2 text-sm text-ink-3 hover:bg-slate-100" onClick={() => window.dispatchEvent(new Event('wos-logout'))} data-testid="ai-consent-logout">{C.requiredLogout}</button>
            <Button disabled={busy} onClick={() => decide(true)} data-testid="ai-consent-required-agree">{C.requiredAgree}</Button>
          </div>
        </div>
      </Modal>
      <Modal open={open === 'blocked'} onClose={() => setOpen(false)} title={C.blockedTitle}>
        <div className="space-y-3 text-sm" data-testid="ai-consent-blocked">
          <p className="text-ink-2">{C.blocked(st.stt)}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>닫기</Button>
            <Button onClick={() => setOpen('full')} data-testid="ai-consent-blocked-open">{C.blockedOpen}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** 설정 › 개인정보·AI — 켜기·끄기, 동의한 날, [내용 다시 보기] */
export function AiConsentSetting() {
  const { data, reload } = useApi<St>('/api/account/ai-consent');
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState(false); // #1087 필수(아이폰 앱 말고) — 끄기 없음
  useEffect(() => setReq(aiConsentRequired()), []);
  useEffect(() => { const h = () => reload(); window.addEventListener('wos-ai-consent-changed', h); return () => window.removeEventListener('wos-ai-consent-changed', h); }, [reload]);
  if (!data) return null;
  const on = data.state === 'agreed';
  async function toggle(next: boolean) {
    if (next) { openAiConsent(); return; } // 켤 때는 안내 글을 읽고 [AI 기능 쓰기]로
    setBusy(true);
    try { await api('/api/account/ai-consent', { method: 'PUT', body: { agreed: false } }); toast.ok('AI 기능을 껐습니다 — 이제 내 내용을 바깥으로 보내지 않습니다'); reload(); window.dispatchEvent(new Event('wos-ai-consent-changed')); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (req) return (
    <div id="ai-consent" className="mt-4 rounded-input border border-line p-3" data-testid="ai-consent-setting">
      <b className="font-medium">개인정보·AI</b>
      <p className="mt-2 text-sm"><span className="font-medium">{C.settingLabel}</span> <span className="text-ink-3">{C.requiredTag}</span></p>
      <p className="mt-0.5 text-xs text-ink-3">{C.setting(data.stt).replace(/ 끄면 그때부터 보내지 않습니다\.$/, '')}</p>
      <p className="mt-0.5 text-xs text-ink-3" data-testid="ai-consent-required-note">{C.requiredSetting}</p>
      <p className="mt-0.5 text-xs text-ink-3">{on && data.at ? `${fmtDateTime(data.at)} 동의` : '아직 동의하지 않음'} · <button type="button" className="underline" onClick={openAiConsent} data-testid="ai-consent-review">{on ? '내용 다시 보기' : '동의하기'}</button></p>
    </div>
  );
  return (
    <div id="ai-consent" className="mt-4 rounded-input border border-line p-3" data-testid="ai-consent-setting">
      <b className="font-medium">개인정보·AI</b>
      <label className="mt-2 flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} data-testid="ai-consent-toggle" />
        <span><span className="font-medium">{C.settingLabel}</span>
          <span className="mt-0.5 block text-xs text-ink-3">{C.setting(data.stt)}</span>
          <span className="mt-0.5 block text-xs text-ink-3">{on && data.at ? `${fmtDateTime(data.at)} 동의` : data.state === 'declined' ? '동의하지 않음' : '아직 정하지 않음'} · <button type="button" className="underline" onClick={openAiConsent} data-testid="ai-consent-review">내용 다시 보기</button></span></span>
      </label>
    </div>
  );
}

/** 관리 › 회사 정보 — 사람이 누르지 않아도 도는 자동 작업용 회사 스위치 */
export function AiAutoSetting() {
  const st = useApi<{ on: boolean; at: string | null }>('/api/org/ai-auto');
  const [busy, setBusy] = useState(false);
  if (!st.data) return null;
  const toggle = async (on: boolean) => {
    setBusy(true);
    try { await api('/api/org/ai-auto', { method: 'PUT', body: { on } }); st.reload(); toast.ok(on ? '회사 자료 자동 AI 처리를 켰습니다' : '회사 자료 자동 AI 처리를 껐습니다'); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-card border border-line bg-white p-4 text-sm shadow-card" data-testid="ai-auto-setting">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-0.5 size-4" checked={st.data.on} disabled={busy} onChange={(e) => toggle(e.target.checked)} data-testid="ai-auto-toggle" />
        <span><b>{C.autoLabel}</b>
          <span className="mt-0.5 block text-xs text-ink-2">{C.auto}</span>
          <span className="mt-0.5 block text-xs text-ink-3">사람이 직접 누르는 AI 기능은 이 스위치와 상관없이 각자 동의한 사람만 씁니다(설정 › 개인정보·AI).</span></span>
      </label>
    </div>
  );
}
