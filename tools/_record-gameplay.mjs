// 实机录屏 v2：第三幕配额关自由抓取（核心玩法为主）
// CDP Page.startScreencast 抓帧 → 按真实时间轴编码 mp4（偶数尺寸缩放修 libx264）
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? '.shots/gameplay-demo.mp4';
const RECORD_MS = Number(process.argv[3] ?? 42000);
const ACT = process.argv[4] ?? '3';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9374;
const profile = mkdtempSync(join(tmpdir(), 'dsh-rec4-'));
const framesDir = join(tmpdir(), 'dsh-frames4');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const args = [
  '--headless=new', '--no-sandbox', '--disable-extensions', '--no-first-run',
  '--disable-sync', '--disable-default-apps', '--mute-audio',
  '--enable-gpu', '--use-angle=d3d11', '--enable-features=Vulkan',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1920,1080', '--hide-scrollbars',
  `http://127.0.0.1:8000/?act=${ACT}`,
];
const chrome = spawn(CHROME, args, { stdio: 'ignore' });

async function findWs() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.url.includes('127.0.0.1:8000'));
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error('no target');
}

const wsUrl = await findWs();
const frames = [];
const conn = await new Promise((resolve, reject) => {
  const s = new WebSocket(wsUrl);
  const pending = new Map();
  let id = 0;
  s.onopen = () => resolve({
    send(m, p = {}) {
      const i = ++id;
      return new Promise((res, rej) => {
        pending.set(i, { res, rej });
        s.send(JSON.stringify({ id: i, method: m, params: p }));
        setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(m + ' timeout')); } }, 120000);
      });
    },
    close: () => s.close(),
  });
  s.onerror = () => reject(new Error('ws fail'));
  s.onmessage = (m) => {
    const g = JSON.parse(m.data);
    if (g.id != null) {
      const p = pending.get(g.id);
      pending.delete(g.id);
      if (g.error) p?.reject(new Error(g.error.message));
      else p?.res(g.result);
    } else if (g.method === 'Page.screencastFrame') {
      frames.push({ data: g.params.data, t: Date.now(), sessionId: g.params.sessionId });
      s.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: g.params.sessionId } }));
    }
  };
});

await conn.send('Runtime.enable');
await conn.send('Page.enable');
const evaluate = async (expr) => {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
const keySyn = async (type, code, k) => {
  await evaluate(`window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', key: '${k}', bubbles: true }))`);
};
const hold = async (code, k, ms) => { await keySyn('keydown', code, k); await sleep(ms); await keySyn('keyup', code, k); };
const tap = async (code, k) => { await keySyn('keydown', code, k); await sleep(60); await keySyn('keyup', code, k); };
const dismissPanels = async () => {
  await evaluate(`(() => { let n = 0; document.querySelectorAll('.panel.await-continue').forEach(p => { p.click(); n++; }); return n; })()`);
};

// —— 进游戏 + 过intro到可交互 ——
for (let i = 0; i < 120; i++) {
  if (await evaluate('!!(window.__boot && window.__boot.loadReady)')) break;
  await sleep(500);
}
await evaluate(`(() => { const b = document.querySelector('#loadStart'); if (b && !b.hidden) b.click(); return 1; })()`);
for (let i = 0; i < 80; i++) {
  const ok = await evaluate(`!!(window.__debug && window.__debug.director && window.__debug.director.interactive)`);
  if (ok) break;
  await dismissPanels();
  await tap('KeyN', 'n');
  await sleep(900);
}
console.log('interactive, act =', await evaluate(`window.__debug?.director?.act?.id ?? '?'`));

console.log('pre-record state:', await evaluate(`JSON.stringify({ boot: window.__boot, errs: (window.__errs||[]).slice(0,3), interactive: !!(window.__debug && window.__debug.director && window.__debug.director.interactive) })`));

// —— 开录 ——
await conn.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
console.log('screencast started');

// —— 脚本化自由抓取：移动→下爪→等抓取回收→换位置→再下爪，偶尔切视角 ——
const t0 = Date.now();
const moves = [
  ['ArrowRight', 'ArrowRight', 1400], ['ArrowDown', 'ArrowDown', 600], null,
  ['ArrowLeft', 'ArrowLeft', 1500], ['ArrowUp', 'ArrowUp', 700], null,
  ['ArrowRight', 'ArrowRight', 800], ['KeyQ', 'q', 0], null,
  ['ArrowLeft', 'ArrowLeft', 1200], ['ArrowDown', 'ArrowDown', 500], null,
  ['ArrowRight', 'ArrowRight', 1600], ['KeyE', 'e', 0], null,
  ['ArrowLeft', 'ArrowLeft', 900], ['ArrowUp', 'ArrowUp', 800], null,
];
let mi = 0;
while (Date.now() - t0 < RECORD_MS) {
  await dismissPanels();
  const mv = moves[mi % moves.length];
  mi++;
  if (mv === null) {
    await tap('Space', ' ');            // 下爪
    await sleep(4500);                  // 下爪-抓取-回收
    await tap('KeyQ', 'q'); await sleep(300); await tap('KeyE', 'e');
  } else {
    await hold(mv[0], mv[1], mv[2]);
  }
  await sleep(400);
}

await conn.send('Page.stopScreencast');
await sleep(400);
console.log(`frames: ${frames.length}`);

// —— 落盘 + 真实时间轴编码（偶数尺寸）——
for (let i = 0; i < frames.length; i++) {
  writeFileSync(join(framesDir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(frames[i].data, 'base64'));
}
const concat = [];
for (let i = 0; i < frames.length; i++) {
  const dur = i < frames.length - 1 ? Math.max((frames[i + 1].t - frames[i].t) / 1000, 0.02) : 0.1;
  concat.push(`file 'f${String(i).padStart(5, '0')}.jpg'\nduration ${dur.toFixed(3)}`);
}
concat.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
writeFileSync(join(framesDir, 'concat.txt'), concat.join('\n'));

await new Promise((resolve, reject) => {
  const ff = spawn('ffmpeg', ['-y', '-v', 'error',
    '-f', 'concat', '-safe', '0', '-i', join(framesDir, 'concat.txt'),
    '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,hqdn3d=1.8:1.8:7:7,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17',
    '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  ff.on('close', c => c === 0 ? resolve() : reject(new Error('ffmpeg exit ' + c)));
});

rmSync(framesDir, { recursive: true, force: true });
console.log('saved', OUT);
conn.close();
chrome.kill();
process.exit(0);
