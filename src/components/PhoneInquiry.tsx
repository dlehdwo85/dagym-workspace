'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneIncoming } from 'lucide-react';
import { api, broadcastRefresh } from './client';
import { Button, Field, Modal, cx, inputCls, toast } from './ui';

const TYPES = ['위탁운영', 'HILINK 플랫폼', '운영 진단·컨설팅', '기타'] as const;
const EMPTY = { site: 'dagym' as 'dagym' | 'hilink', inquiryType: '위탁운영' as (typeof TYPES)[number], organization: '', name: '', phone: '', email: '', region: '', message: '' };

/** V21 대표번호 전화 문의 등록 → 업무(웹사이트 문의와 같은 담당·단계·알림) */
export function PhoneInquiryButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api('/api/inquiries/phone', { body: { ...f, organization: f.organization || undefined, name: f.name || undefined, phone: f.phone || undefined, email: f.email || undefined, region: f.region || undefined } });
      toast.ok('전화 문의를 업무로 등록했습니다'); setOpen(false); setF(EMPTY); broadcastRefresh();
      if (r.taskId) router.push(`/tasks/${r.taskId}`); // 만든 업무는 상세 전체 화면(이어서 적기) — 이미 있는 업무를 누르면 패널(300차 #850)
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  return (
    <>
      <Button size="sm" variant="secondary" className={className} onClick={() => setOpen(true)} data-testid="phone-inquiry-open"><PhoneIncoming />전화 문의 등록</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="전화 문의 등록">
        <form onSubmit={save} className="space-y-3" data-testid="phone-inquiry-form">
          <div className="flex flex-wrap gap-1.5">
            {(['dagym', 'hilink'] as const).map((s) => <button key={s} type="button" onClick={() => set({ site: s })} aria-pressed={f.site === s}
              className={cx('rounded-full border px-3 py-1 text-sm', f.site === s ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line hover:bg-slate-50')}>{s === 'dagym' ? '다짐' : '하이링크'} 대표번호</button>)}
          </div>
          <Field label="문의 유형"><select className={inputCls} value={f.inquiryType} onChange={(e) => set({ inquiryType: e.target.value as never })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="소속 (아파트명 등)"><input className={inputCls} value={f.organization} onChange={(e) => set({ organization: e.target.value })} data-testid="pi-org" /></Field>
            <Field label="이름"><input className={inputCls} value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="연락처"><input className={inputCls} value={f.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" data-testid="pi-phone" /></Field>
            <Field label="이메일 (있으면)"><input className={inputCls} type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <Field label="지역"><input className={inputCls} value={f.region} onChange={(e) => set({ region: e.target.value })} /></Field>
          </div>
          <Field label="문의 내용"><textarea className={inputCls} rows={4} required value={f.message} onChange={(e) => set({ message: e.target.value })} data-testid="pi-message" /></Field>
          <p className="text-xs text-ink-3">등록하면 웹사이트 문의처럼 유형별 담당자에게 업무(1차 연락 ~ 결과 기록 단계)가 만들어집니다. 연락처는 업무 담당·요청자·관리자만 봅니다.</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>취소</Button><Button type="submit" disabled={busy} data-testid="pi-save">등록</Button></div>
        </form>
      </Modal>
    </>
  );
}
