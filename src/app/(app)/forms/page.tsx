'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Plus, Printer, QrCode, RefreshCw } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession, canManage } from '@/components/session';
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { UnitSelect, UserSelect } from '@/components/pickers';

const KIND: Record<string, { label: string; desc: string; color: string }> = {
  facility: { label: '시설 고장', desc: '운동기구·샤워실·조명 등 고장 신고', color: '#ea580c' },
  complaint: { label: '회원 민원', desc: '불편 사항 접수 (회신용 연락처 받음)', color: '#7c3aed' },
  supply: { label: '비품 요청', desc: '수건·소모품 등 비품 요청', color: '#0891b2' },
};

/** B-8 현장 신고 양식 + QR 관리 (현장 관리자 이상) */
export default function FormsPage() {
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<{ forms: any[] }>('/api/forms');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ kind: 'facility' });
  const [qr, setQr] = useState<any>(null);
  if (!canManage(user.role)) return <ErrorBox error={{ status: 403, message: '현장 신고 양식은 현장 관리자 이상이 관리합니다.' }} />;
  const url = (t: string) => `${location.origin}/r/${t}`;
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try { await api('/api/forms', { body: { orgUnitId: f.orgUnitId ?? dir.orgUnits[0]?.id, kind: f.kind, defaultAssigneeId: f.defaultAssigneeId || null } }); toast.ok('양식을 만들었습니다'); setOpen(false); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function toggle(x: any) {
    try { await api(`/api/forms/${x.id}`, { method: 'PATCH', body: { orgUnitId: x.org_unit_id, kind: x.kind, title: x.title, defaultAssigneeId: x.default_assignee_id, enabled: !x.enabled } }); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function rotate(x: any) {
    if (!confirm('QR 주소를 새로 발급할까요? 이미 붙인 QR 은 더 이상 쓸 수 없습니다.')) return;
    try { await api(`/api/forms/${x.id}/rotate`, { body: {} }); toast.ok('새 QR 을 발급했습니다. 다시 인쇄해 붙여 주세요.'); reload(); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="현장 신고 QR" icon={QrCode} sub="회원·직원이 QR 을 찍어 신고하면 그 현장 업무가 자동으로 만들어지고 담당자에게 배정됩니다."
        actions={<Button onClick={() => setOpen(true)}><Plus />양식 만들기</Button>} />
      {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={4} /> : !data?.forms.length ? (
        <Empty title="아직 신고 양식이 없습니다" icon={QrCode} action={<Button onClick={() => setOpen(true)}><Plus />첫 양식 만들기</Button>}>현장마다 시설 고장·회원 민원·비품 요청 양식을 만들고 QR 을 인쇄해 붙이세요.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="forms">
          {data.forms.map((x) => (
            <div key={x.id} className={cx('rounded-card border border-line bg-white p-4 shadow-card', !x.enabled && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-input text-white" style={{ background: KIND[x.kind].color }}><QrCode className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{x.org_unit_name} · {x.title}</div>
                  <div className="text-xs text-ink-2">담당 {x.default_assignee_name ?? '현장 관리자 자동'} · 접수 {x.submissions}건{x.last_submitted ? ` · 최근 ${fmtDateTime(x.last_submitted)}` : ''}</div>
                </div>
                <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" className="accent-brand-600" checked={x.enabled} onChange={() => toggle(x)} />사용</label>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => setQr(x)}><Printer />QR 보기·인쇄</Button>
                <Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(url(x.token)); toast.ok('주소를 복사했습니다'); }}><Copy />주소</Button>
                <Button size="sm" variant="ghost" onClick={() => rotate(x)}><RefreshCw />재발급</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="신고 양식 만들기">
        <form onSubmit={create} className="space-y-3">
          <Field label="현장"><UnitSelect value={f.orgUnitId ?? dir.orgUnits[0]?.id} onChange={(v) => setF({ ...f, orgUnitId: v })} /></Field>
          <div className="grid gap-2">
            {Object.entries(KIND).map(([k, v]) => (
              <label key={k} className={cx('flex cursor-pointer items-center gap-3 rounded-input border p-3', f.kind === k ? 'border-brand-500 bg-brand-50' : 'border-line')}>
                <input type="radio" name="kind" checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} />
                <span><span className="block text-sm font-semibold">{v.label}</span><span className="text-xs text-ink-2">{v.desc}</span></span>
              </label>
            ))}
          </div>
          <Field label="기본 담당자" hint="비우면 그 현장의 현장 관리자에게 배정됩니다"><UserSelect value={f.defaultAssigneeId} onChange={(v) => setF({ ...f, defaultAssigneeId: v })} placeholder="현장 관리자 자동" /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>취소</Button><Button type="submit">만들기</Button></div>
        </form>
      </Modal>
      {qr && <QrSheet form={qr} url={url(qr.token)} onClose={() => setQr(null)} />}
    </div>
  );
}

function QrSheet({ form, url, onClose }: { form: any; url: string; onClose: () => void }) {
  const [img, setImg] = useState('');
  useEffect(() => { QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: 'M' }).then(setImg).catch(() => setImg('')); }, [url]);
  return (
    <Modal open onClose={onClose} title="QR 인쇄">
      <div className="print-area mx-auto max-w-sm rounded-card border-2 border-dashed border-line p-6 text-center" data-testid="qr-sheet">
        <div className="text-sm font-semibold" style={{ color: KIND[form.kind].color }}>{form.org_unit_name}</div>
        <div className="mt-1 text-2xl font-bold">{form.title} 신고</div>
        <p className="mt-1 text-sm text-ink-2">휴대폰 카메라로 찍으면 바로 접수됩니다</p>
        {img ? <img src={img} alt={`${form.title} 신고 QR`} className="mx-auto mt-4 size-56" /> : <div className="mx-auto mt-4 size-56 skeleton rounded" />}
        <p className="mt-3 break-all text-[11px] text-ink-3">{url}</p>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>닫기</Button><Button onClick={() => window.print()}><Printer />인쇄</Button></div>
    </Modal>
  );
}
