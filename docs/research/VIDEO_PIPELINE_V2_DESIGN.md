# #454 영상 제작 파이프라인 v2 — 설계 기록 (2026-10-23)

대표 요청: "영상을 제작하는 프롬프트 AI마케터 뜯어 고쳐주세요 — 기본적으로 우리나라 대기업에서 광고하는 광고와 유사한 수준으로."
로컬 정리(10/23 09:00): ① 한국인·한국 배경·화면 안 글자 금지 ② 장면별 3~5초 클립 → 서버 합성·전환 ③ 한국어 자막 ④ 한국어 내레이션·배경음·음량 정규화
⑤ 실제 워크인 화면 합성 ⑥ 끝 화면 로고·CTA ⑦ 비전 AI 검수 ⑧ Kling $0.12/초.
로컬 정정(10/23): 운영에 OPENAI_API_KEY 없음 → 내레이션은 Higgsfield 에 TTS 가 있으면 그것, 없으면 공급자 설정 + '키 필요'(키 없으면 자막만).
배경음은 회사 자료실 '영상 배경음' 폴더 음원만(대표 승인 뒤 로컬이 넣음). ffmpeg 서버 처리, Vercel 한계면 단계별로.

## 1. 흐름

```
제작의뢰실 의뢰(릴스·쇼츠·광고 영상)
  └ AI 마케터 장면 설계(writePrompt) ─ 장면 3~5개(각 3~5초)·출연진·룩·끝 화면·배경음·실제 화면 장면
[생성] (관리자)
  └ clips  : 장면마다 Higgsfield 요청(Kling 3 Turbo, 장면 초) → 끝나면 장면 클립을 저장소(render/…)에 보관(자료실엔 안 늘어놓음)
             실패·검수 거절(nsfw)은 1번 다시, 그래도 실패면 그 편 실패
  └ qa     : 장면마다 사진 2장(30%·75%) → 비전 AI(외국어·화면 글자 / 한국인 아닌 사람 / 서양식 배경 / 깨진 화면)
             걸린 장면은 고칠 점을 프롬프트에 붙여 1번 다시(clips 로 돌아감), 그래도 걸리면 '사람 검수 필요'
  └ render : ffmpeg — 장면 맞춤(잘라 채움·30fps) → 실제 화면 장면(배경 흐림 + 휴대폰·노트북 틀 + 캡처) → 0.4초 겹쳐 넘김
             → 끝 화면(브랜드 색·로고·한 줄·CTA, 2.5초) → ASS 자막(브랜드 글꼴) → 내레이션(장면 시작 +0.2초, 길면 1.25배까지 빠르게)
             + 배경음(내레이션 있으면 0.2, 없으면 0.7, 0.6초 페이드 인·1.6초 페이드 아웃) → loudnorm -14 LUFS → H.264/AAC mp4(faststart)
  └ done   : 자료실(마케팅 폴더) mp4 → 콘텐츠 새 버전 → 승인 대기(검수 결과는 콘텐츠 근거 rationale.qa, 승인 카드에 '사람 검수 필요' 빨간 줄)
             크레딧 원장 = 완성된 클립 초(다시 만든 초 포함, 실패·nsfw 는 과금 안 됨)
```

## 2. 프롬프트(①)
- 영상 시스템 프롬프트: "국내 대기업 TV·디지털 광고 수준 — 메시지 하나, 첫 3초 훅, 인물의 작은 감정 변화, 문제를 푸는 순간, 마지막은 브랜드".
- 한국인·한국 배경(아파트·사무실·카페·거리), 서양식 주택·외국어 간판·영문 화면 금지, 화면 안 글자 금지(한글은 합성 단계).
- `character`(전 장면 같은 출연진, 영문) · `look`(공통 색·빛) · 장면별 `line`(자막 겸 내레이션, 분당 300음절 기준) · `visualEn` · `seconds` · `screenMediaId/device` · `endCard` · `bgmId`.
- 장면 프롬프트 = 공통 룩(한국 TV 광고 실사·35mm·자연광) + Cast + Shot + "No text anywhere in frame" + Avoid(서양식·외국어·외국인·손가락) [+ 검수에서 걸린 점 고치기].
- 이미지 프롬프트도 같은 원칙(한국인·한국 배경·글자 없음)을 넣었다. AI 가 꺼졌으면 기본 4장면(3·3·4·4초).

## 3. 장면·길이(②)
- 장면 3~5개, 각 3~5초 정수(Kling 3 Turbo 허용 3~15). 합계 = 규격 − 끝 화면 2.5 + 끝 겹침 0.5 + 장면 겹침 0.4×(n−1) 에 맞춤
  (릴스·쇼츠 15초 → 장면 합 약 14초 → 완성 14.8초, 광고 영상 20초 → 장면 합 약 20초).
- Kling 3 Std/Pro 는 `sound: 'off'`(소리는 합성 단계). 비용은 같은 초라 한 번에 15초 만들 때와 같다(재생성분만 더).

## 4. 자막·끝 화면(③⑥)
- 글자는 ASS 자막(libass) — ffmpeg 정적 빌드에 drawtext(harfbuzz)가 없음. 글꼴: 브랜드 키트 글꼴 파일(자료실 OTF/TTF, 이름은 fontkit 로 읽음) → 없으면 Noto Sans KR Bold(assets/fonts, OFL).
- 세로 영상: 글자 크기 가로 5.6%, 한 줄 15자, 두 줄 균형 나눔(한 글자 낱말에서 끊지 않음), 아래 24% 비움(인스타·쇼츠 설명·버튼 자리). 가로: 5.2%·26자·아래 8%.
- 끝 화면: 브랜드 키트 배경색(없으면 브랜드 색) + 로고(가로 42% 안) + 한 줄 + CTA. 키트 CTA 가 있으면 AI 안보다 우선.

## 5. 소리(④)
- 내레이션: Higgsfield API(console 키) 문서 기준 이미지 17·영상 67개 모델뿐이라 TTS 없음 → 플랫폼 운영 '영상 내레이션(TTS)'에서 공급자 선택:
  OpenAI(`/v1/audio/speech`, gpt-4o-mini-tts, 말투 지시) · ElevenLabs(`/v1/text-to-speech/{voice}`, eleven_multilingual_v2, 음성 ID 필요) · 네이버 클로바 보이스(`tts-premium/v1/tts`, Client ID:Secret, 화자).
  키는 암호화 보관·응답에 안 나옴. 연결 시험: OpenAI·ElevenLabs = 목록 조회(과금 없음), 클로바 = 두 글자 합성. 같은 문장은 저장소에 두고 다시 씀(재시도 이중 과금 방지).
  키가 없으면 '내레이션 키 필요 — 자막만' 알림을 남기고 완성.
- 배경음: 자료실 '영상 배경음' 폴더(하위 폴더 포함, 기밀 제외) 음원만. AI 가 고른 것 → 브랜드 이름 든 폴더·태그 → 의뢰마다 돌려 가며. 없으면 '배경음 없음' 알림.
- 음량: loudnorm I=-14 TP=-1.5 LRA=11(한 번 처리 — 시험에서 내레이션+배경음 -14.2 LUFS, 소리 둘 다 없으면 무음 트랙).

## 6. 실제 화면(⑤)
- 자료실 '영상 화면 캡처' 폴더 이미지(기밀 제외)를 AI 가 장면에 배정(1~2장면). 생성 영상이 화면 글자를 그리지 않게, 그 장면은 생성 클립을 흐리게 깔고
  sharp 로 만든 휴대폰(세로 46%)·노트북 틀에 캡처를 넣어 얹는다(그림자·0.35초 페이드·살짝 올라오는 움직임). 캡처가 없으면 그 장면은 일반 장면.

## 7. 검수(⑦)
- AI 세일즈가 아니라 마케팅 AI 한도(assertMktAi), 사용량 marketing_studio. AI 꺼짐·한도·답 해석 실패 = '검수 못 함' → 사람 검수 필요.
- 자동 재생성 1번(QA_REGEN). 재생성이 생성 단계에서 실패하면 앞 클립으로 되돌리고 사람 검수 필요.

## 8. 실행 구조(Vercel)
- ffmpeg: `ffmpeg-static`(정적 빌드 7.0.2, libass·x264·mp3lame, 약 80MB)을 `outputFileTracingIncludes` 로 합성 함수 `/api/marketing/studio/render` 에만 싣는다.
  위치 = FFMPEG_PATH → node_modules/ffmpeg-static/ffmpeg → PATH. 실행 권한이 빠지면 /tmp 로 복사해 실행. ffprobe 없음 → 길이는 `ffmpeg -i` 머리말에서.
- 합성 함수: CRON_SECRET 확인 → 202 응답 → `after()` 로 최대 300초(편 단위로 끊어 남은 편은 다음 호출). 잠금 = result.renderAt(6분), 생성 확인 잠금 = result.pollAt(3분).
- 부르는 곳: 장면이 다 끝난 순간(생성 확인) · 정기 실행 `mktRender`(2건씩) · Vercel 이 아니면(시험·로컬) 그 자리에서 실행.
- 이 컨테이너 기준 1080×1920 14.8초 합성 약 9~12초(4코어), Vercel 1 vCPU 는 몇 배 걸릴 수 있어 300초 안 + 편 단위 분할.

## 9. 데이터
- `mkt_briefs.result` (pipeline 'v2'): `{ stage, model, variants:[{ n, scenes:[{ k, seconds, line, visualEn, screen, status, requestId, key, tries, generated, failRetries, regens, qa, lastIssues }], mediaId, duration, notes, error }], errors, notes, review, audio, mediaIds, usedSeconds }`.
- `mkt_brands.video` (migration 173, 추가형): `{ logoFileId, headline, cta, endColor, fontFileId }` — 브랜드 키트 화면에서 고침(일부만 보내면 합침, 이 회사 자료실·기밀 아닌 파일만).
- `app_settings 'tts'`: `{ provider, keyEnc, voice, model, base, lastTest }`.
- Higgsfield 모델 표 기본값: Kling 3 Turbo $0.12/초(새로 설치할 때 기본, 운영 표는 로컬이 이미 고침).

## 10. 시험(구조 시험 — 실제 Kling·TTS 연동 아님)
- API `tests/api/mkt-video.test.mjs`: 가짜 Higgsfield 가 요청 초·비율대로 작은 진짜 mp4, 가짜 TTS(OpenAI 형식)가 사인파 mp3 → 실제 ffmpeg 합성까지 돈다.
- E2E `mktVideo.step.mjs`: 플랫폼 TTS 카드·연결 시험 → 브랜드 키트 → 제작의뢰실 준비 상태 → 생성 → 장면 칩·완성 영상 → 휴대폰 폭.

## 11. 남은 것·확인 필요
- 대표 결정: TTS 공급자(OpenAI·ElevenLabs·클로바) → 키 입력 → 연결 시험 → 실제 한국어 내레이션 품질 확인.
- 로컬: 자료실 '영상 화면 캡처'(실제 워크인 화면, 개인정보 없는 시험 데이터) · '영상 배경음'(상업적 사용 가능 라이선스) 넣기, 워크인 브랜드 키트 CTA '14일 무료 체험 · work-in.dev'·로고.
- 실제 Kling 클립으로 검수 문구·재생성 효과 확인, 합성 시간(Vercel) 실측.
- 다음 단계 후보: 장면 대사·영상 지시 화면에서 고치기, 장면 하나만 [다시 만들기], 이미지→영상(Kling image-to-video, 첫 장면에 실제 사진), 2-pass loudnorm, 자막 스타일 선택.
