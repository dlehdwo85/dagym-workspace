// 로컬 11/21 긴급(#1094 자가 점검 key_parse): 운영 APPLE_PRIVATE_KEY 를 읽지 못해 애플 로그인·토큰 해지가 전부 실패 → 붙여 넣을 때 흔한 모양을 너그럽게 읽는다.
// src/lib/appleKey.ts 를 Node 로 바로 불러(형 지우기) 여러 모양을 확인 — 서버·DB 없이. 진단(모양)에는 키 값·본문이 들어가지 않는지도 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

const { appleKeyObject, appleKeyShape } = await import('../../src/lib/appleKey.ts');
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pkcs8 = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const sec1 = ec.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
const body = pkcs8.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
const signsLikeOriginal = (k) => { const m = Buffer.from('apple'); return verify('sha256', m, createPublicKey(ec.privateKey), sign('sha256', m, k)); };

test('읽히는 모양: 정상 .p8 · 글자 \\n 한 줄 · 따옴표 · 줄바꿈이 공백 · 머리줄 없는 본문 · 본문 여러 줄 · CRLF · SEC1(EC PRIVATE KEY) — 모두 같은 키로 서명', () => {
  const cases = {
    '정상 .p8': [pkcs8, false],
    '글자 \\n 한 줄(Vercel 흔함)': [pkcs8.trim().replace(/\n/g, '\\n'), false],
    '앞뒤 따옴표 + 글자 \\n': [`"${pkcs8.trim().replace(/\n/g, '\\n')}"`, true],
    '줄바꿈이 공백으로': [pkcs8.trim().replace(/\n/g, ' '), true],
    '머리줄 없이 본문만': [body, true],
    '머리줄 없이 본문 여러 줄': [body.match(/.{1,64}/g).join('\n'), true],
    'CRLF 줄바꿈': [pkcs8.replace(/\n/g, '\r\n'), false],
    'SEC1(EC PRIVATE KEY)': [sec1, true],
  };
  for (const [name, [raw, fixed]] of Object.entries(cases)) {
    const k = appleKeyObject(raw);
    assert.ok(signsLikeOriginal(k), `${name}: 같은 키`);
    const sh = appleKeyShape(raw);
    assert.equal(sh.readable, true, name); assert.equal(sh.curve, 'prime256v1', name); assert.equal(sh.fixedByNormalize, fixed, `${name}: 고쳐서 읽었는지`);
    assert.ok(sh.bodyLength >= 150 && sh.bodyLength <= 260, `${name}: 본문 길이 ${sh.bodyLength}`); // PKCS#8 ≈ 184, SEC1 ≈ 164
    const out = JSON.stringify(sh);
    assert.ok(!out.includes(body.slice(10, 40)) && !out.includes(body.slice(-40, -10)), `${name}: 진단에 키 본문 없음`);
  }
  assert.equal(appleKeyShape(body).header, 'none'); assert.equal(appleKeyShape(sec1).header, 'EC PRIVATE KEY'); assert.equal(appleKeyShape(pkcs8).header, 'PRIVATE KEY');
  assert.equal(appleKeyShape(`"${pkcs8.trim().replace(/\n/g, '\\n')}"`).quoted, true); assert.equal(appleKeyShape(pkcs8.trim().replace(/\n/g, '\\n')).literalBackslashN, true);
  assert.equal(appleKeyShape(pkcs8.trim().replace(/\n/g, '\\n')).lines, 1); assert.ok(appleKeyShape(pkcs8).lines >= 5);
});

test('읽히지 않는 모양: 엉뚱한 글자 · RSA 키(ES256 아님) · 암호 걸린 키 — 이유만(값 없음)', () => {
  const garbage = appleKeyShape('not-a-key');
  assert.equal(garbage.readable, false); assert.match(garbage.error, /읽지 못했습니다/); assert.throws(() => appleKeyObject('not-a-key'));
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const r = appleKeyShape(rsa); assert.equal(r.readable, false); assert.match(r.error, /ES256\(P-256\) 키가 아닙니다/);
  const enc = ec.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'x' }).toString();
  const e = appleKeyShape(enc); assert.equal(e.header, 'ENCRYPTED PRIVATE KEY'); assert.equal(e.readable, false); assert.match(e.error, /암호가 걸린 키/);
});
