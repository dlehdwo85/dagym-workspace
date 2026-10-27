'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { useSalesTerms } from '@/components/session';
import { HIDEABLE_STAGES, LEAD_STAGES, STAGE_LABEL_MAX, type SalesTerms, type StageCfg } from '@/lib/sales/terms';
import { BidPrefs, Collectors } from './Collectors';

type S = { code: string; name: string; provider: string; grp: string; category: string; refresh: string; enabled: boolean; common: boolean; keywords: string[]; regions: string[]; excludes: string[]; total: number; attribution: string; last_run_at: string | null };
type Sug = { rules: string[]; sources: string[]; keywords: string[]; regions: string[]; via: string; askKeywords: boolean; items: { code: string; name: string; why: string; common: boolean }[]; bids: { recommend: boolean; why: string } };
type Custom = { id: string; kind: 'site' | 'keyword' | 'excel'; label: string; value: string | null; note: string | null };
const KIND_LABEL: Record<Custom['kind'], string> = { site: '사이트', keyword: '키워드', excel: '엑셀' };
const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const csv = (s: string) => s.split(/[,，]/).map((x) => x.trim()).filter(Boolean);

/** V41 단계 3 데이터 설정: AI 자동 세팅(업태·종목·지역 → 원천·검색어 추천 → [이대로 켜기]) + 원천별 켜기·검색어·지역·제외어 */
export function Sources() {
  const T = useSalesTerms(); // #408 업종 템플릿 예시 문구
  const { data, error, reload } = useApi<{ sources: S[]; settings: { industry: string | null; region: string | null; setup_done_at?: string | null } | null; canEdit: boolean; profile?: { industry: string | null; business: string | null; customers: string | null }; custom?: Custom[] }>('/api/sales/sources');
  const [prod, setProd] = useState(''); const [pick, setPick] = useState<Record<string, boolean>>({}); const [bids, setBids] = useState(true);
  const [cs, setCs] = useState<{ kind: Custom['kind']; label: string; value: string }>({ kind: 'site', label: '', value: '' });
  const [ind, setInd] = useState(''); const [reg, setReg] = useState('');
  const [sug, setSug] = useState<Sug | null>(null); const [busy, setBusy] = useState(false); const [kw, setKw] = useState('');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Skeleton rows={6} />;
  const groups = [...new Set(data.sources.map((s) => s.grp))];
  async function suggest() {
    setBusy(true);
    try { const r = await api<Sug>('/api/sales/sources/suggest', { body: { industry: ind || data!.settings?.industry || data!.profile?.industry || data!.profile?.business || '', region: reg || data!.settings?.region || undefined, product: prod || undefined } }); setSug(r); setPick(Object.fromEntries(r.items.map((x) => [x.code, true]))); setBids(r.bids.recommend); setKw(r.keywords.join(', ')); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function apply() {
    const chosen = sug!.items.filter((x) => pick[x.code]).map((x) => x.code);
    if (!chosen.length) return toast.error('켤 출처를 하나 이상 고르세요');
    try { await api('/api/sales/sources/apply', { body: { sources: chosen, keywords: csv(kw), regions: sug!.regions, bids } }); toast.ok('추천대로 켰습니다 — 내일 아침부터 영업기회가 들어옵니다'); setSug(null); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function save(s: S, patch: Partial<{ enabled: boolean; keywords: string[]; regions: string[]; excludes: string[] }>) {
    try { await api(`/api/sales/sources/${s.code}`, { method: 'PUT', body: { enabled: s.enabled, ...patch } }); reload(); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="space-y-4" data-testid="sales-sources">
      <h1 className="text-xl font-bold text-[#2563EB]">데이터 설정</h1>
      <SalesOptions />
      <BizCats canEdit={data.canEdit} />
      <BidPrefs />
      <Collectors />
      {data.canEdit && (
        <section className="rounded-card border border-[#BFDBFE] bg-[#EFF6FF] p-4" data-testid="sales-ai-setup">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#1D4ED8]"><Sparkles className="size-4" />AI 자동 세팅</h2>
          <p className="mt-1 text-xs text-ink-2">사업자등록증의 업태·종목(또는 하는 일)과 영업 지역을 넣으면 맞는 공공데이터와 검색어를 골라 드립니다. 켜기 전에 고칠 수 있습니다.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
            <input className={inputCls} value={ind} onChange={(e) => setInd(e.target.value)} placeholder={data.settings?.industry ?? data.profile?.industry ?? T.examples.industry} aria-label="업태·종목" data-testid="sales-industry" />
            <input className={cx(inputCls, 'sm:col-span-3')} value={prod} onChange={(e) => setProd(e.target.value)} placeholder={T.examples.product} aria-label="주력 상품" data-testid="sales-product" />
            <select className={inputCls} value={reg} onChange={(e) => setReg(e.target.value)} aria-label="영업 지역"><option value="">{data.settings?.region ?? '전국'}</option>{SIDO.map((s) => <option key={s}>{s}</option>)}</select>
            <Button onClick={suggest} disabled={busy} data-testid="sales-suggest">{busy ? '고르는 중…' : '추천받기'}</Button>
          </div>
          {sug && (
            <div className="mt-3 space-y-2 rounded-input bg-white p-3 text-sm" data-testid="sales-suggestion">
              {sug.askKeywords ? <p className="text-xs text-amber-800">맞는 업종 규칙이 없어 공통 원천만 켭니다. 파는 것을 검색어 3개로 적어 주세요.</p> : <p className="text-xs text-ink-2">맞는 업종: {sug.rules.join(' · ')}</p>}
              {/* 로컬 10/19(대표): 추천마다 근거 한 줄 · 체크로 고름(모두 선택형) · 입찰·공고도 선택 */}
              <ul className="space-y-1" data-testid="sales-sug-items">{sug.items.map((x) => (
                <li key={x.code}><label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 size-4" checked={!!pick[x.code]} onChange={(e) => setPick({ ...pick, [x.code]: e.target.checked })} aria-label={`${x.name} 켜기`} data-testid="sales-sug-item" />
                  <span><span className="font-medium text-ink">{x.name}</span><span className="block text-ink-2" data-testid="sales-sug-why">{x.why}</span></span></label></li>))}
                <li><label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 size-4" checked={bids} onChange={(e) => setBids(e.target.checked)} aria-label="입찰·공고 쓰기" data-testid="sales-sug-bids" />
                  <span><span className="font-medium text-ink">입찰·공고(나라장터)</span><span className="block text-ink-2">{sug.bids.why}</span></span></label></li></ul>
              <Field label="검색어(쉼표로)"><input className={inputCls} value={kw} onChange={(e) => setKw(e.target.value)} data-testid="sales-keywords" /></Field>
              <p className="text-xs text-ink-2">지역: {sug.regions.join(', ') || '전국'}</p>
              <Button onClick={apply} data-testid="sales-apply">고른 것 켜기</Button>
            </div>
          )}
        </section>
      )}
      <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="sales-custom">
        <h2 className="text-sm font-semibold">직접 추가한 출처 <span className="font-normal text-ink-3">— 목록 밖 사이트·키워드·엑셀(자동으로 모으지는 않고 영업 출처로 기록)</span></h2>
        <ul className="mt-1 divide-y divide-line text-sm">{(data.custom ?? []).map((c) => (
          <li key={c.id} className="flex items-center gap-2 py-1.5" data-testid="sales-custom-row"><span className="rounded bg-slate-100 px-1.5 text-[11px] text-ink-2">{KIND_LABEL[c.kind]}</span>
            <span className="min-w-0 flex-1 truncate">{c.label}{c.value && (c.kind === 'site' ? <a href={c.value} target="_blank" rel="noopener" className="ml-1 text-xs text-[#2563EB] underline">열기</a> : <span className="ml-1 text-xs text-ink-3">{c.value}</span>)}</span>
            {data.canEdit && <button type="button" className="text-xs text-ink-3 hover:text-red-600" onClick={async () => { try { await api(`/api/sales/sources/custom/${c.id}`, { method: 'DELETE' }); reload(); } catch (e: any) { toast.error(e.message); } }} aria-label={`${c.label} 지우기`}>지우기</button>}</li>))}
          {!(data.custom ?? []).length && <li className="py-1.5 text-xs text-ink-3">아직 없습니다</li>}</ul>
        {data.canEdit && <form className="mt-2 grid gap-1.5 sm:grid-cols-[6rem_1fr_1fr_auto]" onSubmit={async (e) => { e.preventDefault(); try { await api('/api/sales/sources/custom', { body: { kind: cs.kind, label: cs.label, value: cs.value || undefined } }); setCs({ ...cs, label: '', value: '' }); reload(); } catch (er: any) { toast.error(er.message); } }}>
          <select className={inputCls} value={cs.kind} onChange={(e) => setCs({ ...cs, kind: e.target.value as Custom['kind'] })} aria-label="출처 종류"><option value="site">사이트</option><option value="keyword">키워드</option><option value="excel">엑셀</option></select>
          <input className={inputCls} value={cs.label} onChange={(e) => setCs({ ...cs, label: e.target.value })} placeholder="이름(예: 지역 상가 카페 목록)" aria-label="출처 이름" data-testid="sales-custom-label" />
          <input className={inputCls} value={cs.value} onChange={(e) => setCs({ ...cs, value: e.target.value })} placeholder={cs.kind === 'site' ? 'https://…' : cs.kind === 'keyword' ? '검색어' : '파일 이름·메모'} aria-label="출처 값" data-testid="sales-custom-value" />
          <Button type="submit" disabled={!cs.label.trim()} data-testid="sales-custom-add">추가</Button></form>}
      </section>
      {groups.map((g) => (
        <section key={g} className="rounded-card border border-line bg-white p-3 shadow-card">
          <h2 className="mb-2 text-sm font-semibold">{g}</h2>
          <ul className="divide-y divide-line">{data.sources.filter((s) => s.grp === g).map((s) => (
            <li key={s.code} className="py-2 text-sm" data-testid={`source-${s.code}`}>
              <div className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={s.enabled} disabled={!data.canEdit} onChange={(e) => save(s, { enabled: e.target.checked })} aria-label={`${s.name} 켜기`} />
                <span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span>{s.common && <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] text-ink-2">공통</span>}{(s as any).why && <span className="block text-[11px] text-ink-2">{(s as any).why}</span>}<span className="block text-[11px] text-ink-3">{s.provider} · {s.refresh} 갱신 · 모은 것 {s.total.toLocaleString('ko-KR')}건</span></span>
              </div>
              {/* 로컬 검수 10/17: [이대로 켜기] 뒤 다시 불러와도 칸이 옛 값(빈칸)으로 남던 것 → 값이 바뀌면 칸을 새로 그림 */}
              {s.enabled && data.canEdit && (
                <div className="mt-1.5 grid gap-1.5 pl-6 sm:grid-cols-3">
                  <input key={s.keywords.join(',')} className={cx(inputCls, 'h-8 py-1 text-xs')} defaultValue={s.keywords.join(', ')} placeholder="검색어(쉼표)" onBlur={(e) => save(s, { keywords: csv(e.target.value) })} aria-label={`${s.name} 검색어`} />
                  <input key={s.regions.join(',')} className={cx(inputCls, 'h-8 py-1 text-xs')} defaultValue={s.regions.join(', ')} placeholder="지역(예: 서울, 경기)" onBlur={(e) => save(s, { regions: csv(e.target.value) })} aria-label={`${s.name} 지역`} />
                  <input key={s.excludes.join(',')} className={cx(inputCls, 'h-8 py-1 text-xs')} defaultValue={s.excludes.join(', ')} placeholder="제외어(쉼표)" onBlur={(e) => save(s, { excludes: csv(e.target.value) })} aria-label={`${s.name} 제외어`} />
                </div>
              )}
            </li>))}</ul>
        </section>
      ))}
      <p className="text-[11px] text-ink-3">공공데이터는 워크인이 하루 한 번 모아 모든 회사가 같이 씁니다(출처: 각 기관, 공공데이터포털). 회사마다 다른 것은 켠 원천·검색어·지역과 진행 상태·메모뿐입니다. 광고성 문자·메일 일괄 발송 기능은 없습니다.</p>
    </div>
  );
}

/** 대표(10/19): 입찰·공고는 회사 선택 기능 — 끄면 입찰·공고 메뉴·카드·하단 탭(→ 제안·계약)·화면을 숨김
 *  #408(대표 10/21 영업 재편 6): 업종 템플릿 — 영업 화면 용어(허브 탭·타일·칸 이름·예시 문구)를 회사 업종에 맞춤. null = 회사 업종으로 자동 */
type Opts = { bids: boolean; bidsAuto: boolean; canEdit: boolean; template: { code: string; label: string; auto: boolean }; terms: SalesTerms; templates: { code: string; label: string; desc: string }[] };
function SalesOptions() {
  const { data, reload } = useApi<Opts>('/api/sales/options');
  if (!data) return null;
  async function set(v: boolean | null) {
    try { await api('/api/sales/options', { method: 'PUT', body: { bids: v } }); toast.ok(v === false ? '입찰·공고를 껐습니다 — 메뉴·카드·하단 탭에서 숨깁니다' : '입찰·공고를 켰습니다'); reload(); setTimeout(() => window.location.reload(), 600); }
    catch (e: any) { toast.error(e.message); }
  }
  async function setTemplate(code: string | null) {
    try { await api('/api/sales/options', { method: 'PUT', body: { template: code } }); toast.ok(code ? '업종 템플릿을 바꿨습니다 — 영업 화면 용어가 바뀝니다' : '회사 업종으로 자동 추정합니다'); reload(); setTimeout(() => window.location.reload(), 600); }
    catch (e: any) { toast.error(e.message); }
  }
  const t = data.terms;
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="sales-options">
      <h2 className="text-sm font-semibold">쓰는 기능</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">입찰·공고</span>
        <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-medium', data.bids ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-ink-3')} data-testid="sales-bids-state">{data.bids ? '사용 중' : '사용 안 함'}{data.bidsAuto ? ' (기본값)' : ''}</span>
        {data.canEdit && <Button size="sm" variant={data.bids ? 'secondary' : 'primary'} onClick={() => set(!data.bids)} data-testid="sales-bids-toggle">{data.bids ? '끄기' : '켜기'}</Button>}
      </div>
      <p className="mt-1 text-xs text-ink-2">입찰을 하지 않는 회사는 꺼 두세요. 입찰·공고 메뉴와 현황 카드가 사라지고, 휴대폰 하단 탭의 입찰·공고 자리는 &lsquo;제안·계약&rsquo;이 됩니다. 공용으로 모으는 공고 데이터는 다른 회사에 영향이 없습니다.</p>
      <div id="template" className="mt-3 border-t border-line pt-3" data-testid="sales-template">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">업종 템플릿</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-2" data-testid="sales-template-state">{data.template.label}{data.template.auto ? ' (업종으로 자동)' : ''}</span>
        </div>
        <p className="mt-1 text-xs text-ink-2">영업 화면의 메뉴·칸 이름·예시 문구를 업종에 맞춥니다. 회사 정보의 업종으로 자동 고르고, 여기서 직접 바꿀 수 있습니다.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">{data.templates.map((x) => (
          <button key={x.code} type="button" disabled={!data.canEdit} onClick={() => setTemplate(x.code)} title={x.desc} data-testid={`sales-template-${x.code}`} aria-pressed={x.code === data.template.code}
            className={cx('rounded-full border px-3 py-1 text-xs', x.code === data.template.code ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : 'border-line bg-white', !data.canEdit && 'cursor-default')}>{x.label}</button>))}
          {data.canEdit && !data.template.auto && <button type="button" onClick={() => setTemplate(null)} className="rounded-full border border-dashed border-line px-3 py-1 text-xs text-ink-2" data-testid="sales-template-auto">업종으로 자동</button>}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3" data-testid="sales-template-preview">미리보기: {t.buildingsTab} · {t.facilitiesTab} · {t.vendorsTab} / 칸 이름 {t.unitName}·{t.office}·{t.operator}</p>
      </div>
      <StageNames terms={t} canEdit={data.canEdit} />
    </section>
  );
}

/** 207차(#461, SALES_LEADS_REVAMP 2-3 '단계 = 칩(회사 설정 단계명·색)'): 리드 단계 이름·색·숨김. 저장 값은 그대로 — 화면 이름만 회사 말로.
 *  쓰지 않는 중간 단계는 숨김(고르는 칸에서만 빠지고 그 단계 거래처는 그대로 보임). 처음·종결 단계는 규칙(사유 필수·보관함)이 있어 이름·색만 */
function StageNames({ terms, canEdit }: { terms: SalesTerms; canEdit: boolean }) {
  const [rows, setRows] = useState<StageCfg | null>(null); const [busy, setBusy] = useState(false);
  const cfg = rows ?? terms.stages;
  const set = (k: string, patch: Partial<StageCfg[string]>) => setRows({ ...cfg, [k]: { ...cfg[k], ...patch } });
  async function save(reset = false) {
    setBusy(true);
    try {
      await api('/api/sales/options', { method: 'PUT', body: { stages: reset ? null : Object.fromEntries(LEAD_STAGES.map((k) => [k, { label: cfg[k].label.trim(), color: cfg[k].color, hidden: cfg[k].hidden }])) } });
      toast.ok(reset ? '단계 이름을 기본으로 되돌렸습니다' : '단계 이름을 저장했습니다 — 영업 화면에 바로 보입니다'); setTimeout(() => window.location.reload(), 600);
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div id="stages" className="mt-3 border-t border-line pt-3" data-testid="sales-stage-names">
      <div className="text-sm font-medium">리드 단계 이름</div>
      <p className="mt-1 text-xs text-ink-2">영업 진행의 단계 이름·색을 우리 회사 말로 바꿉니다. 쓰지 않는 중간 단계는 숨길 수 있습니다(그 단계에 있는 거래처는 그대로 보입니다). 처음·종결 단계는 규칙(사유 필수·보관함)이 있어 이름·색만 바꿉니다.</p>
      <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{LEAD_STAGES.map((k) => { const c = cfg[k]; return (
        <li key={k} className="grid grid-cols-[2.25rem_minmax(0,1fr)_6.5rem] items-center gap-1.5" data-testid="sales-stage-row" data-stage={k}>
          <input type="color" className="h-8 w-9 cursor-pointer rounded border border-line" value={c.color ?? '#1D4ED8'} onChange={(e) => set(k, { color: e.target.value })} aria-label={`${k} 색`} disabled={!canEdit} />
          <div className="min-w-0"><input className={cx(inputCls, 'h-8 py-1')} value={c.label} onChange={(e) => set(k, { label: e.target.value })} maxLength={STAGE_LABEL_MAX} aria-label={`${k} 이름`} disabled={!canEdit} data-testid="sales-stage-label" />
            {c.label.trim() !== k && <p className="mt-0.5 truncate text-[10px] text-ink-3">원래 이름: {k}</p>}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {HIDEABLE_STAGES.has(k) && <label className="inline-flex items-center gap-1"><input type="checkbox" checked={c.hidden} onChange={(e) => set(k, { hidden: e.target.checked })} disabled={!canEdit} data-testid="sales-stage-hide" />숨김</label>}
            {c.color && canEdit && <button type="button" className="text-[11px] text-ink-3 underline" onClick={() => set(k, { color: null })}>기본 색</button>}</div>
        </li>); })}</ul>
      {canEdit && <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => save()} disabled={busy || rows === null} data-testid="sales-stage-save">{busy ? '저장 중…' : '저장'}</Button>
        <Button variant="secondary" onClick={() => save(true)} disabled={busy} data-testid="sales-stage-reset">기본 이름으로</Button></div>}
    </div>
  );
}

/** 대표 10/21 12:00 영업 재편 4): 회사 관심 사업(카테고리) — 공고 사업별 탭·필터·적합 배지의 근거. 이름·색·검색어 모두 회사가 정함(코드에 회사 이름 없음) */
type Biz = { key?: string; name: string; color: string; keywords: string[]; active: boolean };
function BizCats({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useApi<{ items: Biz[] }>('/api/sales/business-categories');
  const [rows, setRows] = useState<Biz[] | null>(null); const [busy, setBusy] = useState(false);
  const list = rows ?? data?.items ?? [];
  const set = (i: number, patch: Partial<Biz>) => setRows(list.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  async function save() {
    setBusy(true);
    try { await api('/api/sales/business-categories', { method: 'PUT', body: { items: list.filter((r) => r.name.trim()).map((r) => ({ key: r.key, name: r.name.trim(), color: r.color, keywords: r.keywords, active: r.active })) } }); toast.ok('관심 사업을 저장했습니다 — 공고 사업 탭·배지에 바로 반영됩니다'); setRows(null); reload(); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <section id="biz" className="rounded-card border border-line bg-white p-4" data-testid="sales-bizcats">
      <h2 className="text-sm font-semibold">관심 사업(카테고리)</h2>
      <p className="mt-1 text-xs text-ink-2">우리 회사가 하는 사업을 적어 두면 입찰·공고를 사업별 탭으로 나누고, 공고마다 맞는 사업 배지를 붙입니다. 검색어는 공고의 사업 칸·제목·대상 이름·분류에서 찾습니다(쉼표로 구분).</p>
      {!data ? <Skeleton rows={2} /> : <ul className="mt-2 space-y-1.5">{list.map((r, i) => (
        <li key={r.key ?? `n${i}`} className="grid gap-1.5 sm:grid-cols-[2.25rem_10rem_1fr_auto] sm:items-center" data-testid="sales-bizcat">
          <input type="color" className="h-8 w-9 cursor-pointer rounded border border-line" value={r.color} onChange={(e) => set(i, { color: e.target.value })} aria-label="색" disabled={!canEdit} />
          <input className={inputCls} value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="사업 이름" aria-label="사업 이름" maxLength={40} disabled={!canEdit} data-testid="sales-bizcat-name" />
          <input className={inputCls} value={r.keywords.join(', ')} onChange={(e) => set(i, { keywords: csv(e.target.value) })} placeholder="검색어(쉼표) 예: 커뮤니티, 위탁운영" aria-label="검색어" disabled={!canEdit} data-testid="sales-bizcat-keywords" />
          <div className="flex items-center gap-2 text-xs"><label className="inline-flex items-center gap-1"><input type="checkbox" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} disabled={!canEdit} />쓰기</label>
            {canEdit && <button type="button" className="text-ink-3 underline" onClick={() => setRows(list.filter((_, n) => n !== i))}>빼기</button>}</div>
        </li>))}
        {!list.length && <li className="text-xs text-ink-3">아직 없습니다 — 사업을 하나 이상 적어 두세요.</li>}</ul>}
      {canEdit && <div className="mt-2 flex gap-2"><Button variant="secondary" onClick={() => setRows([...list, { name: '', color: '#2563EB', keywords: [], active: true }])} data-testid="sales-bizcat-add">사업 추가</Button>
        <Button onClick={save} disabled={busy || rows === null} data-testid="sales-bizcat-save">{busy ? '저장 중…' : '저장'}</Button></div>}
    </section>
  );
}
