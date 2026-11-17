// 범용화 5단계 금칙어 검사(scripts/check-words.mjs): 화면·응답에 나가는 글자에 기본 회사 표현(브랜드 이름·그 업종의 말)이 새로 들어오면 실패.
// 지금 있는 것은 scripts/words-baseline.json 에 파일별 개수로 적혀 있다 — 늘면 여기서 걸린다.
//   · 다른 회사도 보는 글이면 용어 사전(src/lib/terms.ts · src/lib/sales/terms.ts)으로 옮기고
//   · 기본 회사 전용 분기에 일부러 넣은 것이면 `node scripts/check-words.mjs --write` 로 기준을 고친다(커밋 설명에 이유)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scan } from '../../scripts/check-words.mjs';

test('검사기: 문자열·JSX 글은 세고, 주석·정규식은 세지 않는다', () => {
  const src = [
    "// 다짐 본사에서만 쓰는 화면(주석은 안 셈)",
    "const RULE = /단지|입주민/; // 판정 규칙(정규식은 안 셈)",
    "export const label = '다짐 본사';",
    "export const hint = `관리사무소 ${1} 번호`;",
    "export function A() { return <p title=\"세대수\">입주민 안내</p>; }",
    "export const ok = '거래처 이름';",
  ].join('\n');
  const hits = scan('/virtual/a.tsx', src);
  assert.deepEqual(hits.map((h) => [h.cat, h.word, h.line]).sort(), [['brand', '다짐', 3], ['domain', '관리사무소', 4], ['domain', '세대수', 5], ['domain', '입주민', 5]].sort());
});

test('저장소: 기본 회사 표현이 기준보다 늘지 않았다', () => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/check-words.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /통과 — 새로 들어온 기본 회사 표현 없음/);
});
