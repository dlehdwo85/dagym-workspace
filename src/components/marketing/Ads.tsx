'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const C = '#7C3AED';
const P_COLOR: Record<string, string> = { naver: '#03C75A', google: '#4285F4', meta: '#1877F2' };
type Acc = { id: string; provider: string; external_id: string; label: string; status: string; last_sync_at: string | null; last_error: string | null; brand: string | null };
type Camp = { account_id: string; provider: string; label: string; campaign_id: string; campaign_name: string; currency: string; impressions: number; clicks: number; cost: number; conversions: number };
type Data = { days: number; accounts: Acc[]; totals: { impressions: number; clicks: number; cost: number; conversions: number }; campaigns: Camp[];
  daily: { day: string; clicks: number; cost: number; conversions: number }[]; providers: { key: string; label: string; ready: boolean }[]; canEdit: boolean };
const n0 = (v: number) => Math.round(v).toLocaleString('ko-KR');
const won = (v: number, cur = 'KRW') => (cur === 'KRW' ? `${n0(v)}원` : `${v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${cur}`);
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(2)}%` : '—');

function NaverForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const brands = useApi<{ brands: { id: string; name: string }[] }>('/api/marketing/brands');
  const [f, setF] = useState({ label: '', customerId: '', apiKey: '', secretKey: '', brandId: '' });
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api('/api/marketing/ads/accounts', { body: { ...f, brandId: f.brandId || null } }); toast.ok('연결했습니다 — 최근 7일 성과를 불러왔습니다'); onDone(); onClose(); }
    catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="네이버 검색광고 연결">
      <form onSubmit={save} className="grid gap-3 text-sm" data-testid="naver-form">
        <p className="text-xs text-ink-2">네이버 광고 시스템 › 도구 › API 사용 관리에서 발급한 값을 넣어 주세요. 비밀키는 암호화해 보관하고 다시 보여 주지 않습니다. 성과 <b>읽기</b>만 하며 광고를 바꾸지 않습니다.</p>
        <Field label="이름(예: 본점 검색광고)"><input className={inputCls} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required maxLength={60} data-testid="naver-label" /></Field>
        <Field label="CUSTOMER_ID"><input className={inputCls} value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value.trim() })} required inputMode="numeric" data-testid="naver-cid" /></Field>
        <Field label="액세스 라이선스"><input className={inputCls} value={f.apiKey} onChange={(e) => setF({ ...f, apiKey: e.target.value })} required autoComplete="off" data-testid="naver-key" /></Field>
        <Field label="비밀키"><input type="password" className={inputCls} value={f.secretKey} onChange={(e) => setF({ ...f, secretKey: e.target.value })} required autoComplete="new-password" data-testid="naver-secret" /></Field>
        <Field label="브랜드(선택)"><select className={inputCls} value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">(없음)</option>{(brands.data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy} data-testid="naver-save">{busy ? '확인 중…' : '연결 확인 후 저장'}</Button></div>
      </form>
    </Modal>
  );
}

/** V41 4-2 광고 성과(읽기 전용) — 회사별로 직접 연결한 네이버·Google·Meta 광고 계정 */
export function Ads() {
  const sp = useSearchParams();
  const [days, setDays] = useState(7);
  const [naver, setNaver] = useState(false);
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useApi<Data>(`/api/marketing/ads?days=${days}`, [days]);
  const msg = sp.get('connected') ? `${sp.get('connected') === 'meta' ? 'Meta' : 'Google Ads'} 광고 계정 ${sp.get('count') ?? ''}개를 연결했습니다` : sp.get('error') ? `연결 실패: ${sp.get('error')}` : null;
  async function sync() { setBusy(true); try { const r = await api<{ results: { error?: string }[] }>('/api/marketing/ads/sync', { body: {} }); const bad = r.results.filter((x) => x.error).length; bad ? toast.error(`${bad}개 계정을 읽지 못했습니다`) : toast.ok('최근 7일 성과를 다시 불러왔습니다'); reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  async function remove(a: Acc) { if (!confirm(`${a.label} 연결을 끊을까요? 모은 성과도 함께 지워집니다.`)) return; try { await api(`/api/marketing/ads/accounts/${a.id}`, { method: 'DELETE' }); reload(); } catch (e: any) { toast.error(e.message); } }
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={5} />;
  const t = data.totals;
  const cards: [string, string][] = [['노출', n0(t.impressions)], ['클릭', `${n0(t.clicks)} · ${pct(t.clicks, t.impressions)}`], ['광고비', won(t.cost)], ['전환', `${n0(t.conversions)}${t.conversions ? ` · ${won(t.cost / t.conversions)}/건` : ''}`]];
  const max = Math.max(1, ...data.daily.map((d) => d.cost));
  return (
    <div className="space-y-4" data-testid="mkt-ads">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold" style={{ color: C }}>광고 성과</h1>
        <span className="ml-auto flex gap-1">{[7, 30, 90].map((d) => <Button key={d} size="sm" variant={days === d ? 'primary' : 'secondary'} onClick={() => setDays(d)} data-testid={`ads-days-${d}`}>최근 {d}일</Button>)}</span>
      </div>
      {msg && <p className={cx('rounded-input px-3 py-2 text-sm', sp.get('error') ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800')} role="status">{msg}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{cards.map(([l, v]) => <div key={l} className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ads-card"><div className="text-xs text-ink-2">{l}</div><div className="mt-1 text-lg font-bold tabular-nums" style={{ color: C }}>{v}</div></div>)}</div>
      {!!data.daily.length && (
        <section className="rounded-card border border-line bg-white p-3 shadow-card"><h2 className="mb-2 text-sm font-semibold">날짜별 광고비</h2>
          <div className="flex h-24 items-end gap-1">{data.daily.map((d) => <div key={d.day} className="flex-1 rounded-t" style={{ height: `${Math.max(3, (d.cost / max) * 100)}%`, background: C, opacity: 0.75 }} title={`${d.day} · ${won(d.cost)} · 클릭 ${n0(d.clicks)} · 전환 ${n0(d.conversions)}`} />)}</div></section>
      )}
      <section className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
        <table className="w-full min-w-[640px] text-sm" data-testid="ads-table"><thead className="bg-slate-50 text-xs text-ink-2"><tr><th className="p-2 text-left">캠페인</th><th className="p-2 text-right">노출</th><th className="p-2 text-right">클릭(CTR)</th><th className="p-2 text-right">광고비</th><th className="p-2 text-right">CPC</th><th className="p-2 text-right">전환</th></tr></thead>
          <tbody>{data.campaigns.map((c) => (
            <tr key={`${c.account_id}:${c.campaign_id}`} className="border-t border-line"><td className="p-2"><span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: P_COLOR[c.provider] }} />{c.campaign_name || c.campaign_id}<span className="block text-[11px] text-ink-3">{c.label}</span></td>
              <td className="p-2 text-right tabular-nums">{n0(c.impressions)}</td><td className="p-2 text-right tabular-nums">{n0(c.clicks)} <span className="text-ink-3">({pct(c.clicks, c.impressions)})</span></td>
              <td className="p-2 text-right tabular-nums">{won(c.cost, c.currency)}</td><td className="p-2 text-right tabular-nums">{c.clicks ? won(c.cost / c.clicks, c.currency) : '—'}</td><td className="p-2 text-right tabular-nums">{n0(c.conversions)}</td></tr>))}
            {!data.campaigns.length && <tr><td colSpan={6} className="p-6 text-center text-ink-3">{data.accounts.length ? '이 기간 성과가 없습니다' : '광고 계정을 연결하면 매일 아침 성과가 들어옵니다'}</td></tr>}</tbody></table>
      </section>
      <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="ads-accounts">
        <div className="mb-2 flex items-center gap-2"><h2 className="text-sm font-semibold">연결된 광고 계정</h2>{data.canEdit && !!data.accounts.length && <Button size="sm" variant="secondary" className="ml-auto" onClick={sync} disabled={busy} data-testid="ads-sync">{busy ? '불러오는 중…' : '지금 다시 불러오기'}</Button>}</div>
        <ul className="divide-y divide-line text-sm">{data.accounts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="ads-account"><span className="size-2 rounded-full" style={{ background: P_COLOR[a.provider] }} /><span className="font-medium">{a.label}</span>
            <span className="text-xs text-ink-2">{data.providers.find((p) => p.key === a.provider)?.label} · {a.external_id}{a.brand ? ` · ${a.brand}` : ''} · {a.last_sync_at ? `읽은 시각 ${fmtDateTime(a.last_sync_at)}` : '아직 안 읽음'}</span>
            {a.status === 'error' && <span className="w-full text-xs text-red-700">읽기 실패: {a.last_error}</span>}
            {data.canEdit && <Button size="sm" variant="secondary" className="ml-auto" onClick={() => remove(a)}>연결 끊기</Button>}</li>))}
          {!data.accounts.length && <li className="py-2 text-xs text-ink-3">연결된 계정이 없습니다</li>}</ul>
        {data.canEdit ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setNaver(true)} data-testid="ads-add-naver">네이버 검색광고 연결</Button>
            {data.providers.filter((p) => p.key !== 'naver').map((p) => p.ready
              ? <a key={p.key} href={`/api/marketing/ads/connect/${p.key}`} className="inline-flex h-8 items-center rounded-input border border-line px-3 text-sm hover:bg-slate-50" data-testid={`ads-add-${p.key}`}>{p.label} 연결</a>
              : <span key={p.key} className="inline-flex h-8 items-center rounded-input border border-dashed border-line px-3 text-xs text-ink-3" title="워크인 앱 등록·심사 후 열립니다">{p.label} — 준비 중</span>)}
          </div>
        ) : <p className="mt-2 text-xs text-ink-3">광고 계정 연결은 관리자가 합니다.</p>}
        <p className="mt-2 text-[11px] text-ink-3">성과는 각 광고 플랫폼에서 직접 읽습니다(하루 한 번, 최근 7일을 다시 읽어 늦게 잡힌 전환까지 반영). 광고 예산·입찰을 바꾸는 기능은 없습니다.</p>
      </section>
      {naver && <NaverForm onClose={() => setNaver(false)} onDone={reload} />}
    </div>
  );
}
