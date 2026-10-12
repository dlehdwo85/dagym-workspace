/** 입력창의 "@이름" 을 서버 표기 "@[이름](id)" 로 바꾼다. 고른 사람만 변환하고, 지운 멘션은 무시한다. */
export function encodeMentions(text: string, picked: { id: string; name: string }[]) {
  let out = text;
  for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`@${esc}(?![\\w가-힣\\]])`, 'g'), `@[${p.name}](${p.id})`);
  }
  return out;
}
