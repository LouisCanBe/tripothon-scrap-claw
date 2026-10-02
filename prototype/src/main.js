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
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CONFIG } from './config.js';
import { spawnPool, upgradeVisuals, tickUpgrades, enableShadows, resetAllPoolItems } from './prizePool.js';
import { ClawMachine } from './clawMachine.js';
import { CameraRig } from './cameraRig.js';
import { FrameMask } from './frameMask.js';
import { Post } from './post.js';
import { Input } from './input.js';
import { PointerControls } from './pointerControls.js';
import { OnscreenButtons } from './onscreenButtons.js';
import { DesignOverlay } from './designOverlay.js';
import { buildMachineShell } from './machineShell.js';
import { upgradeMachineShellTripo } from './machineShellTripo.js';
import { Director } from './director.js';
import { ACTS, DEFAULT_HINT } from './acts.js';
import { unlockAudio } from './gameAudio.js';
import { SceneControls, SceneControlPresets } from './sceneControls.js';
import { mountMarbleImmersive } from './revealMarble.js';
import { refreshPrizeComicFx } from './prizeComicFx.js';
import { refreshClawComicFx } from './clawComicFx.js';
import { loadPoolDevOverrides, savePoolDevOverrides, retunePoolVisualScale } from './poolDevPersist.js';
import {
  publishHoleDrop, publishVended, openCollectDisplayWindow, startCollectGamePing,
} from './collectDisplayBus.js';
import { startCollectDisplayPairPanel } from './collectDisplayPairPanel.js';
import { createSceneLights, applyRevealColdLighting, applyMemoryLighting } from './sceneLighting.js';
import { NarrativeBg } from './narrativeBg.js';
import { applyNarrativeToConfig, preloadNarrativeImages } from './narrativeAssets.js';
import { initPresent } from './present.js';

loadPoolDevOverrides();
applyNarrativeToConfig();
preloadNarrativeImages();
initPresent();
const narrativeBg = new NarrativeBg();
narrativeBg.showAmbient();

const CLAW_DEFAULTS = {
  gripStrength: CONFIG.claw.gripStrength,
  baseSlipProb: CONFIG.claw.baseSlipProb,
};
const POST_GRAIN_DEFAULT = CONFIG.post.grain;

function parseStartActIndex() {
  const p = new URLSearchParams(location.search);
  const raw = p.get('act') ?? p.get('from');
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return 0;
  const byId = ACTS.findIndex(a => a.id === n);
  if (byId >= 0) return byId;
  if (n >= 1 && n <= ACTS.length) return n - 1;
  return 0;
}

// —— 渲染器 ——
// 触屏设备（iPad/手机）降渲染分辨率上限：Retina ×2 全幅 + 后处理极易爆显存崩标签页
const COARSE = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? CONFIG.mobile.maxPixelRatio : 2));
renderer.setSize(innerWidth, innerHeight);
// ACES 电影级色调映射：高光滚降更柔，暖灯不过曝（OutputPass 会读这个设置）
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CONFIG.render.exposure;
// 阴影：PCF 软阴影；移动端贴图减半保帧率
renderer.shadowMap.enabled = CONFIG.render.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0d);
// IBL：RoomEnvironment 给 PBR 材质环境反射与补光（无需外部 HDR 文件）
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = CONFIG.render.envIntensity;
  pmrem.dispose();
}

const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.1, 60);

const { ambient, hemi, key, fill, glow } = createSceneLights(scene, {
  shadows: CONFIG.render.shadows,
  shadowMapSize: CONFIG.render.shadowMapSize,
  coarse: COARSE,
});

// —— 世界组：机器 + 奖池 + 爪（终幕整组隐藏，切实景）——
const world = new THREE.Group();
scene.add(world);
const revealRoot = new THREE.Group();
scene.add(revealRoot);
let revealImmersive = null;
const machineShellBuilt = buildMachineShell(world);
if (new URLSearchParams(location.search).get('machineShell') === 'proc') {
  CONFIG.machineShell.useTripo = false;
}
const items = spawnPool(world);
enableShadows(world);   // 机器壳+几何体奖品统一开阴影（玻璃罩透明自动跳过投影）
// manifest 有 GLB 的：预编译后逐个弹出热替换；进度喂给加载画面
const prizesReady = upgradeVisuals(world, items, renderer, camera, (d, t) => {
  prizeDone = d; prizeTotal = t; paintLoading();
}).then(() => {
  refreshPrizeComicFx(items, { renderer, key, scene });
});

// —— 飘字 toast（收集反馈 / 模式切换提示）——
const toastsEl = document.getElementById('toasts');
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  toastsEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => el.classList.add('out'), 1400);
  setTimeout(() => el.remove(), 1900);
}

// —— 本局入洞总次数（全幕累计；UI 第三幕起由 director 显示）——
let globalGrabCount = 0;
const elGlobalGrabCount = () => document.getElementById('globalGrabCount');
function bumpGlobalGrabCount() {
  globalGrabCount += 1;
  const el = elGlobalGrabCount();
  if (el) el.textContent = String(globalGrabCount);
}

// —— 爪机 ——
let director;   // 前向声明：claw 的 hooks 里闭包引用
const claw = new ClawMachine(world, items, {
  onClawVisualReady: () => refreshClawComicFx(claw),
  onMessage: (t) => director?.msg(t),
  onCollect: (item) => {
    bumpGlobalGrabCount();
    if (director?.act?.id !== 3) toast(`+1 ${item.name}`);
    director?.notify('collect', item);
  },
  shouldSkipCollectLine: () => director?.shouldSkipCollectLine?.() ?? false,
  onHoleDrop: (item) => publishHoleDrop(item),
  onVended: (item) => publishVended(item),
});
const shellReady = upgradeMachineShellTripo(
  machineShellBuilt.shell,
  machineShellBuilt.procedural,
  renderer,
  camera,
).then((n) => {
  shellLoaded = true;
  shellTripoCount = n;
  paintLoading();
});

const clawReady = Promise.all([shellReady, claw.upgradeClawVisual(renderer, camera)]).then(() => {
  refreshClawComicFx(claw);
  clawLoaded = true;
  paintLoading();
});

// —— 镜头 / 画幅 / 后处理 / 输入 ——
const rig = new CameraRig(camera);
document.documentElement.classList.add('game-booting');
const mask = new FrameMask();
mask.bootstrapLayout(ACTS[parseStartActIndex()]?.layout ?? 'right');
const post = new Post(renderer, scene, camera);
post.setSize(innerWidth, innerHeight);
const input = new Input();
const buttons = new OnscreenButtons(input);   // 屏幕按钮（触屏自动显示，H 面板可开）
const design = new DesignOverlay();           // 设计稿叠加层（G 切换，调试对齐用）

window.addEventListener('framechange', (e) => {
  if (CONFIG.frame.fisheyeFadeOnWide) post.setFisheyeFade(e.detail === 'wide' ? 0 : 1);
});

// —— 终幕 Marble 全景（预加载，reveal 时切背景）——
const panoLoader = new THREE.TextureLoader();
let revealPanoTex = null;
panoLoader.load(
  CONFIG.reveal.pano,
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    revealPanoTex = tex;
  },
  undefined,
  (err) => console.warn('[reveal] 全景加载失败', CONFIG.reveal.pano, err),
);

function applyRevealPano(tex) {
  scene.background = tex;
  scene.backgroundIntensity = CONFIG.reveal.backgroundIntensity ?? 1;
}

function onRevealColdLighting() {
  scene.fog = null;
  applyRevealColdLighting({ key, fill, glow, hemi, ambient }, scene);
}

const revealCtl = new SceneControls(camera, {
  mode: 'fps',
  features: { ...SceneControlPresets.panoLook.features, ...CONFIG.reveal.controls },
  lookSensitivity: CONFIG.reveal.lookSensitivity ?? 0.005,
  keyLookSpeed: CONFIG.reveal.keyLookSpeed ?? 1.8,
  yawOffset: CONFIG.reveal.yawOffset ?? 0,
  baseFov: CONFIG.reveal.fov ?? CONFIG.camera.fov,
});
let revealControlsOn = false;
const elHint = document.getElementById('hint');
const elViewDots = document.getElementById('viewDots');

function applyRevealFeatures() {
  const immersive = CONFIG.reveal.mode === 'immersive';
  const c = CONFIG.reveal.controls;
  if (immersive) {
    revealCtl.setFeatures({
      ...SceneControlPresets.fpsWalk.features,
      ...c,
      moveWalk: true,
      moveVertical: c.moveVertical ?? true,
      keyboardLook: false,
      modeToggle: true,
    });
  } else {
    revealCtl.setFeatures({
      ...SceneControlPresets.panoLook.features,
      ...c,
      moveWalk: false,
      keyboardLook: false,
    });
  }
}

function enableRevealControls({ recapture = true } = {}) {
  if (recapture) revealCtl.captureFromCamera();
  revealCtl.attachPointer(renderer.domElement);
  revealCtl.setEnabled(true);
  revealControlsOn = true;
  pointerCtl.setLookMode(false);
  pointerCtl.setStagePassthrough(true);
  if (elViewDots) elViewDots.style.opacity = '0.25';
  const immersive = CONFIG.reveal.mode === 'immersive';
  elHint.textContent = immersive
    ? '按住拖拽环视 · WASD 走动 · QE 升降 · 滚轮 FOV · V 切换环视'
    : '按住拖拽环视 · 滚轮缩放视野';
  elHint.style.opacity = '1';
  toast(immersive ? '沉浸式废墟' : '环视废墟实景');
}

async function teardownRevealAssets() {
  revealImmersive?.dispose();
  revealImmersive = null;
  revealRoot.clear();
  revealCtl.setColliderMeshes(null);
  revealCtl.setBounds(null);
}

function disableRevealControls() {
  revealCtl.stopOrbitSweep();
  revealCtl.setEnabled(false);
  revealControlsOn = false;
  pointerCtl.setLookMode(true);
  pointerCtl.setStagePassthrough(false);
  if (elViewDots) elViewDots.style.opacity = '';
  scene.background = new THREE.Color(0x0b0b0d);
  scene.backgroundIntensity = CONFIG.render.envIntensity ?? 1;
  scene.fog = null;
  applyMemoryLighting({ key, fill, glow, hemi, ambient });
  world.visible = true;
  CONFIG.post.grain = POST_GRAIN_DEFAULT;
}

async function onGameplayRestart() {
  disableRevealControls();
  await teardownRevealAssets();
  globalGrabCount = 0;
  const gc = elGlobalGrabCount();
  if (gc) gc.textContent = '0';
  resetAllPoolItems(items);
  claw.reset();
  rig.setView('front');
  rig.setZoom(1);
  mask.setLayout('right', false);
  document.getElementById('revealBeat')?.classList.remove('show');
  const rb = document.getElementById('revealBeat');
  if (rb) rb.hidden = true;
  narrativeBg.showAmbient();
  narrativeBg.hideInterstitial();
}

async function onReveal() {
  world.visible = false;
  onRevealColdLighting();
  await teardownRevealAssets();
  applyRevealFeatures();

  if (CONFIG.reveal.mode === 'immersive') {
    scene.background = null;
    try {
      revealImmersive = await mountMarbleImmersive(revealRoot, {
        colliderUrl: CONFIG.reveal.colliderGlb,
        spzUrl: CONFIG.reveal.spz,
        showBoundsHelper: !!CONFIG.reveal.showBoundsHelper,
      });
      const { bounds } = revealImmersive;
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      revealCtl.yaw = 0;
      revealCtl.pitch = 0;
      revealCtl.pos.set(center.x, bounds.min.y + 1.55, center.z + size.z * 0.15);
      revealCtl.setBounds(bounds, CONFIG.reveal.boundsMargin ?? 0.3);
      revealCtl.setColliderMeshes(
        revealImmersive.colliderMeshes,
        CONFIG.reveal.collisionSkin ?? 0.35,
      );
      if (CONFIG.reveal.moveSpeed) revealCtl.moveSpeed = CONFIG.reveal.moveSpeed;
      revealCtl.apply();
      applyRevealFeatures();
    } catch (e) {
      console.error('[reveal immersive]', e);
      toast('沉浸式加载失败，回退全景', true);
      CONFIG.reveal.mode = 'pano';
      applyRevealFeatures();
      if (revealPanoTex) applyRevealPano(revealPanoTex);
    }
  } else if (revealPanoTex) {
    applyRevealPano(revealPanoTex);
  } else {
    panoLoader.load(CONFIG.reveal.pano, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      revealPanoTex = tex;
      applyRevealPano(tex);
    });
  }
  enableRevealControls({ recapture: CONFIG.reveal.mode !== 'immersive' });
}

/** 控制台：await __debug.revealPreview('immersive') */
async function revealPreview(mode) {
  if (mode === 'pano' || mode === 'immersive') CONFIG.reveal.mode = mode;
  director?.mask?.setLayout('wide', false);
  await onReveal();
  return `mode=${CONFIG.reveal.mode} moveWalk=${revealCtl.features.moveWalk} pos=${revealCtl.pos.toArray().map(n => n.toFixed(2)).join(',')}`;
}

// —— 导演（流程编排中枢）——
director = new Director({
  mask, claw, rig,
  lights: { key, fill, glow, hemi, ambient },
  clawDefaults: CLAW_DEFAULTS,
  hooks: {
    narrativeBg,
    onReveal,
    onLightsCold: onRevealColdLighting,
    onRestart: onGameplayRestart,
    onEndingOrbit: () => {
      if (revealControlsOn) revealCtl.beginOrbitSweep(1, 10);
    },
  },
});
startCollectDisplayPairPanel(director);
startCollectGamePing();

// —— 输入接线（带幕间权限闸）——
input.on('drop', () => { if (director.allow('drop')) claw.startDrop(); });
input.on('view', (v) => { if (director.allow('view')) { rig.setView(v); director.notify('view', v); } });
input.on('cycle', (d) => { if (director.allow('view')) { rig.cycle(d); director.notify('view', rig.cur); } });
input.on('next', () => director.skip());
input.on('replay', () => { director.restart(); toast('重新开始'); });
window.addEventListener('pointerdown', () => unlockAudio(), { once: true });
// 近/远取景切换：仅居中画幅幕开放（一幕右布局用 far 会穿帮）
input.on('frameMode', () => {
  if (revealControlsOn && revealCtl.features.modeToggle) {
    revealCtl.toggleMode();
    toast(revealCtl.mode === 'fps' ? '第一人称' : '环视');
    return;
  }
  if (director.act?.layout === 'center') {
    mask.toggleViewMode();
    toast(mask.viewMode === 'near' ? '凑近' : '站远');
  }
});
input.on('toggleFrame', () => mask.toggle(true));
input.on('hardCut', () => mask.hardCut());

// —— 设计稿叠加层（调试对齐，不过权限闸）——
input.on('design', () => design.toggle());
input.on('designLock', () => design.toggleLock());
input.on('designReset', () => design.reset());
input.on('designCycle', (d) => design.cycle(d));

// —— 指针手势：拖拽切视角（过权限闸）/ 终幕环视 / 滚轮与捏合缩放 ——
const pointerCtl = new PointerControls(document.getElementById('stage'), {
  onCycle: (d) => { if (director.allow('view')) { rig.cycle(d); director.notify('view', rig.cur); } },
  onZoomFactor: (f) => {
    if (revealControlsOn) revealCtl.applyWheelFactor(f);   // 触屏双指捏合（滚轮走 canvas 上的 sceneControls）
    else rig.setUserZoom(rig.userZoom * f);
  },
});

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
  g.add(CONFIG.claw, 'grabRadius', 0.2, 1.2, 0.02).name('grabRadius(联动scale)');
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
  p.add(CONFIG.post, 'bloom', 0, 1.2, 0.02);
  p.add(CONFIG.post, 'bloomThreshold', 0.3, 1, 0.02);

  const savePoolDev = () => savePoolDevOverrides();

  const lf = gui.addFolder('场景灯光(定版)');
  lf.add(CONFIG.lights.ambient, 'intensity', 0, 1, 0.02).name('环境底光').onChange(v => { ambient.intensity = v; });
  lf.add(CONFIG.lights.hemi, 'intensity', 0, 1.2, 0.02).name('半球光强度').onChange(v => { hemi.intensity = v; });
  lf.add(CONFIG.lights.key, 'intensity', 0, 2, 0.05).name('主光(投影)').onChange(v => {
    if (!CONFIG.pool.comicFx.enabled) key.intensity = v;
  });
  lf.add(CONFIG.lights.fill, 'intensity', 0, 1.2, 0.02).name('对侧补光').onChange(v => { fill.intensity = v; });
  lf.add(CONFIG.lights.glow, 'intensity', 0, 8, 0.2).name('机内点光(慎用)').onChange(v => {
    glow.intensity = v;
    glow.visible = v > 0.02;
  });

  const ch = gui.addFolder('爪子 / 落点与模型');
  ch.add(CONFIG.claw, 'grabY', 0.25, 1.2, 0.01).name('落爪停高 grabY');
  ch.add(CONFIG.claw, 'hangOffsetBase', 0.2, 1.2, 0.01).name('抓物悬挂偏移');
  ch.add(CONFIG.claw, 'tipDepthBase', 0.3, 0.9, 0.01).name('爪尖深度(灰盒)');
  ch.add(CONFIG.claw, 'meshVisualScale', 0.5, 2, 0.05).name('灰盒爪缩放').onChange((v) => {
    if (claw.clawVisual) claw.clawVisual.scale.setScalar(v);
    claw.syncTripoVisualTransform();
  });
  const glb = CONFIG.clawGLB;
  ch.add(glb, 'offsetY', -0.6, 0.2, 0.01).name('Tripo爪 offsetY').onChange(() => claw.syncTripoVisualTransform());
  ch.add(glb, 'scale', 0.2, 1.2, 0.01).name('Tripo爪 scale').onChange(() => claw.syncTripoVisualTransform());
  ch.add(glb, 'scaleWithPrize', 0.8, 2, 0.05).name('Tripo爪 奖池倍率').onChange(() => claw.syncTripoVisualTransform());
  ch.add(glb, 'openAngle', -1, 1, 0.02).name('张开角').onChange(() => { claw.openAngle = glb.openAngle; });
  ch.add(glb, 'closeAngle', -1.2, 0.5, 0.02).name('闭合角').onChange(() => { claw.closedAngle = glb.closeAngle; });

  const cf = gui.addFolder('爪子 / 漫画');
  const clawComic = CONFIG.claw.comicFx;
  const refreshClawComic = () => refreshClawComicFx(claw);
  cf.add(clawComic, 'enabled').name('漫画渲染(仅爪体)').onChange(() => { refreshClawComic(); savePoolDev(); });
  cf.add(clawComic, 'useOutline').name('启用描边').onChange(() => { refreshClawComic(); savePoolDev(); });
  cf.add(clawComic, 'outline', 0, 0.08, 0.002).name('描边厚度').onChange(() => {
    if (clawComic.enabled) refreshClawComic();
    savePoolDev();
  });
  cf.addColor(clawComic, 'outlineColor').name('描边色').onChange(() => {
    if (clawComic.enabled) refreshClawComic();
    savePoolDev();
  });

  const rf = gui.addFolder('渲染质感');
  rf.add(CONFIG.render, 'exposure', 0.4, 2, 0.02).name('ACES曝光').onChange(v => {
    if (!CONFIG.pool.comicFx.enabled) renderer.toneMappingExposure = v;
  });
  rf.add(CONFIG.render, 'envIntensity', 0, 1.5, 0.05).name('环境IBL强度').onChange(v => {
    if (!CONFIG.pool.comicFx.enabled) scene.environmentIntensity = v;
  });

  const pf = gui.addFolder('奖品 / 漫画（Hub 同参）');
  pf.add(CONFIG.pool, 'visualScale', 0.6, 2.5, 0.05).name('visualScale').onChange((v) => {
    retunePoolVisualScale(items, v);
    savePoolDev();
  });
  pf.add(CONFIG.pool, 'glbExtraRotX', -Math.PI, Math.PI, 0.05).name('glbExtraRotX(刷新)').onFinishChange(() => {
    savePoolDev();
    toast('glbExtraRotX 已保存，刷新页面后载入');
  });
  const comic = CONFIG.pool.comicFx;
  const refreshComic = () => refreshPrizeComicFx(items, { renderer, key, scene });
  pf.add(comic, 'enabled').name('漫画渲染').onChange(() => { refreshComic(); savePoolDev(); });
  pf.add(comic, 'outline', 0, 0.08, 0.002).name('描边厚度').onChange(() => {
    if (comic.enabled) refreshComic();
    savePoolDev();
  });
  pf.addColor(comic, 'outlineColor').name('描边色').onChange(() => {
    if (comic.enabled) refreshComic();
    savePoolDev();
  });
  pf.add(comic, 'exposure', 0.6, 2, 0.02).name('曝光(comic)').onChange(() => {
    if (comic.enabled) refreshComic();
    savePoolDev();
  });
  pf.add(comic, 'keyIntensity', 0.4, 2.5, 0.05).name('主光(comic)').onChange(() => {
    if (comic.enabled) refreshComic();
    savePoolDev();
  });
  pf.add(comic, 'envIntensity', 0, 1, 0.02).name('环境(comic)').onChange(() => {
    if (comic.enabled) refreshComic();
    savePoolDev();
  });
  pf.add({ 清除本地调试参数: () => {
    localStorage.removeItem('tripo.poolDev');
    toast('已清除，刷新后恢复 config 默认');
  } }, '清除本地调试参数');

  const act = {
    '跳过当前幕(N)': () => director.skip(),
    '凑近/站远(V)': () => mask.toggleViewMode(),
    '屏幕按钮(摇杆)': () => buttons.toggle(),
    '摇杆/键位切换': () => {
      const m = buttons.toggleMoveMode();
      toast(m === 'joystick' ? '移动：摇杆' : '移动：方向键');
    },
    '设计稿叠加(G)': () => design.toggle(),
    '右布局(一幕)': () => mask.setLayout('right'),
    '居中(二~四幕)': () => mask.setLayout('center'),
    '展开16:9': () => mask.setLayout('wide'),
  };
  for (const k of Object.keys(act)) gui.add(act, k);
}
let guiOn = true;
input.on('gui', () => { guiOn = !guiOn; gui.show(guiOn); });

// —— 调试钩子（控制台/自动化用）——
window.__debug = {
  claw, rig, director, mask, items, CONFIG, toast,
  revealCtl, enableRevealControls, revealPreview, onReveal,
  openCollectDisplay: openCollectDisplayWindow,
};

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
const loadPct = document.getElementById('loadPct');
let prizeDone = 0, prizeTotal = 1, clawLoaded = false, shellLoaded = false, shellTripoCount = 0;
const paintLoading = () => {
  const frac = (prizeDone + (clawLoaded ? 1 : 0) + (shellLoaded ? 1 : 0)) / (prizeTotal + 2);
  loadFill.style.width = (frac * 100 | 0) + '%';
  loadPct.textContent = (frac * 100 | 0) + '%';
};
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  const startIdx = parseStartActIndex();
  director.setStartActIndex(startIdx);
  if (startIdx > 0) {
    const act = ACTS[startIdx];
    const t = loadingEl.querySelector('.t');
    if (t) t.textContent = `试玩：从第 ${act?.id ?? startIdx + 1} 幕开始…`;
  }
  loadingEl.classList.add('done');
  setTimeout(() => loadingEl.remove(), 800);
  document.documentElement.classList.remove('game-booting');
  director.start();
  if (startIdx > 0) toast(`从「${ACTS[startIdx]?.label ?? '第三幕'}」试玩`);
}
Promise.allSettled([prizesReady, clawReady]).then(boot);
setTimeout(boot, 30000);   // 兜底：30 秒无论如何开演（个别资产失败不应卡死）

// —— 视角指示点（左/正/右；任何途径切视角都会收敛到这里）——
const viewDots = [...document.querySelectorAll('#viewDots i')];
let lastView = rig.cur;

// —— 主循环 ——
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (rig.cur !== lastView) {
    lastView = rig.cur;
    viewDots.forEach(d => d.classList.toggle('on', d.dataset.v === rig.cur));
  }

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
  if (revealControlsOn) {
    revealCtl.tick(dt, { axis: ax, keys: input.keys });   // moveWalk 走 axis；Q/E 走 keys
  } else {
    claw.move(ax.x, ax.z, dt);
    rig.update(dt, t);
  }
  claw.update(dt, t);
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
