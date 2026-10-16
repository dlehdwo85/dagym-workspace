// 네이버 비즈채널 검수: 공개 화면(/ 소개·/login·/signup·/welcome) 하단에 사업자 정보 줄 + 약관·개인정보처리방침 링크(값은 운영 설정, 시험은 시험 값)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, resetDb, startServer } from '../helpers.mjs';

let srv;
before(async () => { await resetDb(); srv = await startServer({ COMPANY_NAME: '시험상호', COMPANY_CEO: '홍길동', COMPANY_BIZNO: '000-00-00000', COMPANY_ADDRESS: '서울 시험로 1', COMPANY_PHONE: '02-000-0000', SUPPORT_EMAIL: 'help@example.test' }); });
after(() => srv?.proc.kill());

test('공개 화면 하단 사업자 정보', async () => {
  for (const path of ['/', '/welcome', '/login', '/signup']) {
    const html = await (await fetch(BASE + path)).text();
    for (const w of ['data-testid="biz-footer"', '시험상호', '홍길동', '000-00-00000', '서울 시험로 1', '02-000-0000', 'help@example.test', '통신판매업 신고번호', '신고 진행 중', '/terms', '/privacy'])
      assert.ok(html.includes(w), `${path}: ${w}`);
  }
});
