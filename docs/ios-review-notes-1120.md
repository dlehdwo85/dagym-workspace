# iOS 재제출 — 심사 메모에 넣을 글 (고친 것 5건의 답)

작성 2026-11-20 · 클라우드 · 대표 11/19 요청("심사 메모에 넣을 글도 재제출 전에").
재제출은 **대표 승인 뒤 로컬**이 합니다. 아래 영문을 App Store Connect의 **해결 센터 답글**과 **심사 메모(App Review Information › Notes)** 에 그대로 붙이면 됩니다.

## 0. 다시 내기 전에 로컬이 할 것 (순서대로)

1. **AI 동의가 운영에 올라갔는지** 확인(이 문서 3절 '확인 순서'대로 한 번 해 보기).
2. 관리 › 사용자의 **[심사용 체험 계정] 단추를 한 번 더 누르기** — 누를 때마다 그 계정의 AI 동의 기록을 지워, 심사 담당자가 들어오면 **동의 창을 처음부터** 봅니다. (누른 뒤에는 그 계정으로 로그인해서 동의하지 마세요. 확인은 다른 계정으로.)
3. 심사용 계정 아이디·비밀번호는 지금처럼 ASC의 로그인 정보 칸에(이 문서·저장소에는 적지 않습니다).
4. 연령 등급 '메시지·채팅 = 예'는 로컬이 11/19 저장함(재조회 true).
5. 새 빌드는 필요 없습니다(모두 서버 쪽 변경). 답글 첫 줄에 그 점을 적었습니다.

## 1. 반려 사유와 고친 것 (한국어 요약)

| # | 애플이 말한 것 | 고친 것 | 어디에 반영 |
|---|---|---|---|
| 1 | 3.1.1 로그인 화면에 요금 주소(work-in.dev/#pricing) | 아이폰·아이패드 앱에서 소셜 로그인 단추를 모두 뺌(요금 화면은 소셜 로그인 때 뜨는 브라우저 창에서 보였음). 앱에서 연 우리 화면은 요금·가입 없이 보이게 함 | main 610f12e · 51843ba |
| 2 | 3.1.1 앱 안 사업자·단체 가입 | 위와 같음 — 앱에는 가입·회사 만들기 길이 없음(가입 주소는 로그인으로 돌아감) | 같음 |
| 3 | 2.3.6 연령 등급 | ASC 설문 '메시지·채팅 = 예' | 로컬 11/19 |
| 4 | 5.1.1(i)·5.1.2(i) 바깥 AI로 보내기 전 고지·동의 | 들어오면 동의 창(무엇을·어디로·왜·거부하면), 동의 전에는 서버가 AI 요청을 모두 막음, 설정에서 언제든 끔, 처리방침·AI 안내 글 고침 | (이번 반영) |
| 5 | 2.1(a) 아이패드에서 Apple 로그인 오류 | 아이폰·아이패드 앱에서 Apple 로그인을 포함한 소셜 로그인을 모두 뺌(이메일·비밀번호만) | main 51843ba |

## 2. 붙여 넣을 글 (영문)

```
Hello App Review team,

Thank you for the detailed feedback on version 1.2.0. We have addressed all five issues.
The app loads our web service, and every change below was made on the server side, so the
fixes are already live in the current build (no new binary is needed to see them).

1. Guideline 3.1.1 – pricing link on the login screen
The iPhone/iPad app no longer offers any third-party login. Those buttons used to open a
system browser sheet in which our public website (including its pricing section) could be
reached. They have been removed: the app now has email + password login only, and no screen
in the app leads to pricing, free-trial or purchase pages. As an additional safeguard, any
page of ours that is opened from the app is rendered without pricing or sign-up content.

2. Guideline 3.1.1 – business / organization sign-up
The app has no sign-up or company-registration flow. Accounts are created on the web by a
company administrator's invitation; the app is a companion for existing company accounts.
Inside the app, sign-up and marketing URLs redirect to the login screen.

3. Guideline 2.3.6 – age rating
We updated the Age Rating questionnaire in App Store Connect (Messaging and Chat: Yes).

4. Guidelines 5.1.1(i) and 5.1.2(i) – sharing data with a third-party AI service
The app now discloses the data sharing and asks for explicit permission before anything is
sent to a third-party AI service.
- After login, a consent screen titled "AI 기능 사용 안내" (About using AI features) is shown.
  The first lines, visible without any tap, state the purpose and the recipient: AI features
  send only the content needed for an answer, only while an answer is being made, to the AI
  company (Anthropic); the content is not used to train AI; if the user does not use AI
  features their content is not sent; tasks, calendar, messenger and approvals work without
  consent.
- On the same screen, tapping "자세히 보기" (See details) expands the full disclosure:
  * what is sent: text and voice input the user gives to the AI, files/photos the user
    attaches, the user's own tasks/schedule/documents needed to answer, and files uploaded
    to the library when they are automatically named and sorted;
  * who receives it: Anthropic (USA), the provider of the Claude AI model;
  * why: to answer questions, summarize and organize content. Under the provider's
    commercial terms the data is not used to train its models;
  * what happens if the user declines: only the AI features are unavailable; tasks,
    calendar, messenger and approvals keep working, and nothing is sent.
- Buttons: "AI 기능 쓰기" (Use AI features), "쓰지 않기" (Do not use),
  "나중에 정하기" (Decide later).
- Until the user agrees, our server rejects every AI request, so no data leaves our service.
- The choice can be changed at any time in 설정 (Settings) > 개인정보·AI (Privacy & AI).
- Privacy policy: https://www.work-in.dev/privacy (section 5)
  AI notice: https://www.work-in.dev/ai-notice

How to verify with the demo account:
  a. Log in. The consent screen appears. Tap "자세히 보기" to see what is sent, the
     recipient (Anthropic, USA) and the purpose.
  b. Tap "나중에 정하기" (Decide later). Open the AI assistant and send any message:
     the consent prompt appears again and no answer is produced.
  c. Tap "AI 기능 쓰기". Send the message again: the assistant answers.
  d. Settings > 개인정보·AI shows the switch and the date of consent; turning it off
     blocks AI requests again.

5. Guideline 2.1(a) – Sign in with Apple error on iPad
Sign in with Apple has been removed from the iPhone/iPad app together with all other
third-party login options. The app is for existing company accounts and now uses only our
own email + password login, so no third-party or social login service is offered. The
message you saw appeared because the Apple ID was not linked to an existing company
account; that path no longer exists in the app.

The demo account is provided in the Sign-In Information fields.
Thank you for your time.
```

## 3. 확인 순서 (로컬·대표가 실제 기기에서)

1. 아이폰 또는 아이패드 앱을 열고 로그인 화면에 **소셜 단추가 없는지**(이메일·비밀번호만).
2. 로그인하면 **「AI 기능 사용 안내」 창**이 뜨는지. 첫 문장에 받는 곳 **Anthropic** 이 보이고, **[자세히 보기]** 를 누르면 보내는 항목·**Anthropic(미국)**·까닭이 펼쳐지는지.
3. [나중에 정하기] → AI 비서에 아무 말이나 보내면 **다시 창이 뜨고 답이 안 나오는지**.
4. [AI 기능 쓰기] → 다시 보내면 **답이 나오는지**.
5. 설정 › 개인정보·AI 에서 **끄면 다시 막히는지**.

## 4. 확인 못한 것 · 알아 둘 것

- 영문 답글의 사실은 코드와 운영 응답(서버) 기준입니다. **실제 아이폰·아이패드 화면은 확인 못함** — 위 3절을 로컬·대표가 봐 주세요.
- 마이크 권한 안내 글(앱 안 고정 글)은 '회의 녹음'을 말하지 않습니다. 지금은 받아쓰기(OpenAI)가 꺼져 있어 녹음이 바깥으로 나가지 않으므로 이번 반려 사유와는 상관없습니다. 받아쓰기를 켜는 날에는 ① 동의 글에 OpenAI 줄이 자동으로 생기고 모든 사람에게 다시 묻습니다 ② 권한 글은 새 빌드에서 고쳐야 합니다(로컬 몫).
- 심사 담당자가 동의 창을 보려면 **0절 2번(심사용 계정 단추 다시 누르기)** 이 꼭 필요합니다.
