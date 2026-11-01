'use client';
import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { api, useApi } from './client';
import { Button, inputCls, toast } from './ui';

type Kind = 'trial_d3' | 'trial_d0' | 'pay_ok' | 'pay_fail' | 'signup';
type Data = { service: boolean; phone: string; ok: boolean; okAt: string | null; canTest: boolean; kinds: { kind: Kind; name: string; ready: boolean }[] };

/**
 * 304차 #871 결제·약관 안내 카카오 알림톡(대표 결정: 결제할 때·이용약관 동의할 때만) — 관리자 본인 휴대폰·동의.
 * 명함 전화와 따로 저장(동료에게 안 보임). 운영 설정 전에는 '준비 중'으로만 보이고 저장은 됨.
 */
export function AlimtalkCard() {
  const { data, reload } = useApi<Data>('/api/account/alimtalk');
  const [phone, setPhone] = useState('');
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testKind, setTestKind] = useState<Kind>('pay_ok');
  useEffect(() => { if (data) { setPhone(data.phone); setOk(data.ok); } }, [data]);
  if (!data) return null;
  const dirty = phone !== data.phone || ok !== data.ok;
  async function save() {
    setBusy(true);
    try { await api('/api/account/alimtalk', { method: 'PUT', body: { phone: phone.trim() || null, ok } }); toast.ok('저장했습니다'); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try {
      const r = await api('/api/platform/alimtalk', { body: { kind: testKind } });
      if (r.result === 'sent') toast.ok(`시험 알림톡을 보냈습니다(${r.to})`); else toast.error(r.error ? `보내지 못했습니다: ${r.error}` : '보내지 못했습니다');
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="alimtalk-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircle className="size-4 text-ink-2" />카카오 알림톡 결제·가입 안내</h2>
        <span className="text-xs text-ink-3" data-testid="alimtalk-service">{data.service ? '발송 중' : '발송 준비 중 — 지금은 이메일로만 안내'}</span>
      </div>
      <p className="mt-1 text-xs text-ink-2">무료 체험 종료 3일 전·당일, 결제 완료, 정기 결제 실패, 가입(약관 동의) 완료 때만 보냅니다. 광고는 보내지 않습니다. 이메일 안내는 그대로 갑니다.</p>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label className="text-xs text-ink-2">내 휴대폰(알림톡 받을 번호)
          <input className={inputCls + ' mt-0.5 h-9 w-44'} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={20} placeholder="010-1234-5678" data-testid="alimtalk-phone" />
        </label>
        <label className="flex h-9 items-center gap-1.5 text-sm"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="alimtalk-ok" />결제·약관 안내를 알림톡으로 받기(선택)</label>
        <Button size="sm" onClick={save} disabled={busy || !dirty} data-testid="alimtalk-save">저장</Button>
      </div>
      <p className="mt-1.5 text-xs text-ink-3">이 번호는 알림톡 안내에만 쓰고 동료에게 보이지 않습니다.{data.ok && data.okAt ? ` 동의: ${new Date(data.okAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}` : ''}</p>
      {data.canTest && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs" data-testid="alimtalk-test">
          <span className="text-ink-2">운영자 시험 발송(내 번호로 예시 값 1건)</span>
          <select className={inputCls + ' h-8 w-auto text-xs'} value={testKind} onChange={(e) => setTestKind(e.target.value as Kind)} aria-label="시험할 안내">
            {data.kinds.map((k) => <option key={k.kind} value={k.kind} disabled={!k.ready}>{k.name}{k.ready ? '' : ' (템플릿 번호 없음)'}</option>)}
          </select>
          <Button size="sm" variant="secondary" onClick={test} disabled={busy}>시험 발송</Button>
        </div>
      )}
    </section>
  );
}
