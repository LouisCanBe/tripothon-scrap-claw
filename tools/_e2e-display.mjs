// 副屏验收：开主屏 + 副屏两个 tab，模拟一次出货，点「揭晓」，看模型与文案真的翻面。
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9388;
const profile = mkdtempSync(join(tmpdir(), 'dsh-display-'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
const ok = (n, pass, d = '') => { results.push({ n, pass, d }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-extensions', '--no-first-run',
  '--disable-sync', '--disable-default-apps', '--mute-audio',
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1280,800', `${BASE}/display.html`,
], { stdio: 'ignore' });

async function targets() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const pages = list.filter(t => t.type === 'page' && t.url.startsWith(BASE));
      if (pages.length) return pages;
    } catch { /* booting */ }
    await sleep(300);
  }
  throw new Error('no target');
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map(); const handlers = []; let id = 0;
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  ws.onmessage = (m) => {
    const g = JSON.parse(m.data);
    if (g.id != null) { const p = pending.get(g.id); pending.delete(g.id); g.error ? p?.rej(new Error(g.error.message)) : p?.res(g.result); }
    else handlers.forEach(h => h(g));
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(method + ' timeout')); } }, 120000);
  });
  return { send, onEvent: (h) => handlers.push(h), close: () => ws.close() };
}

const list = await targets();
const displayTarget = list.find(t => t.url.includes('display.html'));
if (!displayTarget) throw new Error('没找到副屏 tab：' + JSON.stringify(list.map(t => t.url)));

// 主屏：用浏览器根连接 createTarget 开第二个 tab，然后连**它自己的 ws**（不走 session 路由）
const rootWs = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
const rootConn = await attach(rootWs);
const created = await rootConn.send('Target.createTarget', { url: `${BASE}/?act=2` });
let mainTarget = null;
for (let i = 0; i < 60; i++) {
  const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  mainTarget = l.find(t => t.id === created.targetId);
  if (mainTarget?.webSocketDebuggerUrl) break;
  await sleep(400);
}
if (!mainTarget) throw new Error('主屏 tab 没建起来');

const dConn = await attach(displayTarget.webSocketDebuggerUrl);
await dConn.send('Runtime.enable');
const dEval = async (expr) => {
  const r = await dConn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

const mConn = await attach(mainTarget.webSocketDebuggerUrl);
await mConn.send('Runtime.enable');
const mEval = async (expr) => {
  const r = await mConn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

// 等主屏开演（新 tab 刚建时 evaluate 可能打到旧执行上下文，用 try 兜住）
for (let i = 0; i < 300; i++) {
  try {
    if (await mEval('!!(window.__debug && window.__boot && window.__boot.booted)')) break;
  } catch { /* navigating / 旧上下文 */ }
  await sleep(500);
}
const mainReady = await mEval('!!(window.__debug && window.__boot && window.__boot.booted)').catch(() => false);
ok('主屏 tab 已开演', mainReady === true);
console.log('main booted =', mainReady);
await sleep(1500);

// 副屏应有揭晓按钮的 DOM
const hasBtn = await dEval("!!document.getElementById('revealBtn')");
ok('副屏有「揭晓」按钮的 DOM', hasBtn === true);

// 真抓一件（面包），走会 publish 的那条路径
const grab = await mEval(`(async () => {
  const d = __debug, claw = d.claw, C = d.CONFIG.claw;
  const clampX = v => Math.min(C.boundsX[1], Math.max(C.boundsX[0], v));
  const clampZ = v => Math.min(C.boundsZ[1], Math.max(C.boundsZ[0], v));
  const it = d.items.find(i => i.id === 'bread');
  const t0 = performance.now();
  while (performance.now() - t0 < 120000) {
    if (it.state === 'collected') return 'collected';
    if (claw.state === 0) {
      claw.target.x = clampX(it.mesh.position.x);
      claw.target.y = clampZ(it.mesh.position.z);
      if (Math.hypot(claw.rig.position.x - it.mesh.position.x, claw.rig.position.z - it.mesh.position.z) < 0.05) {
        d.CONFIG.claw.forceGrip = true; claw.startDrop();
      }
    }
    await new Promise(r => requestAnimationFrame(r));
  }
  return 'timeout ' + it.state;
})()`);
console.log('main grab:', grab);
ok('主屏真的抓了一件（会 publish collect.vended）', grab === 'collected', grab);

// 副屏应该收到并展出
let shown = null;
for (let i = 0; i < 120; i++) {
  const s = JSON.parse(await dEval(`JSON.stringify({
    name: document.getElementById('prizeName').textContent,
    meta: document.getElementById('prizeMeta').textContent,
    btnHidden: document.getElementById('revealBtn').hidden,
    btnText: document.getElementById('revealBtn').textContent,
    ctaHidden: document.getElementById('cta').hidden,
    hasStage: !!document.querySelector('#stage canvas'),
  })`));
  if (s.name && s.name !== '等待出货…') { shown = s; break; }
  await sleep(800);
}
console.log('display shown:', JSON.stringify(shown));
ok('副屏收到出货并展出了', !!shown, JSON.stringify(shown ?? {}));
ok('副屏标题显示"他以为的"名字（面包）', shown?.name === '面包', shown?.name);
ok('副屏默认不显示真相（meta 里没有 truthName）',
  !!shown && !shown.meta.includes('发霉'), shown?.meta);
ok('面粉这件有独立败露模型 → 揭晓按钮可用', shown?.btnHidden === false, JSON.stringify(shown));

// 点揭晓
const clickRes = await dEval(`(async () => {
  const btn = document.getElementById('revealBtn');
  btn.click();
  await new Promise(r => setTimeout(r, 4000));
  return JSON.stringify({
    name: document.getElementById('prizeName').textContent,
    meta: document.getElementById('prizeMeta').textContent,
    btnText: btn.textContent,
    revealed: btn.classList.contains('revealed'),
    ctaHidden: document.getElementById('cta').hidden,
  });
})()`);
console.log('after reveal:', clickRes);
const after = JSON.parse(clickRes);
ok('点「揭晓」后标题翻成真相（发霉面包）', after.name === '发霉面包', after.name);
ok('文案翻成败露态', after.meta.includes('败露态'), after.meta);
ok('按钮变成「放回去」并可复位', after.revealed === true && after.btnText.includes('放'), clickRes);
ok('揭晓之后才放出动销位', after.ctaHidden === false, String(after.ctaHidden));

// 再点一次放回去
const backRes = await dEval(`(async () => {
  document.getElementById('revealBtn').click();
  await new Promise(r => setTimeout(r, 4000));
  return JSON.stringify({
    name: document.getElementById('prizeName').textContent,
    btnText: document.getElementById('revealBtn').textContent,
  });
})()`);
console.log('after restore:', backRes);
const back = JSON.parse(backRes);
ok('再点一次能放回显形态', back.name === '面包' && back.btnText.includes('揭'), backRes);

console.log('\n=== 汇总 ===');
const failed = results.filter(r => !r.pass);
console.log(`${results.length - failed.length}/${results.length} 通过`);
failed.forEach(f => console.log('  FAIL ' + f.n + ' -- ' + f.d));
dConn.close(); mConn.close();
chrome.kill();
process.exit(failed.length ? 1 : 0);
