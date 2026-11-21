import { createPrivateKey, type KeyObject } from 'node:crypto';

/**
 * 로컬 11/21 긴급(#1094 자가 점검 결과 key_parse): 운영 APPLE_PRIVATE_KEY 를 읽지 못해 애플 로그인(토큰 교환)·토큰 해지가 전부 실패하고 있었다.
 * Vercel 에 붙여 넣을 때 흔히 생기는 모양을 너그럽게 받아들인다 — 앞뒤 따옴표, 글자 그대로의 "\n"·"\r", 줄바꿈이 공백으로 바뀐 한 줄,
 * 머리줄(-----BEGIN PRIVATE KEY-----) 없이 본문(base64)만, 'EC PRIVATE KEY'(SEC1) 모양. 본문을 DER 로 풀어 PKCS#8 → SEC1 순서로 읽는다.
 * 값 자체는 어디에도 돌려주거나 남기지 않는다 — 진단(appleKeyShape)은 모양만.
 * 이 파일은 node:crypto 만 쓴다(시험이 Node 로 바로 불러 여러 모양을 확인).
 */
const strip = (raw: string) => {
  let s = raw.trim();
  s = s.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim(); // 앞뒤 따옴표
  return s.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, ''); // 글자 그대로의 \n·\r → 실제 줄바꿈
};
const headerOf = (s: string) => s.match(/-----BEGIN ([A-Z ]+?)-----/)?.[1] ?? null;
const bodyOf = (s: string) => s.replace(/-----(BEGIN|END) [A-Z ]+?-----/g, '').replace(/[^A-Za-z0-9+/=]/g, '');

export function appleKeyObject(raw: string): KeyObject {
  const s = strip(raw);
  const header = headerOf(s);
  if (header === 'ENCRYPTED PRIVATE KEY') throw new Error('암호가 걸린 키입니다 — 애플에서 받은 .p8 파일 그대로(암호 없음)를 넣어 주세요');
  const der = Buffer.from(bodyOf(s), 'base64');
  if (!der.length) throw new Error('키 본문이 비어 있습니다');
  const order: ('pkcs8' | 'sec1')[] = header === 'EC PRIVATE KEY' ? ['sec1', 'pkcs8'] : ['pkcs8', 'sec1'];
  let last: unknown;
  for (const type of order) {
    try {
      const k = createPrivateKey({ key: der, format: 'der', type });
      if (k.asymmetricKeyType !== 'ec' || k.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error(`ES256(P-256) 키가 아닙니다(${k.asymmetricKeyType}/${k.asymmetricKeyDetails?.namedCurve ?? '-'})`);
      return k;
    } catch (e) { last = e; }
  }
  throw new Error(`키를 읽지 못했습니다(${String((last as Error)?.message ?? last).slice(0, 80)})`);
}

/** 진단용 '모양'만(값·본문은 돌려주지 않음): 머리줄 종류, 실제 줄 수, 글자 그대로의 \n 포함, 따옴표로 시작, 본문 길이(보통 200자 안팎), 고쳐서 읽었는지 */
export function appleKeyShape(raw: string) {
  const t = raw.trim();
  const s = strip(raw);
  const header = headerOf(s);
  let readable = false, curve: string | null = null, error: string | null = null;
  try { const k = appleKeyObject(raw); readable = true; curve = k.asymmetricKeyDetails?.namedCurve ?? null; } catch (e) { error = String((e as Error)?.message ?? e).slice(0, 120); }
  let strict = false; // 예전 방식(PKCS#8 머리줄 + 실제 줄바꿈 그대로)으로도 읽히는지
  try { createPrivateKey({ key: raw.replace(/\\n/g, '\n').trim(), format: 'pem' }); strict = headerOf(raw.replace(/\\n/g, '\n')) === 'PRIVATE KEY'; } catch { strict = false; }
  return {
    header: header ?? 'none',
    lines: t.split('\n').length,
    literalBackslashN: /\\n/.test(t),
    carriageReturn: /\r|\\r/.test(t),
    quoted: /^["'`]/.test(t) || /["'`]$/.test(t),
    bodyLength: bodyOf(s).length,
    readable, curve, fixedByNormalize: readable && !strict, error,
  };
}
