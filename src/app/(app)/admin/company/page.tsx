'use client';
import { useState } from 'react';
import { Building2, ImagePlus, Plus, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Empty, ErrorBox, Field, PageHeader, Skeleton, cx, inputCls, toast } from '@/components/ui';
import { uploadToLibrary } from '@/components/libraryUpload';

type P = { id?: string; key: string; name: string; ceo: string | null; biz_no: string | null; address: string | null; phone: string | null; fax: string | null; email: string | null;
  website: string | null; bank: string | null; logo_file_id: string | null; brand_color: string | null; font: string | null; note: string | null; is_default: boolean };
const EMPTY: P = { key: '', name: '', ceo: null, biz_no: null, address: null, phone: null, fax: null, email: null, website: null, bank: null, logo_file_id: null, brand_color: '#0F766E', font: null, note: null, is_default: false };
const FIELDS: [keyof P, string, string?][] = [['name', '상호'], ['ceo', '대표자'], ['biz_no', '사업자등록번호'], ['address', '주소'], ['phone', '전화'], ['fax', '팩스'], ['email', '이메일'], ['website', '홈페이지'], ['bank', '입금 계좌'], ['font', '글꼴', '예: Pretendard']];

/** V22 회사 정보·디자인 기준 — AI 비서가 견적서·문서를 만들 때 공급자 칸·로고·브랜드 색을 여기서 읽는다(회사마다, 코드에 쓰지 않음) */
export default function CompanyPage() {
  const { data, error, loading, reload } = useApi<{ profiles: P[] }>('/api/org/company-profiles');
  const [edit, setEdit] = useState<P | null>(null);
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    setBusy(true);
    try {
      await api('/api/org/company-profiles', { method: 'PUT', body: { key: edit.key.trim(), name: edit.name, ceo: edit.ceo || null, bizNo: edit.biz_no || null, address: edit.address || null, phone: edit.phone || null,
        fax: edit.fax || null, email: edit.email || null, website: edit.website || null, bank: edit.bank || null, logoFileId: edit.logo_file_id, brandColor: edit.brand_color || null,
        font: edit.font || null, note: edit.note || null, isDefault: edit.is_default } });
      setEdit(null); reload(); toast.ok('저장했습니다');
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function remove(p: P) {
    if (!confirm(`"${p.name}" 회사 정보를 지울까요?`)) return;
    try { await api('/api/org/company-profiles', { method: 'DELETE', body: { key: p.key } }); reload(); } catch (er: any) { toast.error(er.message); }
  }
  async function logo(file: File | undefined) {
    if (!file || !edit) return;
    try { const r = await uploadToLibrary(file, '회사 로고', undefined, ['로고']); setEdit({ ...edit, logo_file_id: r.id }); toast.ok('로고를 올렸습니다 — 저장을 눌러 반영'); } catch (er: any) { toast.error(er.message); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="회사 정보·디자인" icon={Building2} sub="AI 비서가 견적서·문서를 만들 때 공급자 칸·로고·브랜드 색을 여기서 가져옵니다. 회사마다 따로 두고, 다른 회사 정보와 섞지 않습니다."
        actions={<Button onClick={() => setEdit({ ...EMPTY })} data-testid="company-new"><Plus />회사 추가</Button>} />
      {loading && !data ? <Skeleton rows={3} /> : !data?.profiles.length ? <Empty title="아직 회사 정보가 없습니다" icon={Building2}>회사 추가를 눌러 상호·사업자번호·주소·로고·브랜드 색을 넣어 주세요.</Empty> : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="company-list">
          {data.profiles.map((p) => (
            <li key={p.key} className="rounded-card border border-line bg-white p-4 shadow-card" data-company={p.key}>
              <div className="flex items-center gap-2">
                {p.logo_file_id ? <img src={`/api/library/${p.logo_file_id}/download?inline=1`} alt="" className="h-8 max-w-[96px] object-contain" /> : <span className="size-8 rounded" style={{ background: p.brand_color ?? '#e2e8f0' }} />}
                <b className="min-w-0 flex-1 truncate">{p.name}</b>
                {p.is_default && <span className="rounded-full bg-brand-50 px-2 text-xs font-medium text-brand-700">기본</span>}
                <span className="text-xs text-ink-3">{p.key}</span>
              </div>
              <p className="mt-2 text-xs text-ink-2">{[p.ceo && `대표 ${p.ceo}`, p.biz_no, p.phone, p.address].filter(Boolean).join(' · ') || '정보 없음'}</p>
              <div className="mt-3 flex gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setEdit({ ...p })}>고치기</Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(p)} aria-label={`${p.name} 지우기`}><Trash2 /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <form onSubmit={save} className="space-y-3 rounded-card border border-line bg-white p-4 shadow-card" data-testid="company-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="구분 키 (영문, 예: dagym)"><input className={inputCls} value={edit.key} onChange={(e) => setEdit({ ...edit, key: e.target.value })} disabled={!!edit.id} required pattern="[a-z0-9_-]{2,30}" /></Field>
            {FIELDS.map(([k, label, ph]) => (
              <Field key={k} label={label}><input className={inputCls} value={(edit[k] as string | null) ?? ''} placeholder={ph} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} required={k === 'name'} /></Field>
            ))}
            <Field label="브랜드 색"><span className="flex items-center gap-2"><input type="color" value={edit.brand_color ?? '#0F766E'} onChange={(e) => setEdit({ ...edit, brand_color: e.target.value.toUpperCase() })} className="h-9 w-12 rounded border border-line" />
              <input className={cx(inputCls, 'flex-1')} value={edit.brand_color ?? ''} onChange={(e) => setEdit({ ...edit, brand_color: e.target.value })} placeholder="#0F766E" /></span></Field>
            <Field label="로고"><label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-input border border-dashed border-line px-3 text-sm text-ink-2 hover:bg-slate-50">
              <ImagePlus className="size-4" />{edit.logo_file_id ? '로고 바꾸기' : '로고 올리기 (PNG·JPG·SVG)'}<input type="file" accept="image/*" className="hidden" onChange={(e) => logo(e.target.files?.[0])} /></label></Field>
          </div>
          <Field label="디자인 메모 (예: 표는 얇은 회색 테두리, 제목은 브랜드 색)"><textarea className={inputCls} rows={2} value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.is_default} onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })} />기본 회사 (회사를 말하지 않으면 이 정보로)</label>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit" disabled={busy}>저장</Button></div>
        </form>
      )}
    </div>
  );
}
