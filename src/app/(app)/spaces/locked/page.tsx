'use client';
// #1139(대표 11/24 '업무관리는 별도의 상담 없이, 영업·마케팅은 문의 → 상담 후 사용(잠금 표기)'): 잠긴 공간 안내 + [상담 신청]
// 금액은 쓰지 않음(요금은 상담에서) · 회사 관리자만 신청(같은 공간 중복 신청 없음) · 직원은 관리자에게 요청하라는 안내
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Lock, CheckCircle2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Field, Skeleton, cx, inputCls, toast } from '@/components/ui';

type View = { locked: ('sales' | 'marketing')[]; canRequest: boolean; free: boolean; requested: { id: string; spaces: string[]; at: string; by: string | null }[]; contact: { name: string; email: string; phone: string } | null };
const INFO: Record<'sales' | 'marketing', { label: string; lines: string[] }> = {
  sales: { label: '영업', lines: ['입찰·지원사업 공고를 모아 보고, 우리 회사에 맞는 공고를 골라 업무로 넘깁니다', '리드·거래처·상담 기록과 다음 연락일을 한곳에서 관리합니다', '입찰 마감·현장설명회 일정이 업무와 함께 캘린더에 들어갑니다', '계약 기간이 끝나기 전에 재계약 준비 업무가 생깁니다'] },
  marketing: { label: '마케팅', lines: ['게시물·광고 문구 초안을 만들고 승인함에서 확인한 뒤 내보냅니다', '채널별 일정과 승인 대기 건을 한 화면에서 봅니다', '성과(조회·반응·문의)를 사업별로 모아 봅니다'] },
};
const md = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };

export default function Page() { return <Suspense fallback={<div className="p-6"><Skeleton rows={6} /></div>}><LockedSpacePage /></Suspense>; }
function LockedSpacePage() {
  const sp = useSearchParams();
  const first = sp.get('space') === 'marketing' ? 'marketing' : 'sales';
  const { data, error, reload } = useApi<View>('/api/spaces/consult');
  const [pick, setPick] = useState<string[]>([first]);
  const [f, setF] = useState({ name: '', phone: '', email: '', memo: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data?.contact) setF((x) => ({ ...x, name: x.name || data.contact!.name, email: x.email || data.contact!.email, phone: x.phone || data.contact!.phone })); }, [data]);
  useEffect(() => { if (data) setPick((p) => p.filter((x) => (data.locked as string[]).includes(x))); }, [data]);
  if (error) return <div className="p-6 text-sm text-red-700">안내를 불러오지 못했습니다 — {error.message}</div>;
  if (!data) return <div className="p-6"><Skeleton rows={6} /></div>;
  const locked = data.locked;
  const pending = (s: string) => data.requested.find((r) => r.spaces.includes(s));
  const open = !locked.includes(first);
  async function send() {
    setBusy(true);
    try {
      const r = await api<{ already: boolean; at: string }>('/api/spaces/consult', { body: { spaces: pick, ...f } });
      toast.ok(r.already ? `이미 상담을 신청했습니다(${md(r.at)}) — 담당자가 곧 연락드립니다` : '상담 신청을 보냈습니다 — 담당자가 연락드립니다');
      reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6" data-testid="space-locked-page">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold"><Lock className="size-5 text-ink-3" aria-hidden />영업·마케팅은 상담 후 사용합니다</h1>
        <p className="mt-1 text-sm text-ink-2">업무·일정·결재·메신저·자료실은 지금 바로 쓰실 수 있습니다. 영업·마케팅은 회사 상황을 듣고 설정을 함께 맞춘 뒤 열어 드립니다.</p>
      </div>
      {open ? <p className="rounded-input border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="space-locked-open">{INFO[first].label} 공간은 이미 열려 있습니다. <Link className="underline" href={`/s/${first}`}>{INFO[first].label}으로 가기</Link></p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {(['sales', 'marketing'] as const).map((s) => (
          <section key={s} className={cx('rounded-card border p-4', s === first ? 'border-slate-300' : 'border-line')} data-testid={`space-locked-info-${s}`}>
            <h2 className="flex items-center gap-1.5 text-base font-semibold">{INFO[s].label}{locked.includes(s) ? <span className="inline-flex items-center gap-1 text-xs font-normal text-ink-3"><Lock className="size-3" aria-hidden />상담 후 사용</span> : <span className="text-xs font-normal text-emerald-700">사용 중</span>}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink-2">{INFO[s].lines.map((l) => <li key={l}>{l}</li>)}</ul>
            {pending(s) && <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-800" data-testid={`space-consult-pending-${s}`}><CheckCircle2 className="size-3.5" aria-hidden />상담 신청됨({md(pending(s)!.at)}{pending(s)!.by ? ` · ${pending(s)!.by}` : ''})</p>}
          </section>
        ))}
      </div>
      {locked.length > 0 && (data.canRequest ? (
        <section className="space-y-3 rounded-card border border-line p-4" data-testid="space-consult-form">
          <h2 className="text-base font-semibold">상담 신청</h2>
          <div className="flex flex-wrap gap-3 text-sm" role="group" aria-label="상담받을 공간">
            {locked.map((s) => (
              <label key={s} className="flex items-center gap-1.5"><input type="checkbox" checked={pick.includes(s)} disabled={!!pending(s)} onChange={(e) => setPick(e.target.checked ? [...pick, s] : pick.filter((x) => x !== s))} data-testid={`space-consult-pick-${s}`} />{INFO[s].label}{pending(s) ? ' (신청됨)' : ''}</label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="이름"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={50} data-testid="space-consult-name" /></Field>
            <Field label="연락처"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={30} inputMode="tel" placeholder="010-0000-0000" data-testid="space-consult-phone" /></Field>
            <Field label="이메일"><input className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} maxLength={200} type="email" data-testid="space-consult-email" /></Field>
          </div>
          <Field label="하고 싶은 일(선택)"><textarea className={cx(inputCls, 'min-h-[72px]')} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} maxLength={1000} placeholder="예: 공공 입찰 공고를 매일 모아 보고 싶어요" data-testid="space-consult-memo" /></Field>
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-ink-3">보내 주신 연락처로 담당자가 연락드립니다.</span>
            <Button onClick={send} disabled={busy || !pick.filter((s) => !pending(s)).length || !f.name.trim() || !f.email.trim()} data-testid="space-consult-send">{busy ? '보내는 중…' : '상담 신청'}</Button>
          </div>
        </section>
      ) : <p className="rounded-input bg-slate-50 p-3 text-sm text-ink-2" data-testid="space-consult-staff">회사 관리자가 상담을 신청할 수 있습니다. 필요하면 관리자에게 알려 주세요.</p>)}
    </div>
  );
}
