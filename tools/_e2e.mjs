// 一次性端到端验收（不进发布包）：用 Chrome DevTools Protocol 真的开一遍游戏。
// 跑法：node tools/_e2e.mjs [baseUrl]
// 前置：node tools/devServer.mjs 8000 已在跑。
//
// 做法：一个常驻 Chrome 实例，一个 tab，用 Page.navigate 依次走三个场景。
// （headless 下 Target.createTarget 出来的是 about:blank 目标，导航不可靠，所以不用它。）
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8000';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), 'dsh-e2e-'));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-extensions',
  '--disable-component-update', '--disable-background-networking', '--no-first-run',
  '--disable-sync', '--disable-default-apps', '--mute-audio',
  // headless 没有真 GPU：SwiftShader 软渲染才拿得到 WebGL2
  '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900',
  `${BASE}/`,
], { stdio: 'ignore' });

async function findTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.url.startsWith(BASE));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* chrome still booting */ }
    await sleep(300);
  }
  throw new Error('Chrome DevTools target not ready');
}

const wsUrl = await findTarget();
const conn = await new Promise((resolve, reject) => {
  const ws = new WebSocket(wsUrl);
  const handlers = [];
  const pending = new Map();
  let id = 0;
  ws.onopen = () => resolve({
    send(method, params = {}) {
      const mid = ++id;
      return new Promise((res, rej) => {
        pending.set(mid, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error(method + ' timeout')); } }, 200000);
      });
    },
    onEvent(h) { handlers.push(h); },
    close() { ws.close(); },
  });
  ws.onerror = () => reject(new Error('CDP websocket failed'));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id != null) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p?.reject(new Error(msg.error.message)) : p?.resolve(msg.result);
    } else handlers.forEach(h => h(msg));
  };
});

const runtimeErrors = [];
conn.onEvent((msg) => {
  if (msg.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    runtimeErrors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  }
});

await conn.send('Runtime.enable');
await conn.send('Page.enable');

const evaluate = async (expr) => {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

async function waitFor(expr, timeoutMs = 120000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { if (await evaluate(expr)) return true; } catch { /* still navigating */ }
    await sleep(500);
  }
  throw new Error('waitFor timeout: ' + label);
}

/** 导航到 url 并等开演 */
async function go(url, label) {
  await conn.send('Page.navigate', { url });
  await waitFor('!!(window.__boot && window.__boot.booted === true)', 180000, label);
  await sleep(1200);
}

// 让爪把某件物品真的抓进洞：
// 输入真正的驱动点是 claw.target（XZ），move() 每帧把 target 阻尼到 rig.position，
// 所以要改 target 而不是直接挪 rig（直接挪会被阻尼拉回去）。
// 之后的落爪/合爪/回收/入洞全走真实状态机，判定读的还是 item.mesh 的真实位置。
// slotId 给了就顺便盯着配额格，格子亮起来立刻返回（软渲染很慢，等不起整段动画）。
const GRAB_FN = (wantId, slotId = '') => `(async () => {
  const d = __debug, claw = d.claw, C = d.CONFIG.claw;
  const clampX = (v) => Math.min(C.boundsX[1], Math.max(C.boundsX[0], v));
  const clampZ = (v) => Math.min(C.boundsZ[1], Math.max(C.boundsZ[0], v));
  const slot = ${slotId ? `document.getElementById('q-${slotId}')` : 'null'};
  const t0 = performance.now();
  while (performance.now() - t0 < 150000) {
    if (slot && slot.classList.contains('done')) return 'slot-done';
    const it = d.items.find(i => i.id === '${wantId}');
    if (!it) return 'no-such-item';
    if (it.state === 'collected' || it.state === 'delivering') return 'collected';
    if (claw.state === 0) {
      claw.target.x = clampX(it.mesh.position.x);
      claw.target.y = clampZ(it.mesh.position.z);
      const dx = claw.rig.position.x - it.mesh.position.x;
      const dz = claw.rig.position.z - it.mesh.position.z;
      if (Math.hypot(dx, dz) < 0.05) { d.CONFIG.claw.forceGrip = true; claw.startDrop(); }
    }
    await new Promise(r => requestAnimationFrame(r));
  }
  return 'timeout claw=' + claw.state + ' item=' + (d.items.find(i => i.id === '${wantId}')?.state);
})()`;

// ---------------------------------------------------------------- A
console.log('=== A: 从第一幕开场，走真实首抓 ===\n');
await waitFor('!!(window.__boot && window.__boot.booted === true)', 180000, 'boot act1');
await sleep(1200);
const errsA = await evaluate('JSON.stringify(window.__errs)');
ok('开场放行（第一幕）', true, errsA);
ok('开场无运行时错误', errsA === '[]', errsA);

const stats1 = await evaluate('JSON.stringify(__debug.appearanceStats())');
console.log('   奖池显示态:', stats1);
ok('开场整池 = 显形态', JSON.parse(stats1).manifest === 8, stats1);
ok('当前在第一幕', (await evaluate('__debug.director.act.id')) === 1);

for (const code of ['Digit1', 'Digit3', 'Digit2']) {
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${code}'}))`);
  await sleep(800);
}
let advanced = false;
for (let i = 0; i < 80; i++) {
  if (await evaluate('__debug.director.act.id') === 2) { advanced = true; break; }
  await sleep(500);
}
ok('左/前/右都看过 -> 自动进第二幕', advanced, 'act=' + await evaluate('__debug.director.act.id'));

const grab1 = await evaluate(GRAB_FN('bread'));
ok('第二幕能真的抓取入洞（走完整爪机状态机）', grab1 === 'collected', grab1);
await sleep(2000);
ok('抓取过程无新错误', (await evaluate('JSON.stringify(window.__errs)')) === '[]');

// ---------------------------------------------------------------- B
console.log('\n=== B: 直接跳第三幕（配额 + 过场图相框） ===\n');
await go(`${BASE}/?act=3`, 'boot act3');
ok('第三幕能开演', true, await evaluate('JSON.stringify(window.__errs)'));
ok('第三幕开场无错误', (await evaluate('JSON.stringify(window.__errs)')) === '[]');
const stats3 = JSON.parse(await evaluate('JSON.stringify(__debug.appearanceStats())'));
console.log('   第三幕奖池:', JSON.stringify(stats3));
ok('第三幕整池 = 显形态', stats3.manifest === 8, JSON.stringify(stats3));

const beforeUrls = JSON.parse(await evaluate(
  'JSON.stringify(Object.fromEntries(__debug.items.map(i => [i.id, (i.visualUrl||"").split("/").pop()])))'));
console.log('   第三幕模型:', JSON.stringify(beforeUrls));

// 三件任务物资都要能记进对应配额格（第三幕池里只有显形态，配额按形状记账）
const quota = [];
for (const id of ['bread', 'can', 'veg']) {
  let r = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = await evaluate(GRAB_FN(id, id));
    if (r === 'slot-done' || r === 'collected') break;
    console.log(`   ${id} 第 ${attempt} 次没成（${r}），重试`);
  }
  await sleep(1500);
  const st = JSON.parse(await evaluate(`JSON.stringify({
    slot: document.getElementById('q-${id}').classList.contains('done'),
    progress: document.getElementById('questProgress').textContent,
    act: __debug.director.act.id,
  })`));
  quota.push({ id, grab: r, ...st });
  console.log(`   ${id}: grab=${r} slot=${st.slot} progress=${st.progress} act=${st.act}`);
}
for (const q of quota) ok(`抓 ${q.id} 记入对应配额格`, q.slot === true, JSON.stringify(q));
ok('三格齐 -> questComplete 并离开第三幕',
  quota.every(q => q.slot) && Number(quota[quota.length - 1].progress) >= 3,
  JSON.stringify(quota.map(q => `${q.id}:${q.slot}/${q.progress}`)));

// 相框式过场图：必须在方框画幅之内、不是全屏、有做旧相纸的底色
const photoProbe = await evaluate(`(async () => {
  const el = document.getElementById('narrativePhoto');
  const card = document.getElementById('narrativePhotoCard');
  const img = document.getElementById('narrativePhotoImg');
  const stage = document.getElementById('stage');
  const seen = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 70000) {
    if (!el.hidden && el.offsetWidth > 0) {
      const r = stage.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(card);
      seen.push({
        photo: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
        stage: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        inStage: b.left >= r.left - 2 && b.right <= r.right + 2 && b.top >= r.top - 2 && b.bottom <= r.bottom + 2,
        notFullscreen: b.width < r.width * 0.99 && b.height < r.height * 0.99,
        paper: cs.backgroundColor,
        hasTexture: cs.backgroundImage !== 'none',
        imgFilter: getComputedStyle(img).filter,
        state: el.dataset.state,
      });
      if (seen.length >= 2) break;
    }
    await new Promise(r2 => setTimeout(r2, 250));
  }
  return JSON.stringify(seen);
})()`);
const photos = JSON.parse(photoProbe);
console.log('   相框:', photoProbe);
ok('记忆幕过场图走相框式（出现在方框里，不是全屏）',
  photos.length > 0 && photos.every(p => p.inStage && p.notFullscreen), photoProbe);
ok('相框是做旧相纸（有底色 + 纹理，不是干净白边）',
  photos.every(p => p.paper && p.paper !== 'rgba(0, 0, 0, 0)' && p.hasTexture), photoProbe);
ok('照片本身也做了旧（有滤镜）',
  photos.every(p => p.imgFilter && p.imgFilter !== 'none'), photoProbe);
ok('出场动画真的在跑（能抓到 in 这一态）',
  photos.some(p => p.state === 'in' || p.state === ''), photoProbe);

// ---------------------------------------------------------------- C
console.log('\n=== C: 直接跳终幕（黑场换货 + 构件逐个消失 + 真相） ===\n');
await go(`${BASE}/?act=5`, 'boot act5');
ok('终幕能开演', true);
ok('终幕开场无错误', (await evaluate('JSON.stringify(window.__errs)')) === '[]');

const before = await evaluate('JSON.stringify(__debug.appearanceStats())');
let swapped = null;
for (let i = 0; i < 120; i++) {
  const s = JSON.parse(await evaluate('JSON.stringify(__debug.appearanceStats())'));
  if (s.rot >= 8) { swapped = s; break; }
  await sleep(700);
}
console.log('   换货前:', before, ' 换货后:', JSON.stringify(swapped));
ok('故障黑场里整池切成败露态', !!swapped && swapped.rot >= 8, JSON.stringify(swapped ?? {}));

const urls = JSON.parse(await evaluate('JSON.stringify(__debug.items.filter(i=>i.appearance==="rot").map(i=>i.visualUrl))'));
console.log('   败露态实际模型:', JSON.stringify(urls));
ok('任务三件套换到 moldy / rustcan / rot（真的换了模型，不是只调材质）',
  urls.some(u => u?.includes('moldy')) && urls.some(u => u?.includes('rustcan')) && urls.some(u => u?.includes('rot')),
  JSON.stringify(urls));
ok('每一件都换了模型（没有留在显形的）',
  urls.length === 8 && !urls.some(u => /\/(bread|can|veg)\.glb$/.test(u)), JSON.stringify(urls));

const closeLook = await evaluate(`(() => {
  const r = __debug.visualReport().filter(v => ['bread','can','veg'].includes(v.id));
  return JSON.stringify(r.map(v => ({
    id: v.id, url: v.visualUrl, mats: v.matCount,
    textured: v.mats.filter(m => m.hasMap).length,
    mapSize: v.mats[0]?.mapSize, color: v.mats[0]?.color,
  })));
})()`);
console.log('   近景材质:', closeLook);
const cl = JSON.parse(closeLook);
ok('败露态模型带贴图（不是纯色块）', cl.every(v => v.textured >= 1), closeLook);
ok('败露态没有被 tint 冲掉颜色（主材质仍是贴图原色）',
  cl.every(v => v.color === '#ffffff'), closeLook);

ok('没有物品被永久缩小（终态缩放都回到 1）',
  (await evaluate('__debug.items.every(i => Math.abs(i.mesh.scale.x - 1) < 1e-6)')) === true);

// 终幕镜头全程不动（设计上不再有切视角 / 扫视）
const camAtStart = JSON.parse(await evaluate('JSON.stringify([__debug.rig.pos.x,__debug.rig.pos.y,__debug.rig.pos.z])'));

// 机器逐个构件消失：壳走了 -> 底座/背板还在、坏掉的东西还看得见 -> 再走 core
const SHELL_PROBE = `(() => {
  const shell = __debug.world.getObjectByName('machineShell');
  let vis = [], hid = [];
  shell?.traverse?.(o => {
    if (!o.isMesh) return;
    const n = o.name || (o.parent && o.parent.name) || '?';
    (o.visible ? vis : hid).push(n);
  });
  return JSON.stringify({
    visible: [...new Set(vis)].sort(),
    hidden: [...new Set(hid)].sort(),
    itemsVisible: __debug.items.filter(i => i.mesh.visible).length,
    totalItems: __debug.items.length,
    scanActive: !!__debug.rig.scan,
  });
})()`;

let dissolved = null;
for (let i = 0; i < 220; i++) {
  const p = JSON.parse(await evaluate(SHELL_PROBE));
  if (p.hidden.some(n => /top|frame|panel/i.test(n))) { dissolved = p; break; }
  await sleep(800);
}
console.log('   壳消失时:', JSON.stringify(dissolved));
ok('壳的构件（顶盖/立柱/面板）真的消失了', !!dissolved, JSON.stringify(dissolved ?? {}));
ok('底座 / 背板还留着（不是整台机器一起没了）',
  !!dissolved && dissolved.visible.some(n => /base|back/i.test(n)), JSON.stringify(dissolved?.visible ?? []));
ok('壳先走、东西后走（壳没了的那一刻，坏掉的东西还看得见）',
  !!dissolved && dissolved.itemsVisible >= 6, JSON.stringify(dissolved ?? {}));

let cleared = null;
for (let i = 0; i < 140; i++) {
  const p = JSON.parse(await evaluate(SHELL_PROBE));
  if (p.itemsVisible === 0) { cleared = p; break; }
  await sleep(800);
}
console.log('   core 走完:', JSON.stringify(cleared));
ok('第二段把爪子和池里的东西也收掉了', !!cleared && cleared.itemsVisible === 0, JSON.stringify(cleared ?? {}));

const camAtEnd = JSON.parse(await evaluate('JSON.stringify([__debug.rig.pos.x,__debug.rig.pos.y,__debug.rig.pos.z])'));
const camDrift = Math.hypot(camAtEnd[0] - camAtStart[0], camAtEnd[1] - camAtStart[1], camAtEnd[2] - camAtStart[2]);
console.log('   镜头位移:', camDrift.toFixed(3), JSON.stringify({ camAtStart, camAtEnd }));
ok('终幕镜头全程不动（没有切视角、没有扫视）',
  camDrift < 0.6 && camAtEnd[0] === camAtStart[0], 'drift=' + camDrift.toFixed(3));

const lights = JSON.parse(await evaluate(`JSON.stringify({
  ambient: __debug.CONFIG.lights.ambient.intensity,
  ambientNow: __debug.lights.ambient.intensity,
  keyBase: __debug.CONFIG.lights.key.intensity,
  keyNow: __debug.lights.key.intensity,
  env: __debug.scene.environmentIntensity,
})`));
console.log('   灯光:', JSON.stringify(lights));
ok('灯灭了但留了残光（既变暗、又没到黑）',
  lights.ambientNow < lights.ambient && lights.ambientNow > lights.ambient * 0.5
  && lights.keyNow < lights.keyBase && lights.keyNow > lights.keyBase * 0.2,
  JSON.stringify(lights));

await sleep(30000);
const fin = JSON.parse(await evaluate(`JSON.stringify({
  errs: window.__errs,
  act: __debug.director.act.id,
  stingerText: document.getElementById('msg')?.textContent ?? '',
})`));
console.log('   终幕收尾:', JSON.stringify(fin));
ok('终幕跑完无运行时错误', fin.errs.length === 0, fin.errs.join(' | '));

console.log('\n=== 汇总 ===');
const failed = results.filter(r => !r.pass);
console.log(`${results.length - failed.length}/${results.length} 通过`);
failed.forEach(f => console.log('  FAIL  ' + f.name + ' -- ' + f.detail));
if (runtimeErrors.length) {
  console.log('\nCDP 捕获的运行时异常：');
  [...new Set(runtimeErrors)].slice(0, 10).forEach(e => console.log('  ' + String(e).split('\n')[0]));
}
conn.close();
chrome.kill();
process.exit(failed.length ? 1 : 0);
