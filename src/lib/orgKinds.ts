/**
 * P2 조직 개편(대표 확정 10/26 · #679~#681): 본사 › 사업부 › 부서 › 팀 — 종류·장 이름·상위 규칙.
 * 화면과 서버가 같이 쓰므로 서버 모듈을 가져오지 않는다.
 */
export const ORG_KINDS = ['hq', 'division', 'dept', 'team'] as const;
export type OrgKind = (typeof ORG_KINDS)[number];

export const KIND_LABEL: Record<OrgKind, string> = { hq: '본사', division: '사업부', dept: '부서', team: '팀' };
/** 장 이름 자동(#680) */
export const LEAD_TITLE: Record<OrgKind, string> = { hq: '대표', division: '사업부장', dept: '부서장', team: '팀장' };
/** 종류마다 한 줄 설명(#679 — '부서(상위 없음)' 같은 모순 문구 대신) */
export const KIND_HINT: Record<OrgKind, string> = {
  hq: '회사 맨 위 1곳. 본사 구성원은 아래 모든 사업부·부서·팀 업무를 봅니다',
  division: '본사 아래 사업 단위. 그 아래 부서·팀 업무를 봅니다',
  dept: '본사·사업부(또는 다른 부서) 아래. 그 아래 하위 부서·팀 업무를 봅니다',
  team: '부서(또는 본사·사업부) 아래 실무 단위. 팀 아래에는 조직을 둘 수 없습니다',
};
/** 바로 위에 올 수 있는 종류 */
export const PARENT_KINDS: Record<OrgKind, OrgKind[]> = { hq: [], division: ['hq'], dept: ['hq', 'division', 'dept'], team: ['hq', 'division', 'dept'] };
export const canParent = (parentKind: OrgKind, child: OrgKind) => PARENT_KINDS[child].includes(parentKind);
/** 맨 위(상위 없음): 본사는 늘 · 사업부·부서는 본사가 없는 회사에서만 · 팀은 안 됨 */
export const topAllowed = (kind: OrgKind, hasHq: boolean) => kind === 'hq' || (!hasHq && (kind === 'division' || kind === 'dept'));
export const isOrgKind = (k: unknown): k is OrgKind => typeof k === 'string' && (ORG_KINDS as readonly string[]).includes(k);
export const kindLabel = (k: string | null | undefined) => (isOrgKind(k) ? KIND_LABEL[k] : '부서');
export const leadTitle = (k: string | null | undefined) => (isOrgKind(k) ? LEAD_TITLE[k] : '장');

/** #680 이름-종류 검사: 이름 끝말로 짐작한 종류(모르면 null) — '영업1팀'인데 종류가 부서인 경우 등 */
export function kindFromName(name: string): OrgKind | null {
  const n = name.trim().replace(/\s+/g, '');
  if (/본사$/.test(n)) return 'hq';
  if (/(사업부|본부)$/.test(n)) return 'division';
  if (/팀$/.test(n)) return 'team';
  if (/부$/.test(n)) return 'dept';
  return null;
}
export function nameKindWarn(name: string, kind: OrgKind): string | null {
  const g = kindFromName(name);
  return g && g !== kind ? `이름은 '${KIND_LABEL[g]}' 같은데 종류는 '${KIND_LABEL[kind]}'입니다 — 맞는지 확인하세요` : null;
}
/** 받침에 따라 을/를 · 이/가 */
const batchim = (w: string) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0; };
export const eulReul = (w: string) => (batchim(w) ? '을' : '를');
export const iGa = (w: string) => (batchim(w) ? '이' : '가');

/** [일반 기업 조직도로 시작] — 업종과 상관없는 기본 틀(이름·구성은 만든 뒤 바로 고침) */
export const GENERIC_ORG: { name: string; kind: OrgKind; children?: { name: string; kind: OrgKind; children?: { name: string; kind: OrgKind }[] }[] } = {
  name: '본사', kind: 'hq', children: [
    { name: '경영지원부', kind: 'dept', children: [{ name: '회계팀', kind: 'team' }, { name: '총무팀', kind: 'team' }] },
    { name: '영업부', kind: 'dept', children: [{ name: '영업1팀', kind: 'team' }, { name: '영업2팀', kind: 'team' }] },
    { name: '마케팅부', kind: 'dept' },
  ],
};
