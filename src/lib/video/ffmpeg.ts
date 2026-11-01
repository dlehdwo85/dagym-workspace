import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #454 서버 영상 합성용 ffmpeg 실행기.
 * 위치: FFMPEG_PATH → ffmpeg-static(npm 설치 때 받은 정적 빌드, next.config 의 outputFileTracingIncludes 로 합성 함수에만 실림) → PATH 의 ffmpeg.
 * 정적 빌드(7.x)는 libass·x264·mp3lame 이 있고 drawtext 는 없다 → 글자는 ASS 자막으로 그린다. ffprobe 는 없어서 길이는 `-i` 출력에서 읽는다.
 */
let bin: string | null = null;
export function ffmpegPath() {
  if (bin) return bin;
  const cands = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].filter((x): x is string => !!x);
  bin = cands.find((p) => existsSync(p)) ?? 'ffmpeg';
  return bin;
}

type Run = { code: number; stderr: string; killed?: boolean };
type RunOpt = { cwd?: string; timeoutMs?: number; env?: Record<string, string> };
function spawnOnce(path: string, args: string[], opt: RunOpt): Promise<Run> {
  return new Promise((ok, fail) => {
    const p = spawn(path, args, { cwd: opt.cwd, stdio: ['ignore', 'ignore', 'pipe'], env: opt.env ? { ...process.env, ...opt.env } : undefined });
    let err = ''; let killed = false;
    p.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-20000); });
    const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, opt.timeoutMs ?? 240_000); // 324차: 시간 제한으로 끊은 것(종료 코드 null → -1)을 구분
    p.on('error', (e) => { clearTimeout(timer); fail(e); });
    p.on('close', (code) => { clearTimeout(timer); ok({ code: code ?? -1, stderr: err, killed }); });
  });
}
/** 실행(종료 코드와 stderr 끝부분). 배포 번들에서 실행 권한이 빠졌으면(EACCES) /tmp 로 복사해 권한을 주고 한 번 더 */
export async function ffmpegRun(args: string[], opt: RunOpt = {}): Promise<Run> {
  const path = ffmpegPath();
  try { return await spawnOnce(path, ['-hide_banner', '-nostdin', ...args], opt); } catch (e: any) {
    if (e?.code !== 'EACCES' || path === 'ffmpeg') throw new Error(`ffmpeg 를 실행할 수 없습니다(${e?.code ?? e?.message ?? e})`);
    const tmp = '/tmp/ffmpeg-bin'; copyFileSync(path, tmp); chmodSync(tmp, 0o755); bin = tmp;
    return spawnOnce(tmp, ['-hide_banner', '-nostdin', ...args], opt);
  }
}
/** 실패하면 오류 마지막 줄들을 담아 던진다(글꼴 경고 같은 잡음은 뺌) */
export async function ffmpegOk(args: string[], opt: RunOpt = {}) {
  const r = await ffmpegRun(['-y', '-loglevel', 'error', ...args], opt);
  if (r.code !== 0) {
    // 324차(로컬 11/02 a132740e: 'Failed to load fon(c)tconfig fonts' 만 남고 -1): 시간 제한으로 끊긴 것은 그렇게 말하고, 글꼴 설정 경고는 잡음이라 뺌
    const tail = r.stderr.split('\n').filter((l) => l.trim() && !/fon[ct]+config|memory font/i.test(l)).slice(-4).join(' / ');
    if (r.killed) throw new Error(`영상 합성 실패(시간 제한 ${Math.round((opt.timeoutMs ?? 240_000) / 1000)}초 안에 끝나지 않아 중단 — 장면·사진 수를 줄이거나 다시 시도)${tail ? `: ${tail.slice(0, 200)}` : ''}`);
    throw new Error(`영상 합성 실패(ffmpeg ${r.code}): ${tail.slice(0, 400)}`);
  }
  return r;
}
/** 파일 길이(초)·소리 유무 — `ffmpeg -i` 의 머리말에서 읽음(ffprobe 없음) */
export async function mediaInfo(file: string): Promise<{ duration: number | null; audio: boolean; video: boolean; width: number | null; height: number | null }> {
  const r = await ffmpegRun(['-i', file], { timeoutMs: 30_000 });
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
  const v = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(r.stderr);
  return { duration: m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null, audio: /Stream #[^\n]*Audio:/.test(r.stderr), video: !!v, width: v ? +v[1] : null, height: v ? +v[2] : null };
}
