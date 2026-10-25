'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { PortalApplyLink, portalService, portalUrl } from './PortalApply';

type KeyS = { present: boolean; from: 'settings' | 'env' | null; hint: string | null };
type S = { vendorPages: { company: string; url: string; register_url?: string | null }[]; vendorPagesUpdatedAt: string | null; endpoints: Record<string, string>; endpointOverrides: Record<string, string>; defaultEndpoints: Record<string, string>;
  supportKeys: { bizinfo: KeyS; datago: KeyS; updatedAt: string | null }; supportWatchPages: { name: string; url: string; region?: string | null }[]; supportWatchPagesUpdatedAt: string | null;
  supportRuns: { slug: string; status: string; started_at: string; summary: string | null }[] };
const EP_LABEL: Record<string, string> = { lh_bid: 'LH 입찰공고', lh_prespec: 'LH 사전규격', d2b_bid: '방위사업청(국방전자조달) 입찰', onbid_lease: '온비드 임대 공고', nuri_bid_servc: '누리장터 민간입찰 용역', nuri_bid_thng: '누리장터 민간입찰 물품', bizinfo_support: '지원사업 · 기업마당', bizinfo_datago_support: '지원사업 · 기업마당(공공데이터포털)', kstartup_support: '지원사업 · K-Startup' };
/** 한 줄 = "회사명 | https://감시주소 | https://등록신청주소(선택)" (탭·쉼표도 허용) */
export function parsePages(text: string): { company: string; url: string; registerUrl: string | null }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l): { company: string; url: string; registerUrl: string | null } | null => { const m = l.match(/^(.*?)\s*[|,\t]\s*(https?:\/\/\S+)(?:\s*[|,\t]\s*(https?:\/\/\S+))?\s*$/) ?? l.match(/^()(https?:\/\/\S+)$/); if (!m) return null; const url = m[2]; const company = m[1].trim() || (() => { try { return new URL(url).hostname; } catch { return url; } })(); return { company, url, registerUrl: m[3] ?? null }; }).filter((p): p is { company: string; url: string; registerUrl: string | null } => !!p);
}
/** #450 지원사업 감시 페이지 한 줄 = "이름 | https://게시판 주소 | 시·도(선택)" */
export function parseSupportPages(text: string): { name: string; url: string; region: string | null }[] {
  type P = { name: string; url: string; region: string | null };
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l): P | null => { const m = l.match(/^(.*?)\s*[|,\t]\s*(https?:\/\/\S+?)(?:\s*[|,\t]\s*([가-힣]{2,4}))?\s*$/) ?? l.match(/^()(https?:\/\/\S+)$/); if (!m) return null;
    const name = m[1].trim() || (() => { try { return new URL(m[2]).hostname; } catch { return m[2]; } })(); return { name, url: m[2], region: m[3] ?? null }; }).filter((p): p is P => !!p);
}
const KEY_FROM: Record<string, string> = { settings: '여기 입력', env: '환경 변수' };
const RUN_LABEL: Record<string, string> = { bizinfo_support: '기업마당', kstartup_support: 'K-Startup', support_watch: '감시 페이지' };
/** #450 지원사업 원천 — 기업마당 인증키·공공데이터포털 인증키(K-Startup·기업마당 데이터)·감시 페이지. 키 값은 다시 보여 주지 않음(앞 4자만) */
function SupportSources({ data, reload }: { data: S; reload: () => void }) {
  const [biz, setBiz] = useState(''); const [dg, setDg] = useState(''); const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState(''); const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setPages(data.supportWatchPages.map((p) => `${p.name} | ${p.url}${p.region ? ` | ${p.region}` : ''}`).join('\n')); }, [data, dirty]);
  const parsed = parseSupportPages(pages);
  async function put(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    try { await api('/api/platform/sales-collectors', { method: 'PUT', body }); toast.ok(msg); setBiz(''); setDg(''); setDirty(false); reload(); } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  const K = ({ k, label }: { k: 'bizinfo' | 'datago'; label: string }) => { const st = data.supportKeys[k]; return <span className={cx('rounded-full px-2 py-0.5 text-[11px]', st.present ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')} data-testid={`support-key-${k}`}>{label}: {st.present ? `있음(${KEY_FROM[st.from ?? ''] ?? ''} · ${st.hint})` : '입력 필요'}</span>; };
  return (
    <div className="mt-4 border-t border-line pt-3" data-testid="platform-support-sources">
      <h3 className="text-sm font-semibold">지원사업 원천(영업실 ‘지원사업’)</h3>
      <p className="mt-1 text-xs text-ink-2">기업마당 인증키는 기업마당 ‘정책정보 개방 › 지원사업정보 API’ 아래 ‘API 사용 신청’에서 바로 발급됩니다. 공공데이터포털 인증키는 K-Startup 사업공고(15125364)·기업마당 데이터(15157820)를 각각 활용신청한 키 — 비우면 영업 수집기와 같은 DATA_GO_KR_SERVICE_KEY 를 씁니다. 키는 암호화해 저장하고 다시 보여 주지 않습니다.</p>
      <div className="mt-2 flex flex-wrap gap-1.5"><K k="bizinfo" label="기업마당" /><K k="datago" label="공공데이터포털" /></div>
      {data.supportRuns.some((r) => portalService(r.summary)) && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900" data-testid="support-apply-needed">
        공공데이터포털 활용신청 필요(서비스 <a className="font-semibold underline" href={portalUrl('15157820')} target="_blank" rel="noreferrer">15157820</a> / <a className="font-semibold underline" href={portalUrl('15125364')} target="_blank" rel="noreferrer">15125364</a>) — 키는 그대로 두고 포털에서 [활용신청]. 신청이 승인되면 영업실 › 수집기 [지금 수집]으로 다시 확인하세요.</p>}
      {data.supportRuns.length > 0 && <ul className="mt-1.5 space-y-0.5 text-xs" data-testid="support-last-runs">{data.supportRuns.map((r) => (
        <li key={r.slug} className={cx(portalService(r.summary) ? 'text-amber-900' : r.status === 'failed' ? 'text-red-700' : 'text-ink-2')} data-testid={`support-last-run-${r.slug}`}>
          최근 수집 · {RUN_LABEL[r.slug] ?? r.slug} {fmtDateTime(r.started_at)} — {r.summary ?? r.status}<PortalApplyLink summary={r.summary} /></li>))}</ul>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs"><span className="text-ink-2">기업마당 인증키(crtfcKey)</span><input type="password" autoComplete="off" className={cx(inputCls, 'mt-0.5 h-8 py-0.5 text-xs')} value={biz} onChange={(e) => setBiz(e.target.value)} placeholder={data.supportKeys.bizinfo.present ? '새 키로 바꿀 때만 입력' : '발급받은 키'} aria-label="기업마당 인증키" data-testid="support-key-bizinfo-input" /></label>
        <label className="text-xs"><span className="text-ink-2">공공데이터포털 인증키(선택)</span><input type="password" autoComplete="off" className={cx(inputCls, 'mt-0.5 h-8 py-0.5 text-xs')} value={dg} onChange={(e) => setDg(e.target.value)} placeholder="비우면 DATA_GO_KR_SERVICE_KEY" aria-label="공공데이터포털 인증키" /></label>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy || (!biz.trim() && !dg.trim())} onClick={() => put({ supportKeys: { ...(biz.trim() ? { bizinfo: biz.trim() } : {}), ...(dg.trim() ? { datago: dg.trim() } : {}) } }, '인증키를 저장했습니다 — 다음 수집(08·14시) 또는 [지금 수집]부터')} data-testid="support-key-save">키 저장</Button>
        {data.supportKeys.bizinfo.from === 'settings' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => put({ supportKeys: { bizinfo: null } }, '기업마당 키를 지웠습니다')}>기업마당 키 지우기</Button>}
        {data.supportKeys.datago.from === 'settings' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => put({ supportKeys: { datago: null } }, '공공데이터포털 키를 지웠습니다(환경 변수로)')}>포털 키 지우기</Button>}
      </div>
      <label className="mt-3 block text-xs"><span className="text-ink-2">지원사업 감시 페이지(지자체·지역지식재산센터·진흥원 공지 게시판) — 한 줄에 하나 <code>이름 | https://게시판 주소 | 시·도(선택)</code>. 로그인 없이 공개된 게시판만, 자동 수집을 막는 이용약관이 있으면 넣지 않습니다.</span>
        <textarea className={cx(inputCls, 'mt-1 h-24 font-mono text-xs')} value={pages} onChange={(e) => { setPages(e.target.value); setDirty(true); }} placeholder={'○○시 산업진흥원 | https://example.or.kr/notice/list | 경기'} aria-label="지원사업 감시 페이지" data-testid="support-watch-pages" /></label>
      <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">인식 {parsed.length}곳{data.supportWatchPagesUpdatedAt && <> · 마지막 저장 {fmtDateTime(data.supportWatchPagesUpdatedAt)}</>}
        <Button size="sm" variant="secondary" className="ml-auto" disabled={busy || !dirty} onClick={() => put({ supportWatchPages: parsed }, `감시 페이지 ${parsed.length}곳을 저장했습니다`)} data-testid="support-watch-save">감시 페이지 저장</Button></div>
    </div>
  );
}
/** 로컬 10/21 10:40: 플랫폼 운영자 — 협력사 모집 감시 페이지(21곳)·LH/국방/온비드 엔드포인트를 DB 없이 입력 */
export function PlatformCollectorSettings() {
  const { data, error, reload } = useApi<S>('/api/platform/sales-collectors');
  const [pages, setPages] = useState(''); const [ep, setEp] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data && !dirty) { setPages(data.vendorPages.map((p) => `${p.company} | ${p.url}${p.register_url ? ` | ${p.register_url}` : ''}`).join('\n')); setEp({ ...data.endpointOverrides }); } }, [data, dirty]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={2} />;
  const parsed = parsePages(pages); const bad = pages.split(/\r?\n/).filter((l) => l.trim()).length - parsed.length;
  async function save() {
    setBusy(true);
    try { await api('/api/platform/sales-collectors', { method: 'PUT', body: { vendorPages: parsed, endpoints: Object.fromEntries(Object.keys(data!.defaultEndpoints).map((k) => [k, (ep[k] ?? '').trim()])) } }); toast.ok(`저장했습니다 — 감시 페이지 ${parsed.length}곳`); setDirty(false); reload(); }
    catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-collector-settings">
      <h2 className="text-sm font-semibold">공고 수집기 설정(입찰·영업 자료·지원사업 공통)</h2>
      <p className="mt-1 text-xs text-ink-2">협력사 모집 감시 페이지는 한 줄에 하나 — <code>회사명 | https://감시 주소 | https://등록 신청 주소(선택)</code>. 등록 신청 주소는 공고 상세의 ‘등록 신청’ 링크로 쓰입니다. 시공사·시행사 공지(로그인 없이 보이는 페이지)만. 저장하면 다음 07시 실행(또는 데이터 설정 › 자동 수집 [지금 수집])부터 돕니다.{data.vendorPagesUpdatedAt && <> 마지막 저장 {fmtDateTime(data.vendorPagesUpdatedAt)}.</>}</p>
      <textarea className={cx(inputCls, 'mt-2 h-40 font-mono text-xs')} value={pages} onChange={(e) => { setPages(e.target.value); setDirty(true); }} placeholder={'SK에코플랜트 | https://withus.skecoplant.com/mainNotiList.do | https://withus.skecoplant.com/splogin.jsp\n우미건설 | https://b2b.woomi.co.kr/permit/anncBrdList'} aria-label="협력사 감시 페이지 목록" data-testid="vendor-pages" />
      <div className="mt-1 text-xs text-ink-3">인식 {parsed.length}곳{bad > 0 && <span className="text-red-600"> · 형식이 맞지 않는 줄 {bad}개(저장에서 빠짐)</span>}</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {Object.keys(data.defaultEndpoints).map((k) => (
          <label key={k} className="text-xs"><span className="text-ink-2">{EP_LABEL[k] ?? k} 호출 주소</span>
            <input className={cx(inputCls, 'mt-0.5 h-7 py-0.5 text-xs')} value={ep[k] ?? ''} onChange={(e) => { setEp((x) => ({ ...x, [k]: e.target.value })); setDirty(true); }} placeholder={`기본: ${data.defaultEndpoints[k]}`} aria-label={`${EP_LABEL[k] ?? k} 호출 주소`} />
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-3">비워 두면 기본 주소(추정). 실행 이력에 “주소 확인 필요”가 뜨면 그 서비스가 없거나 폐기된 것 — 공공데이터포털에서 현재 서비스 주소를 찾아 여기 넣습니다. “활용신청 필요”는 주소는 맞고 활용신청이 안 된 것.</p>
      <div className="mt-2"><Button size="sm" disabled={busy} onClick={save} data-testid="collector-settings-save">저장</Button></div>
      <SupportSources data={data} reload={reload} />
    </section>
  );
}
