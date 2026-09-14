// ============================================================
// 装配：渲染器 / 场景 / 灯光 / 世界组 / 各模块 / 导演 / 调参面板 / 主循环
//
// 分层视图：
//   Director（流程编排）→ 调接口：claw / rig / mask / CONFIG / lights
//   机器生成实验 → 换实现：machineShell.js / clawMachine 内部视觉
//   两条线互不接触。
// ============================================================
import * as THREE from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { CONFIG } from './config.js';
import { spawnPool, upgradeVisuals, tickUpgrades } from './prizePool.js';
import { ClawMachine } from './clawMachine.js';
import { CameraRig } from './cameraRig.js';
import { FrameMask } from './frameMask.js';
import { Post } from './post.js';
import { Input } from './input.js';
import { buildMachineShell } from './machineShell.js';
import { Director } from './director.js';
import { DEFAULT_HINT } from './acts.js';

// —— 渲染器 ——
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0d);

const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.1, 60);

// —— 灯光：记忆层的"暖"（终幕转冷）——
const hemi = new THREE.HemisphereLight(0xfff2dd, 0x191a20, 0.55);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe7c4, 1.1);
key.position.set(2.5, 4, 3);
scene.add(key);
const glow = new THREE.PointLight(0xffd9a0, 10, 7, 1.8);
glow.position.set(0, 1.7, 0.4);
scene.add(glow);

// —— 世界组：机器 + 奖池 + 爪（终幕整组隐藏，切实景）——
const world = new THREE.Group();
scene.add(world);
buildMachineShell(world);
const items = spawnPool(world);
// manifest 有 GLB 的：预编译后逐个弹出热替换；进度喂给加载画面
const prizesReady = upgradeVisuals(world, items, renderer, camera, (d, t) => {
  prizeDone = d; prizeTotal = t; paintLoading();
});

// —— 爪机 ——
let director;   // 前向声明：claw 的 hooks 里闭包引用
const claw = new ClawMachine(world, items, {
  onMessage: (t) => director?.msg(t),
  onCollect: (item) => {
    const el = document.getElementById('collected');
    el.textContent = +el.textContent + 1;
    director?.notify('collect', item);
  },
});
const clawReady = claw.upgradeClawVisual(renderer, camera)   // AI 分件爪热替换（失败回退 procedural）
  .then(() => { clawLoaded = true; paintLoading(); });

// —— 镜头 / 画幅 / 后处理 / 输入 ——
const rig = new CameraRig(camera);
const mask = new FrameMask();
const post = new Post(renderer, scene, camera);
post.setSize(innerWidth, innerHeight);
const input = new Input();

window.addEventListener('framechange', (e) => {
  if (CONFIG.frame.fisheyeFadeOnWide) post.setFisheyeFade(e.detail === 'wide' ? 0 : 1);
});

// —— 终幕实景（占位版：冷调废墟角落 + 压扁的罐头；正式版换生成的实景资产）——
function onReveal() {
  world.visible = false;
  key.color.set(0x8ea6c2); key.intensity = 0.5;
  hemi.intensity = 0.22;
  glow.visible = false;
  scene.fog = new THREE.Fog(0x05060a, 3.5, 13);

  const g = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  g.add(ground);

  const squashed = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.028, 16),
    new THREE.MeshStandardMaterial({ color: 0x7a5238, roughness: 0.8, metalness: 0.5 }));
  squashed.position.set(0.25, 0.014, 0.9);
  g.add(squashed);

  const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x191b1f, roughness: 1 });
  for (const [x, y, z, s] of [[-0.9, 0.16, 0.2, 0.5], [0.8, 0.22, -0.3, 0.7], [-0.3, 0.12, 1.4, 0.4]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.6, s * 0.7), rubbleMat);
    b.position.set(x, y, z);
    b.rotation.y = Math.random() * 3;
    g.add(b);
  }
  scene.add(g);
}

// —— 导演（流程编排中枢）——
director = new Director({
  mask, claw, rig,
  lights: { key, glow, hemi },
  hooks: { onReveal },
});

// —— 输入接线（带幕间权限闸）——
input.on('drop', () => { if (director.allow('drop')) claw.startDrop(); });
input.on('view', (v) => { if (director.allow('view')) { rig.setView(v); director.notify('view', v); } });
input.on('cycle', (d) => { if (director.allow('view')) { rig.cycle(d); director.notify('view', rig.cur); } });
input.on('next', () => director.skip());
// 近/远取景切换：仅居中画幅幕开放（一幕右布局用 far 会穿帮）
input.on('frameMode', () => { if (director.act?.layout === 'center') mask.toggleViewMode(); });
input.on('toggleFrame', () => mask.toggle(true));
input.on('hardCut', () => mask.hardCut());

// —— 调参面板（H 切换显隐；画幅按钮是调试入口，正常流程由导演接管）——
const gui = new GUI({ title: '爪机手感调参' });
{
  const f = gui.addFolder('移动惯性');
  f.add(CONFIG.claw, 'moveSpeed', 0.5, 4, 0.05);
  f.add(CONFIG.claw, 'moveTau', 0.02, 0.25, 0.005).name('moveTau(稳定≈2τ)');

  const d = gui.addFolder('落爪时序');
  d.add(CONFIG.claw, 'dropSpeed', 0.5, 5, 0.05);
  d.add(CONFIG.claw, 'liftSpeed', 0.3, 3, 0.05);
  d.add(CONFIG.claw, 'closeDelay', 0, 0.6, 0.01);
  d.add(CONFIG.claw, 'closeDuration', 0.1, 1, 0.01);

  const g = gui.addFolder('爪力 / 滑落（导演按幕覆盖）');
  g.add(CONFIG.claw, 'gripStrength', 0, 1, 0.01).listen();
  g.add(CONFIG.claw, 'baseSlipProb', 0, 1, 0.01);
  g.add(CONFIG.claw, 'grabRadius', 0.15, 0.5, 0.01);
  g.add(CONFIG.claw, 'wobbleAmp', 0, 0.06, 0.001);

  const c = gui.addFolder('镜头');
  c.add(CONFIG.camera, 'fov', 60, 100, 1);
  c.add(CONFIG.camera, 'tau', 0.1, 1, 0.01).name('切换tau');
  c.add(CONFIG.camera, 'breathDeg', 0, 0.6, 0.01);

  const p = gui.addFolder('后处理');
  p.add(CONFIG.post, 'k1', -0.2, 0.3, 0.005);
  p.add(CONFIG.post, 'k2', 0, 0.2, 0.005);
  p.add(CONFIG.post, 'grain', 0, 0.15, 0.005).listen();
  p.add(CONFIG.post, 'vignette', 0, 1, 0.05);

  const act = {
    '跳过当前幕(N)': () => director.skip(),
    '凑近/站远(V)': () => mask.toggleViewMode(),
    '右布局(一幕)': () => mask.setLayout('right'),
    '居中(二~四幕)': () => mask.setLayout('center'),
    '展开16:9': () => mask.setLayout('wide'),
  };
  for (const k of Object.keys(act)) gui.add(act, k);
}
let guiOn = true;
input.on('gui', () => { guiOn = !guiOn; gui.show(guiOn); });

// —— 调试钩子（控制台/自动化用）——
window.__debug = { claw, rig, director, mask, items, CONFIG };

// 取景绑定：投影平移把机器中心钉在画幅中心（移轴式偏移，无放大、无畸变、与窗口宽度无关），
// near/far 只是变焦倍率差（nearZoom）。偏移量与倍率都走阻尼 → 转场/切换全部平滑。
// far 时偏移=0 → 严格等于首版"全窗取景 + clip 裁切"构图。
let modeBlend = mask.viewMode === 'near' ? 1 : 0;   // 0=far 站远 / 1=near 凑近
const viewRect = { ...mask.getRect() };             // 阻尼后的画幅矩形（px）
function applyViewRect() {
  const dx = (viewRect.x + viewRect.w / 2 - innerWidth / 2) * modeBlend;
  const dy = (viewRect.y + viewRect.h / 2 - innerHeight / 2) * modeBlend;
  // 全幅 viewOffset + 负偏移 = 投影平移：画面内容跟随画幅，机器始终落在画幅中心
  camera.setViewOffset(innerWidth, innerHeight, -dx, -dy, innerWidth, innerHeight);
  post.setCenter((viewRect.x + viewRect.w / 2) / innerWidth, 1 - (viewRect.y + viewRect.h / 2) / innerHeight);
  rig.setModeZoom(1 + (CONFIG.frame.nearZoom - 1) * modeBlend);
}
applyViewRect();

// —— 加载闸门：GLB 全部就位后才开演（线上 48MB 走网络，避免演到一半"变装"）——
const loadingEl = document.getElementById('loading');
const loadFill = document.getElementById('loadFill');
let prizeDone = 0, prizeTotal = 1, clawLoaded = false;
const paintLoading = () => {
  const frac = (prizeDone + (clawLoaded ? 1 : 0)) / (prizeTotal + 1);
  loadFill.style.width = (frac * 100 | 0) + '%';
};
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  loadingEl.classList.add('done');
  setTimeout(() => loadingEl.remove(), 800);
  director.start();
}
Promise.allSettled([prizesReady, clawReady]).then(boot);
setTimeout(boot, 30000);   // 兜底：30 秒无论如何开演（个别资产失败不应卡死）

// —— 主循环 ——
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // 画幅位/取景模式阻尼跟踪（转场与近远切换过程中逐帧收敛）
  const cur = mask.getRect();
  const a = 1 - Math.exp(-dt / 0.28);
  viewRect.x += (cur.x - viewRect.x) * a;
  viewRect.y += (cur.y - viewRect.y) * a;
  viewRect.w += (cur.w - viewRect.w) * a;
  viewRect.h += (cur.h - viewRect.h) * a;
  modeBlend += ((mask.viewMode === 'near' ? 1 : 0) - modeBlend) * a;
  applyViewRect();

  const ax = input.axis();
  claw.move(ax.x, ax.z, dt);
  claw.update(dt, t);
  rig.update(dt, t);
  tickUpgrades(dt);
  post.render(dt, t);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  Object.assign(viewRect, mask.getRect());   // 窗口变化时直接对齐，不做阻尼
  modeBlend = mask.viewMode === 'near' ? 1 : 0;
  // 画幅遮罩在 frameMask 内自行监听 resize
});
