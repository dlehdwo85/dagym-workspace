// 로컬 10/25 17:05 ①(#600): 전자계약 감사 추적 '기기' 칸 — 브라우저 원문(User-Agent)을 60자에서 자르면 '(KHTML, lik' 처럼 끊겨 보여서,
// 브라우저·운영체제 이름('크롬 141 · 윈도우', '사파리 18 · 아이폰 iOS 18', '워크인 앱 · 안드로이드 14')으로 바꿔 보여 준다.
// 원문은 DB(contract_events.user_agent·contract_signers.user_agent)에 그대로 남고, 화면 표(마우스 올리면 원문)·완료 PDF 는 이 짧은 이름만 쓴다. 서버·화면 공용(순수 함수).
const num = (re: RegExp, s: string) => { const m = re.exec(s); return m ? m[1].split(/[._]/)[0] : ''; };
export function deviceLabel(ua: string | null | undefined): string {
  const s = (ua ?? '').trim();
  if (!s) return '-';
  const v = (re: RegExp) => num(re, s);
  let os = '';
  if (/iPhone/.test(s)) os = `아이폰${v(/OS (\d+[._]\d+)/) ? ` iOS ${v(/OS (\d+[._]\d+)/)}` : ''}`;
  else if (/iPad/.test(s)) os = `아이패드${v(/OS (\d+[._]\d+)/) ? ` iOS ${v(/OS (\d+[._]\d+)/)}` : ''}`;
  else if (/Android/.test(s)) os = `안드로이드${v(/Android (\d+(?:\.\d+)?)/) ? ` ${v(/Android (\d+(?:\.\d+)?)/)}` : ''}`;
  else if (/Windows NT/.test(s)) os = '윈도우';
  else if (/Macintosh|Mac OS X/.test(s)) os = '맥';
  else if (/CrOS/.test(s)) os = '크롬북';
  else if (/Linux/.test(s)) os = '리눅스';
  let br = '';
  if (/WorkInApp/.test(s)) br = '워크인 앱'; // mobile/capacitor.config.ts appendUserAgent
  else if (/SamsungBrowser\//.test(s)) br = `삼성 인터넷 ${v(/SamsungBrowser\/(\d+)/)}`;
  else if (/Whale\//.test(s)) br = `웨일 ${v(/Whale\/(\d+)/)}`;
  else if (/Edg(?:e|A|iOS)?\//.test(s)) br = `엣지 ${v(/Edg(?:e|A|iOS)?\/(\d+)/)}`;
  else if (/OPR\/|Opera/.test(s)) br = '오페라';
  else if (/KAKAOTALK/i.test(s)) br = '카카오톡 앱';
  else if (/NAVER\(/.test(s)) br = '네이버 앱';
  else if (/FBAN|FBAV/.test(s)) br = '페이스북 앱';
  else if (/Instagram/.test(s)) br = '인스타그램 앱';
  else if (/Firefox\/|FxiOS\//.test(s)) br = `파이어폭스 ${v(/(?:Firefox|FxiOS)\/(\d+)/)}`;
  else if (/CriOS\//.test(s)) br = `크롬 ${v(/CriOS\/(\d+)/)}`;
  else if (/Chrome\//.test(s)) br = `크롬 ${v(/Chrome\/(\d+)/)}`;
  else if (/Safari\//.test(s)) br = `사파리${v(/Version\/(\d+)/) ? ` ${v(/Version\/(\d+)/)}` : ''}`;
  else if (os.startsWith('아이폰') || os.startsWith('아이패드') || os.startsWith('안드로이드')) br = '앱 안 브라우저'; // 사파리·크롬 표시가 없는 휴대폰 = 다른 앱 안의 웹 화면
  if (!br && !os) return s.replace(/^Mozilla\/5\.0 ?/, '').slice(0, 40) || '-'; // 모르는 원문은 앞 40자(시험 도구 등)
  return [br.trim(), os].filter(Boolean).join(' · ');
}
