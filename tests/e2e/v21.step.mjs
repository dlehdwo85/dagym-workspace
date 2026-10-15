// V21 메일 계정·명함 설정 화면 + 업무 [메일로 보내기] 시안(보내는 주소·받는 사람·첨부·명함 미리보기). 실제 발송은 API 시험(모의 SMTP)에서
import assert from 'node:assert/strict';
import { FAKE } from '../helpers.mjs';
export async function v21({ owner, BASE, SHOTS, sql }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  const call = (path, method, body) => owner.evaluate(async ([p, m, b]) => {
    const r = await fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return r.json();
  }, [path, method, body]);
  await call('/api/org/company-profiles', 'PUT', { key: 'hilink', name: 'HI-LINK 시험', phone: '1555-0000', address: '시험시 시험로 36, 8층', website: 'www.hilink.test' });
  await owner.goto(`${BASE}/admin/mail`);
  await owner.getByTestId('mail-account-form').waitFor();
  await owner.getByRole('radio', { name: '네이버 메일' }).waitFor();
  await owner.getByTestId('mail-signature').getByRole('button', { name: 'HI-LINK 시험' }).click();
  await owner.getByTestId('sig-intro').fill('시험 소개 한 줄');
  await owner.getByTestId('sig-save').click();
  await owner.frameLocator('[data-testid="sig-preview"]').getByText('시험 소개 한 줄').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v21-mail-settings.png`, fullPage: true });
  // 연결된 계정(시험용 행) → 업무에서 시안
  await sql`insert into mail_accounts (tenant, provider, host, port, secure, username, from_email, from_name, password_enc) values ('default', 'naver', 'smtp.naver.com', 465, true, 'office', 'office@mail.test', '시험회사', 'v1.x.y.z')
    on conflict (tenant) do nothing`;
  const t = await call('/api/tasks', 'POST', { title: '메일 시안 시험', approvalRequired: false });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('mail-compose-open').click();
  const c = owner.getByTestId('mail-compose');
  await c.waitFor();
  assert.match(await c.getByTestId('mail-from-line').innerText(), /office@mail\.test/);
  await c.getByTestId('mail-company-hilink').click();
  await c.getByTestId('mail-to').fill('customer@client.test');
  await c.getByTestId('mail-body').fill('안녕하세요.\n\n제안서를 보내 드립니다.');
  const pv = owner.frameLocator('[data-testid="mail-preview"]');
  await pv.getByText('제안서를 보내 드립니다.').waitFor();
  await pv.getByText('HI-LINK 시험').waitFor();
  await pv.getByText('시험시 시험로 36, 8층').waitFor();
  assert.equal(await pv.getByText(/APART/i).count(), 0);
  assert.ok(await c.getByTestId('mail-send').isEnabled());
  await owner.screenshot({ path: `${SHOTS}/v21-mail-compose.png` });
  // 문자 탭: 받는 번호·내용·서명 한 줄(이름 / 회사 / 대표번호) 미리보기
  await c.getByTestId('mail-channel-sms').click();
  await c.getByTestId('sms-to').fill('010-0000-0000');
  await c.getByTestId('sms-body').fill('제안서 보내 드립니다.');
  assert.match(await c.getByTestId('sms-preview').innerText(), /제안서 보내 드립니다\.[\s\S]*HI-LINK 시험 \/ 1555-0000/);
  await owner.keyboard.press('Escape');
  // V28-1 이 업무의 AI 비서: [메일 초안] → 시안 창이 초안(제목·본문)으로 열림
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true,
    anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ reply: '회신 초안입니다.', subject: 'AI 초안 제목', body: 'AI 초안 본문입니다.', attach: [] }) }], stop_reason: 'end_turn' }] }) });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('assist-section').waitFor();
  await owner.getByTestId('assist-mail').click();
  const c2 = owner.getByTestId('mail-compose');
  await c2.waitFor();
  assert.equal(await c2.getByTestId('mail-subject').inputValue(), 'AI 초안 제목');
  assert.equal(await c2.getByTestId('mail-body').inputValue(), 'AI 초안 본문입니다.');
  await owner.keyboard.press('Escape');
  await owner.getByTestId('assist-reply').getByText('회신 초안입니다.').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v28-1-task-assist.png` });
  // 전화 문의 등록 → 문의 업무
  await owner.goto(`${BASE}/tasks`);
  await owner.getByTestId('phone-inquiry-open').click();
  const pf = owner.getByTestId('phone-inquiry-form');
  await pf.getByRole('button', { name: '하이링크 대표번호' }).click();
  await pf.getByTestId('pi-org').fill('전화시험아파트');
  await pf.getByTestId('pi-message').fill('위탁 운영 문의 전화');
  await pf.getByTestId('pi-save').click();
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}/);
  await owner.getByText('[하이링크 전화 문의] 전화시험아파트', { exact: false }).first().waitFor();
  // 뒤 단계(업무 목록 순서 시험)에 영향이 없도록 지운다
  const tid = owner.url().match(/\/tasks\/([0-9a-f-]{36})/)[1];
  await owner.evaluate(async (id) => { await fetch(`/api/tasks/${id}`, { method: 'DELETE' }); }, tid);
  await sql`delete from mail_accounts where tenant = 'default'`;
}
