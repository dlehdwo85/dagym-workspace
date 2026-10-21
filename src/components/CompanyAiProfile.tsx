'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Field, cx, inputCls, toast } from '@/components/ui';
import { uploadToLibrary } from '@/components/libraryUpload';
import { useSalesTerms } from '@/components/session';

type F = 'business' | 'customers' | 'tone' | 'cautions';
type P = { name: string; industry: string | null; industries: string[]; business: string | null; customers: string | null; tone: string | null; cautions: string | null; industryOptions: string[] };
const LABEL: Record<F, string> = { business: '사업 소개·방향', customers: '주요 고객', tone: '말투', cautions: '주의할 점(금지어·과장 금지·업종 광고 규정)' };

/**
 * AI 비서가 알아야 할 우리 회사 + 오른쪽 'AI 로 정리' 도우미(로컬 10/19 대표).
 * 같은 내용을 AI 비서·메일/문자 시안·마케팅 브랜드 키트·영업 제안서가 함께 씀(한 번 정리하면 전부 반영). 저장은 [저장]을 눌러야만.
 */
export function CompanyAiProfile({ compact = false }: { compact?: boolean }) {
  const st = useApi<P>('/api/org/ai-profile');
  const [f, setF] = useState<Partial<P> | null>(null);
  const [busy, setBusy] = useState(false);
  if (!st.data) return null;
  const v = { ...st.data, ...(f ?? {}) };
  const save = async () => {
    setBusy(true);
    try { await api('/api/org/ai-profile', { method: 'PUT', body: { industries: v.industries ?? [], business: v.business ?? null, customers: v.customers ?? null, tone: v.tone ?? null, cautions: v.cautions ?? null } }); setF(null); st.reload(); toast.ok('회사 정보를 저장했습니다 — AI 비서·메일 시안·마케팅·영업 제안서에 함께 반영됩니다'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = (k: F, x: string) => setF({ ...(f ?? {}), [k]: x });
  return (
    <div className={cx('grid gap-3', !compact && 'lg:grid-cols-[1fr_22rem]')} data-testid="ai-profile">
      <div className="space-y-3 rounded-card border border-line bg-white p-4 text-sm shadow-card">
        <div><p className="font-semibold">AI 비서가 알아야 할 우리 회사</p>
          <p className="mt-0.5 text-xs text-ink-2">AI 비서 답·메일·문자 시안·마케팅 원고·영업 제안서가 이 내용에 맞춰 작성됩니다. 우리 회사 정보만 쓰고 다른 회사 내용은 섞이지 않습니다.</p></div>
        {/* 대표 10/20 10:50: 업종 여러 개(소프트웨어 + 시설 위탁운영 같은 회사) — 칩 토글, 첫 번째가 주 업종 */}
        <div><p className="mb-1 text-sm font-medium text-ink-2">업종 <span className="text-xs font-normal text-ink-3">(여러 개 가능 · 첫 번째가 주 업종)</span></p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="업종" data-testid="ai-industry">
            {st.data.industryOptions.map((x) => { const on = (v.industries ?? []).includes(x); return (
              <button key={x} type="button" aria-pressed={on} onClick={() => setF({ ...(f ?? {}), industries: on ? (v.industries ?? []).filter((y) => y !== x) : [...(v.industries ?? []), x] })}
                className={cx('rounded-full border px-2.5 py-1 text-xs', on ? 'border-transparent bg-brand-600 font-semibold text-white' : 'border-line bg-white hover:bg-slate-50')} data-testid="ai-industry-chip">{x}{on && (v.industries ?? [])[0] === x ? ' · 주' : ''}</button>); })}
          </div></div>
        <Field label={LABEL.business}><textarea className={cx(inputCls, 'min-h-20')} maxLength={1000} value={v.business ?? ''} onChange={(e) => set('business', e.target.value)}
          placeholder="예: 강남·분당에서 PT 전문 센터 3곳 운영. 1:1 맞춤 관리와 재등록 상담을 중요하게 생각합니다." data-testid="ai-business" /></Field>
        <Field label={LABEL.customers}><input className={inputCls} maxLength={500} value={v.customers ?? ''} onChange={(e) => set('customers', e.target.value)} placeholder="예: 30~50대 직장인 회원, 기업 복지 담당자" data-testid="ai-customers" /></Field>
        <Field label={LABEL.tone}><input className={inputCls} maxLength={500} value={v.tone ?? ''} onChange={(e) => set('tone', e.target.value)} placeholder="예: 친근하지만 정중하게" data-testid="ai-tone" /></Field>
        <Field label={LABEL.cautions}><input className={inputCls} maxLength={500} value={v.cautions ?? ''} onChange={(e) => set('cautions', e.target.value)} placeholder="예: '100% 효과' 같은 단정 금지, 할인 약속 금지" data-testid="ai-cautions" /></Field>
        <Button size="sm" disabled={busy || !f} onClick={save} data-testid="ai-profile-save">저장</Button>
      </div>
      <AiHelper values={v} onApply={set} />
    </div>
  );
}

/** 'AI 로 정리': 글·홈페이지·회사소개서 또는 [질문으로 시작](5문항) → 칸별 초안 · 원래 값과 비교 · [적용]/[다시 쓰기] */
function AiHelper({ values, onApply }: { values: Partial<Record<F, string | null>>; onApply: (k: F, v: string) => void }) {
  const T = useSalesTerms(); // #408 업종 템플릿 예시 문구
  const [text, setText] = useState(''); const [url, setUrl] = useState(''); const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [qs, setQs] = useState<string[] | null>(null); const [ans, setAns] = useState<string[]>(['', '', '', '', '']);
  const [draft, setDraft] = useState<Partial<Record<F, string>> | null>(null); const [busy, setBusy] = useState<F | 'all' | null>(null);
  const input = () => ({ text: text.trim() || undefined, url: url.trim() || undefined, fileId: file?.id, answers: qs ? ans : undefined });
  async function run(field?: F) {
    setBusy(field ?? 'all');
    try { const r = await api<{ draft: Partial<Record<F, string>> }>('/api/org/ai-profile/draft', { body: { ...input(), field } }); setDraft((d) => ({ ...(field ? d : {}), ...r.draft })); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  }
  return (
    <aside className="space-y-2 rounded-card border border-violet-200 bg-violet-50/40 p-4 text-sm shadow-card" data-testid="ai-helper">
      <p className="flex items-center gap-1.5 font-semibold"><Sparkles className="size-4 text-violet-600" />AI 로 정리</p>
      <p className="text-xs text-ink-2">생각나는 대로 적거나 홈페이지·회사소개서를 넣으면 칸별 초안을 만듭니다. 잘 모르겠으면 [질문으로 시작].</p>
      <textarea className={cx(inputCls, 'min-h-20')} maxLength={6000} value={text} onChange={(e) => setText(e.target.value)} placeholder={T.examples.aiProfile} aria-label="회사 설명" data-testid="ai-helper-text" />
      <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="홈페이지 주소 https://…" aria-label="홈페이지 주소" data-testid="ai-helper-url" />
      <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2"><span className="rounded-input border border-line bg-white px-2 py-1">회사소개서 파일</span>{file ? file.name : 'PDF·워드·한글·텍스트'}
        <input type="file" className="hidden" accept=".pdf,.doc,.docx,.hwp,.hwpx,.txt,.md" onChange={async (e) => { const x = e.target.files?.[0]; if (!x) return; try { setFile(await uploadToLibrary(x, '회사 소개', undefined, ['회사 소개'])); } catch (er: any) { toast.error(er.message); } }} data-testid="ai-helper-file" /></label>
      {qs && <ol className="space-y-1.5" data-testid="ai-helper-questions">{qs.map((q, k) => <li key={q}><label className="block text-xs font-medium">{k + 1}. {q}<input className={cx(inputCls, 'mt-0.5')} value={ans[k]} onChange={(e) => setAns(ans.map((a, j) => (j === k ? e.target.value : a)))} data-testid="ai-helper-answer" /></label></li>)}</ol>}
      {/* 대표 10/20 10:50: [질문으로 시작]·[초안 만들기]가 붙어 보임 → 한 줄 flex + 간격(휴대폰은 줄 바꿈) */}
      <div className="flex flex-wrap items-center gap-3" data-testid="ai-helper-actions">
        <Button size="sm" disabled={!!busy} onClick={() => run()} data-testid="ai-helper-run">{busy === 'all' ? '정리하는 중…' : '초안 만들기'}</Button>
        {!qs && <button type="button" className="text-xs font-medium text-violet-700 underline" onClick={async () => { try { setQs((await api<{ questions: string[] }>('/api/org/ai-profile/draft')).questions); } catch (e: any) { toast.error(e.message); } }} data-testid="ai-helper-interview">질문으로 시작</button>}
      </div>
      {draft && (Object.keys(LABEL) as F[]).filter((k) => draft[k] !== undefined).map((k) => (
        <div key={k} className="rounded-input border border-line bg-white p-2 text-xs" data-testid={`ai-draft-${k}`}>
          <p className="font-semibold">{LABEL[k]}</p>
          <p className="mt-1 text-ink-3"><span className="mr-1 rounded bg-slate-100 px-1">지금</span>{values[k] || '(비어 있음)'}</p>
          <p className="mt-1 whitespace-pre-wrap"><span className="mr-1 rounded bg-violet-100 px-1 text-violet-800">초안</span>{draft[k] || '(만들 내용이 없음)'}</p>
          <div className="mt-1.5 flex gap-1.5"><Button size="sm" disabled={!draft[k]} onClick={() => { onApply(k, draft[k]!); toast.ok(`${LABEL[k].split('(')[0]} 칸에 넣었습니다 — [저장]을 눌러야 반영됩니다`); }} data-testid={`ai-apply-${k}`}>적용</Button>
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run(k)} data-testid={`ai-rewrite-${k}`}>{busy === k ? '쓰는 중…' : '다시 쓰기'}</Button></div>
        </div>))}
    </aside>
  );
}
