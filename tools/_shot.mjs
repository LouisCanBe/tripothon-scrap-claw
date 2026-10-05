// 截图工具：开 headless Chrome，跑一段页面脚本，然后截图。
// 跑法：node tools/_shot.mjs <输出png> <脚本文件> [url] [脚本后等待毫秒]
// 脚本文件内容是一段 async 函数体（可用 __debug）。
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const out = process.argv[2] ?? '.shots/shot.png';
const scriptFile = process.argv[3];
const url = process.argv[4] ?? 'http://127.0.0.1:8000/';
const settleMs = Number(process.argv[5] ?? 1200);
const pageScript = scriptFile ? readFileSync(scriptFile, 'utf8') : 'return "no script";';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9366;
const profile = mkdtempSync(join(tmpdir(), 'dsh-shot-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-extensions', '--no-first-run',
  '--disable-sync', '--disable-default-apps', '--mute-audio',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', '--hide-scrollbars',
  url,
], { stdio: 'ignore' });

async function findWs() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find(t => t.type === 'page' && t.url.includes('127.0.0.1:8000'));
      if (p?.webSocketDebuggerUrl) return p.webSocketDebuggerUrl;
    } catch { /* booting */ }
    await sleep(300);
  }
  throw new Error('no target');
}

const wsUrl = await findWs();
const conn = await new Promise((resolve, reject) => {
  const s = new WebSocket(wsUrl);
  const pending = new Map(); let id = 0;
  s.onopen = () => resolve({
    send(m, p = {}) {
      const i = ++id;
      return new Promise((res, rej) => {
        pending.set(i, { res, rej });
        s.send(JSON.stringify({ id: i, method: m, params: p }));
        setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(m + ' timeout')); } }, 300000);
      });
    },
    close: () => s.close(),
  });
  s.onerror = () => reject(new Error('ws fail'));
  s.onmessage = (m) => {
    const g = JSON.parse(m.data);
    if (g.id != null) { const p = pending.get(g.id); pending.delete(g.id); g.error ? p?.rej(new Error(g.error.message)) : p?.res(g.result); }
  };
});

await conn.send('Runtime.enable');
const evaluate = async (expr) => {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

for (let i = 0; i < 400; i++) {
  if (await evaluate('!!(window.__boot && window.__boot.booted)')) break;
  await sleep(500);
}
console.log('booted');

try {
  const res = await evaluate(`(async () => { ${pageScript} })()`);
  console.log('script ->', typeof res === 'string' ? res : JSON.stringify(res));
} catch (e) {
  console.log('script FAILED:', e.message);
}

await sleep(settleMs);
const shot = await conn.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
mkdirSync(dirname(out), { recursive: true });
const bytes = Buffer.from(shot.data, 'base64');
writeFileSync(out, bytes);
console.log('saved', out, bytes.length, 'bytes');
console.log('errs', await evaluate('JSON.stringify((window.__errs ?? []).slice(0, 5))'));

conn.close();
chrome.kill();
process.exit(0);
