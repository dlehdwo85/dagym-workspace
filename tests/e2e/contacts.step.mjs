// V31 연락처: 연락처 화면 등록 → 검색 → 상세(전화·메일 링크) → 업무 문자 시안 받는 번호에 이름 치면 자동 완성 → 고르면 번호 채움 → 메일 받는 사람 칩도 자동 완성 → 휴지통
import assert from 'node:assert/strict';

export async function contactsFlow({ owner, ctx, BASE, SHOTS, sql }) {
  await owner.goto(BASE + '/contacts');
  await owner.getByTestId('contact-new').click();
  await owner.getByTestId('cf-name').fill('윤고객');
  await owner.getByTestId('cf-org').fill('E2E 관리사무소');
  await owner.getByTestId('cf-phone').fill('01088889999');
  await owner.getByTestId('cf-email').fill('yoon@e2e.test');
  await owner.getByTestId('cf-tags').fill('고객');
  await owner.getByTestId('cf-save').click();
  await owner.getByText('연락처를 등록했습니다').waitFor();
  const row = owner.getByTestId('contact-row').filter({ hasText: '윤고객' });
  await row.waitFor();
  assert.match(await row.innerText(), /010-8888-9999/);
  await owner.getByTestId('contacts-q').fill('8889');
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid="contact-row"]').length === 1);
  await owner.getByTestId('contact-row').first().click();
  await owner.getByTestId('contact-detail').waitFor();
  assert.equal(await owner.getByTestId('cd-phone').getAttribute('href'), 'tel:01088889999');
  await owner.screenshot({ path: `${SHOTS}/134-contacts.png` });
  await owner.getByTestId('contact-detail').getByRole('button', { name: '닫기' }).click();
  // 업무 문자 시안: 받는 번호 칸에 이름 → 자동 완성 → 번호
  await sql`insert into mail_accounts (tenant, provider, host, port, secure, username, from_email, from_name, password_enc) values ('default', 'naver', 'smtp.naver.com', 465, true, 'office', 'office@mail.test', '시험회사', 'v1.x.y.z') on conflict (tenant) do nothing`;
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '연락처 자동 완성 시험', approvalRequired: false });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('mail-compose-open').click();
  const c = owner.getByTestId('mail-compose');
  await c.waitFor();
  await c.getByTestId('mail-to').pressSequentially('윤고');
  const sug = c.getByTestId('mail-to-suggest').getByTestId('suggest-item');
  await sug.first().waitFor();
  assert.match(await sug.first().innerText(), /윤고객[\s\S]*yoon@e2e\.test/);
  await sug.first().click();
  assert.deepEqual(await c.getByTestId('mail-to-chips').getByTestId('addr-chip').allInnerTexts().then((x) => x.map((s) => s.replace('×', '').trim())), ['yoon@e2e.test']);
  await c.getByTestId('mail-channel-sms').click();
  await c.getByTestId('sms-to').fill('윤');
  const ssug = c.getByTestId('sms-to-suggest').getByTestId('suggest-item');
  await ssug.first().waitFor();
  await ssug.first().click();
  assert.equal(await c.getByTestId('sms-to').inputValue(), '010-8888-9999');
  await owner.screenshot({ path: `${SHOTS}/135-contacts-suggest.png` });
}
