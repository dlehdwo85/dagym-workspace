'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type S = { vendorPages: { company: string; url: string; register_url?: string | null }[]; vendorPagesUpdatedAt: string | null; endpoints: Record<string, string>; endpointOverrides: Record<string, string>; defaultEndpoints: Record<string, string> };
const EP_LABEL: Record<string, string> = { lh_bid: 'LH 입찰공고', lh_prespec: 'LH 사전규격', d2b_bid: '방위사업청(국방전자조달) 입찰', onbid_lease: '온비드 임대 공고', nuri_bid_servc: '누리장터 민간입찰 용역', nuri_bid_thng: '누리장터 민간입찰 물품' };
/** 한 줄 = "회사명 | https://감시주소 | https://등록신청주소(선택)" (탭·쉼표도 허용) */
export function parsePages(text: string): { company: string; url: string; registerUrl: string | null }[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l): { company: string; url: string; registerUrl: string | null } | null => { const m = l.match(/^(.*?)\s*[|,\t]\s*(https?:\/\/\S+)(?:\s*[|,\t]\s*(https?:\/\/\S+))?\s*$/) ?? l.match(/^()(https?:\/\/\S+)$/); if (!m) return null; const url = m[2]; const company = m[1].trim() || (() => { try { return new URL(url).hostname; } catch { return url; } })(); return { company, url, registerUrl: m[3] ?? null }; }).filter((p): p is { company: string; url: string; registerUrl: string | null } => !!p);
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
      <h2 className="text-sm font-semibold">영업 수집기 설정(12개 수집기 공통)</h2>
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
    </section>
  );
}
