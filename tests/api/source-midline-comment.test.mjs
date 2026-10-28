// 228차(로컬 10/28 13:00 '205차 CSV 다시 가져오기 실패'): 줄 가운데에 들어간 // 설명이 같은 줄 뒤의 코드를 통째로 꺼 버리는 실수 막기.
// 207차에 `} // 설명 else if (k === 'priority') { … }` 가 들어가 우선순위·예상매출 바꾸기가 꺼졌고, 224차 시험에서도 같은 모양으로 준비 코드가 꺼진 적이 있다.
// 잡는 모양: ';' 또는 '}' 뒤 // 설명 안에 'else if (' · '} else' · '; 이름 = ' · '; await ' · '; const ' 같은 코드가 이어짐
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const self = fileURLToPath(import.meta.url);
const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { if (n === 'node_modules' || n.startsWith('.')) continue; const p = path.join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx|mjs)$/.test(n) && p !== self) out.push(p); } return out; };
const HIDDEN = /[;}]\s*\/\/[^\n]*(else if \(|\} else\b|;\s*([a-z][A-Za-z0-9_]* = |await |const |let |return ))/;
// 231차: 객체 칸 사이(',' 뒤)에 들어간 설명이 뒤 칸들(이름: 값, 이름: 값)을 꺼 버린 모양 — 타입 검사가 잡았지만 여기서도 막음
const HIDDEN_FIELDS = /,\s*\/\/[^\n]*\b[a-z][A-Za-z0-9_]*: [^,]+, [a-z][A-Za-z0-9_]*: /;
// 237차: ';' 뒤 설명 안에 'const 이름 = ' 이 바로 이어진 모양(앞에 ';' 없이) — '…); // 설명 const best = …' 로 뒤 선언이 꺼졌다(타입 검사가 잡음)
const HIDDEN_DECL = /[;}]\s*\/\/[^\n]*\b(?:const|let) [A-Za-z_$][\w$]* = /;

test('줄 가운데 // 설명 뒤에 숨은 코드 없음(src·tests)', () => {
  const bad = [];
  for (const f of [...walk(path.join(repo, 'src')), ...walk(path.join(repo, 'tests'))]) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if ((HIDDEN.test(line) || HIDDEN_FIELDS.test(line) || HIDDEN_DECL.test(line)) && !/https?:\/\//.test(line)) bad.push(`${path.relative(repo, f)}:${i + 1}`); });
  }
  assert.deepEqual(bad, [], '설명(//)은 제 줄로 옮기거나 줄 끝에만 두세요');
});

test('검사가 207차·231차 모양을 실제로 잡음', () => {
  assert.ok(HIDDEN.test("if (k === 'status') { o.status = key; } // 207차: 설명 else if (k === 'priority') { o.priority = v; }"));
  assert.ok(HIDDEN.test("srv = await startServer({}); // 설명 sql = testDb(); ctx = await bootstrap();"));
  assert.ok(!HIDDEN.test("const a = 1; // 설명만 있는 줄"));
  assert.ok(HIDDEN_FIELDS.test("return { a: 1, b: 2, // 설명 c: x + y, d: z ? 1 : 2, e: 'w' };"), '231차 모양(객체 칸 사이 설명)');
  assert.ok(!HIDDEN_FIELDS.test("rolling: z.enum(['A']), // 소재 노출 방식 adRollingType: 성과 기반 / 동일 비중"), '설명 안 낱말 하나는 괜찮음');
  assert.ok(HIDDEN_DECL.test("const valid = ps.filter((x) => !x.bad); // 237차: 설명 const best = num(top) ?? 0;"), '237차 모양(설명 뒤 선언)');
  assert.ok(!HIDDEN_DECL.test("const a = 1; // const 로 바꾸면 안 됨"), '설명 안 낱말 const 하나는 괜찮음');
});
