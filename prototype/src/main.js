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
import {
  spawnPool, upgradeVisuals, tickUpgrades, enableShadows, resetAllPoolItems, groundIdlePrizesToFloor,
} from './prizePool.js';
import { spawnPoolDecor, upgradePoolDecor, restackPoolDecorWithPrizes } from './prizePoolDecor.js';
import { attachPoolDecorPhysics } from './prizePoolDecorPhysics.js';
import { attachPrizeItemPhysics } from './prizePoolItemPhysics.js';
import { ClawMachine } from './clawMachine.js';
import { CameraRig } from './cameraRig.js';
import { FrameMask } from './frameMask.js';
import { initViewportChrome } from './viewportChrome.js';
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
import { createRevealDissolveTransition } from './revealTransition.js';
import { createNarrativeSceneBgDome } from './narrativeSceneBgDome.js';
import { refreshPrizeComicFx } from './prizeComicFx.js';
import { refreshClawComicFx } from './clawComicFx.js';
import { loadPoolDevOverrides, savePoolDevOverrides, retunePoolVisualScale } from './poolDevPersist.js';
import {
  publishHoleDrop, publishVended, openCollectDisplayWindow, startCollectGamePing,
} from './collectDisplayBus.js';
import { startCollectDisplayPairPanel } from './collectDisplayPairPanel.js';
import {
  createSceneLights,
  applyRevealColdLighting,
  applyRevealLightingForLift,
  applyMemoryLighting,
} from './sceneLighting.js';
import { NarrativeBg } from './narrativeBg.js';
import { applyNarrativeToConfig, preloadNarrativeImages } from './narrativeAssets.js';
import { initPresent, applyPresentAct, getPresentActId } from './present.js';
import { resolveViewportEdgeFromQuery, syncViewportEdgeToDom, applyFisheyeEdgeToBorder } from './frameEdge.js';

loadPoolDevOverrides();
resolveViewportEdgeFromQuery();
syncViewportEdgeToDom();
applyNarrativeToConfig();
preloadNarrativeImages();
initPresent();
const narrativeBg = new NarrativeBg();
const narrativeSceneBgCache = new Map();
const narrativeBgLoader = new THREE.TextureLoader();
const GAMEPLAY_SCENE_BG = new THREE.Color(0x0b0b0d);

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
scene.background = GAMEPLAY_SCENE_BG;
const narrativeSceneDome = createNarrativeSceneBgDome(renderer);

async function loadNarrativeSceneTex(url) {
  let tex = narrativeSceneBgCache.get(url);
  if (!tex) {
    tex = await narrativeBgLoader.loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.UVMapping;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    narrativeSceneBgCache.set(url, tex);
  }
  return tex;
}

function narrativeSceneIntensity(actId) {
  const p = CONFIG.present ?? {};
  const actCfg = actId != null ? p.acts?.[actId] : null;
  return actCfg?.sceneBackgroundIntensity ?? p.sceneBackgroundIntensity ?? 0.92;
}

async function applyNarrativeSceneBackground(url, { immediate = true, actId = null, fadeMs = 1400 } = {}) {
  const p = CONFIG.present ?? {};
  if (!p.backdropAsSceneBackground || !url) {
    narrativeSceneDome.hide(scene, GAMEPLAY_SCENE_BG);
    scene.backgroundIntensity = CONFIG.render.envIntensity ?? 1;
    document.documentElement.classList.remove('narrative-scene-bg');
    return;
  }
  try {
    const tex = await loadNarrativeSceneTex(url);
    const intensity = narrativeSceneIntensity(actId);
    if (immediate || !narrativeSceneDome.isActive()) {
      narrativeSceneDome.setImmediate(tex, scene, intensity);
    } else {
      await narrativeSceneDome.crossfadeTo(tex, fadeMs, scene, intensity);
    }
    document.documentElement.classList.add('narrative-scene-bg');
  } catch (e) {
    console.warn('[narrative] scene.background 加载失败', url, e);
  }
}

window.addEventListener('narrative:scene-bg', (e) => {
  applyNarrativeSceneBackground(e.detail?.url, e.detail ?? {});
});

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
revealRoot.visible = false;
scene.add(revealRoot);
let revealImmersive = null;
const machineShellBuilt = buildMachineShell(world);
if (new URLSearchParams(location.search).get('machineShell') === 'proc') {
  CONFIG.machineShell.useTripo = false;
}
const items = spawnPool(world);
groundIdlePrizesToFloor(items, 0);
const poolDecor = spawnPoolDecor(world, items);
let poolDecorSim = attachPoolDecorPhysics(poolDecor);
upgradePoolDecor(poolDecor, items)
  .then(() => poolDecorSim?.rebuild?.(poolDecor))
  .catch((e) => console.warn('[decor] upgrade', e));
const prizeItemSim = attachPrizeItemPhysics(items);
enableShadows(world);   // 机器壳+几何体奖品统一开阴影（玻璃罩透明自动跳过投影）
// manifest 有 GLB 的：预编译后逐个弹出热替换；进度喂给加载画面
const prizesReady = upgradeVisuals(world, items, renderer, camera, (d, t) => {
  prizeDone = d; prizeTotal = t; paintLoading();
}).then(() => {
  groundIdlePrizesToFloor(items, 0);
  restackPoolDecorWithPrizes(poolDecor, items);
  poolDecorSim?.rebuild?.(poolDecor);
  refreshPrizeComicFx(items, { renderer, key, scene }, poolDecor);
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
  onGrabFail: (kind) => director?.notify('grabFail', kind),
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
initViewportChrome();
mask.bootstrapFromAct(ACTS[parseStartActIndex()] ?? ACTS[0]);
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
let revealPanoUrl = '';
let revealMarbleLoad = null;

function loadRevealPanoTexture() {
  const url = CONFIG.reveal.pano;
  if (revealPanoTex && revealPanoUrl === url) return Promise.resolve(revealPanoTex);
  revealPanoUrl = url;
  return new Promise((resolve, reject) => {
    panoLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.mapping = THREE.EquirectangularReflectionMapping;
        revealPanoTex = tex;
        resolve(tex);
      },
      undefined,
      (err) => {
        console.warn('[reveal] 全景加载失败', url, err);
        reject(err);
      },
    );
  });
}
loadRevealPanoTexture().catch(() => {});

function shouldLinkMarbleScene() {
  return CONFIG.reveal.linkMarbleScene !== false;
}

function startRevealMarblePreload() {
  if (!shouldLinkMarbleScene()) return;
  if (revealMarbleLoad) return;
  revealMarbleLoad = mountMarbleImmersive(revealRoot, {
    colliderUrl: CONFIG.reveal.colliderGlb,
    spzUrl: CONFIG.reveal.spz,
    showBoundsHelper: !!CONFIG.reveal.showBoundsHelper,
  }).catch((e) => {
    revealMarbleLoad = null;
    throw e;
  });
}

function applyMarbleRevealSpawn(immersive) {
  const { bounds } = immersive;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const spawn = CONFIG.reveal.spawn;
  revealCtl.yaw = (spawn?.yaw ?? 0) + (CONFIG.reveal.yawOffset ?? 0);
  revealCtl.pitch = spawn?.pitch ?? 0;
  revealCtl.pos.set(
    center.x + (spawn?.offsetX ?? 0),
    bounds.min.y + (spawn?.eyeHeight ?? 1.55),
    center.z + size.z * (spawn?.offsetZFrac ?? 0.15),
  );
  revealCtl.setBounds(bounds, CONFIG.reveal.boundsMargin ?? 0.3);
  if (CONFIG.reveal.mode === 'immersive') {
    revealCtl.setColliderMeshes(
      immersive.colliderMeshes,
      CONFIG.reveal.collisionSkin ?? 0.35,
    );
    if (CONFIG.reveal.moveSpeed) revealCtl.moveSpeed = CONFIG.reveal.moveSpeed;
  } else {
    revealCtl.setColliderMeshes(null);
  }
  revealCtl.apply();
}

function applyRevealPano(tex) {
  scene.background = tex;
  scene.backgroundIntensity = CONFIG.reveal.backgroundIntensity ?? 1;
}

/** 终幕全景渐亮：0=冷暗，1=配置终值（溶解后缓慢拉起，避免硬切） */
function setRevealPanoLift(k) {
  const tr = CONFIG.reveal?.transition ?? {};
  const start = tr.panoIntensityStart ?? 0.12;
  const end = CONFIG.reveal.backgroundIntensity ?? 1;
  const lift = Math.max(0, Math.min(1, k));
  scene.backgroundIntensity = start + (end - start) * lift;
  applyRevealLightingForLift(lift, { key, fill, glow, hemi, ambient }, scene);
  const exp = CONFIG.render.exposure ?? 1.18;
  if (!CONFIG.pool.comicFx.enabled) {
    // 末段放缓，避免溶解一结束曝光顶满发白
    const expK = 1 - (1 - lift) ** 2.4;
    renderer.toneMappingExposure = exp * (0.56 + 0.4 * expK);
  }
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
  if (revealImmersive) {
    revealImmersive.dispose();
    revealImmersive = null;
    revealMarbleLoad = null;
  }
  revealRoot.visible = false;
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
  scene.background = GAMEPLAY_SCENE_BG;
  scene.backgroundIntensity = CONFIG.render.envIntensity ?? 1;
  scene.fog = null;
  applyMemoryLighting({ key, fill, glow, hemi, ambient });
  document.documentElement.classList.remove('narrative-scene-bg');
  world.visible = true;
  CONFIG.post.grain = POST_GRAIN_DEFAULT;
}

async function onGameplayRestart() {
  revealDissolve?.dispose();
  revealDissolve = null;
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
  mask.resetWideViewport();
  revealMarbleLoad = null;
  revealRoot.visible = false;
  stopCinemaWidenSequence();
  document.getElementById('revealBeat')?.classList.remove('show');
  const rb = document.getElementById('revealBeat');
  if (rb) rb.hidden = true;
  narrativeBg.showAmbient();
  narrativeBg.hideInterstitial();
}

let revealDissolve = null;
/** @type {{ phase: 'hold'|'widen', elapsed: number, hold: number, widenSec: number, turns: number } | null} */
let cinemaWidenAnim = null;
/** @type {{ elapsed: number, dur: number, from: number, to: number } | null} */
let revealLiftTail = null;

function easeInOutCubicReveal(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function stopCinemaWidenSequence() {
  cinemaWidenAnim = null;
  revealLiftTail = null;
  revealCtl.stopOrbitSweep();
}

function tickRevealLiftTail(dt) {
  const tail = revealLiftTail;
  if (!tail) return;
  tail.elapsed += dt;
  const raw = Math.min(tail.elapsed / tail.dur, 1);
  const k = 1 - (1 - raw) ** 3.2;
  setRevealPanoLift(tail.from + (tail.to - tail.from) * k);
  if (raw >= 1) revealLiftTail = null;
}

function startCinemaWidenSequence() {
  const r = CONFIG.reveal ?? {};
  const tr = r.transition ?? {};
  stopCinemaWidenSequence();
  mask.resetWideViewport();
  mask.setCinemaLetterboxProgress(0);
  Object.assign(viewRect, mask.getRect());
  const liftFrom = tr.liftCapEnd ?? 0.78;
  setRevealPanoLift(liftFrom);
  revealLiftTail = {
    elapsed: 0,
    dur: tr.liftTailSeconds ?? 3.6,
    from: liftFrom,
    to: 1,
  };
  const orbitTurns = r.cinemaWidenOrbitTurns ?? 0.65;
  const orbitSec = r.cinemaWidenSeconds ?? 12;
  const atTurns = Math.min(r.cinemaWidenAtTurns ?? 0.25, orbitTurns);
  cinemaWidenAnim = {
    phase: 'hold',
    elapsed: 0,
    hold: r.cinemaHoldSeconds ?? 2,
    widenSec: orbitSec * (atTurns / Math.max(orbitTurns, 0.01)),
    orbitSec,
    turns: orbitTurns,
  };
}

function tickCinemaWidenSequence(dt) {
  const a = cinemaWidenAnim;
  if (!a || !revealControlsOn) return;
  a.elapsed += dt;
  if (a.phase === 'hold') {
    mask.setCinemaLetterboxProgress(0);
    if (a.elapsed < a.hold) return;
    a.phase = 'widen';
    a.elapsed = 0;
    if (a.turns > 0) revealCtl.beginOrbitSweep(a.turns, a.orbitSec);
    return;
  }
  const raw = Math.min(a.elapsed / a.widenSec, 1);
  mask.setCinemaLetterboxProgress(easeInOutCubicReveal(raw));
  Object.assign(viewRect, mask.getRect());
  if (raw >= 1) {
    cinemaWidenAnim = null;
    director.notify('cinemaWidened');
  }
}

async function onRevealTransition() {
  narrativeBg.hideDomOnly();
  post.setFisheyeFade(0);
  mask.setCinemaLetterboxProgress(0);
  if (shouldLinkMarbleScene() && !revealMarbleLoad) startRevealMarblePreload();
  await new Promise((resolve) => {
    revealDissolve = createRevealDissolveTransition({
      renderer,
      post,
      revealCtl,
      applyLift: setRevealPanoLift,
      onPrepareFrame: applyDissolveNeutralView,
      onHandoff: async () => {
        narrativeBg.clearSceneBackdrop();
        await onReveal({ deferControls: true });
      },
      onComplete: () => {
        mask.resetWideViewport();
        mask.setCinemaLetterboxProgress(0);
        Object.assign(viewRect, mask.getRect());
        enableRevealControls({ recapture: !shouldLinkMarbleScene() });
        startCinemaWidenSequence();
        revealDissolve = null;
        resolve();
      },
    });
    applyDissolveNeutralView();
    revealDissolve.prime(0, performance.now() * 0.001);
  });
}

async function applyRevealPanoFallback() {
  try {
    const tex = await loadRevealPanoTexture();
    applyRevealPano(tex);
    setRevealPanoLift(0);
    return true;
  } catch {
    return false;
  }
}

async function onReveal({ deferControls = false } = {}) {
  world.visible = false;
  onRevealColdLighting();
  if (revealImmersive) await teardownRevealAssets();
  else if (!revealMarbleLoad) revealRoot.clear();
  applyRevealFeatures();

  const wantImmersive = CONFIG.reveal.mode === 'immersive';
  const wantMarble = shouldLinkMarbleScene() || wantImmersive;

  if (wantMarble) {
    scene.background = null;
    revealRoot.visible = true;
    try {
      if (!revealMarbleLoad) startRevealMarblePreload();
      revealImmersive = await revealMarbleLoad;
      applyMarbleRevealSpawn(revealImmersive);
      applyRevealFeatures();
    } catch (e) {
      console.error('[reveal marble]', e);
      revealImmersive = null;
      revealMarbleLoad = null;
      if (wantImmersive) {
        toast('沉浸式加载失败，回退全景图', true);
        CONFIG.reveal.mode = 'pano';
        applyRevealFeatures();
      }
      if (!(await applyRevealPanoFallback())) toast('Marble 与全景均未加载', true);
    }
  } else if (!(await applyRevealPanoFallback())) {
    toast('全景加载失败', true);
  }
  if (!deferControls) {
    enableRevealControls({ recapture: CONFIG.reveal.mode !== 'immersive' });
  }
}

/** 控制台：await __debug.revealPreview('immersive') */
async function revealPreview(mode) {
  if (mode === 'pano' || mode === 'immersive') CONFIG.reveal.mode = mode;
  director?.mask?.setLayout('wide', false);
  director?.mask?.resetWideViewport();
  await onReveal();
  enableRevealControls({ recapture: !shouldLinkMarbleScene() });
  stopCinemaWidenSequence();
  mask.setCinemaLetterboxProgress(1);
  Object.assign(viewRect, mask.getRect());
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
    onRevealTransition,
    onLightsCold: onRevealColdLighting,
    setFisheyeFade: (v) => post.setFisheyeFade(v),
    onActEnter: (act) => {
      if (act?.restockPool) resetAllPoolItems(items.filter(it => it.state === 'collected'));
      if ((act?.id ?? 0) >= 4) startRevealMarblePreload();
    },
    onRestart: onGameplayRestart,
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
  c.add(CONFIG.camera, 'userZoomMin', 0.4, 1, 0.02).name('滚轮最近').onChange(() => rig.setUserZoom(rig.userZoom));
  c.add(CONFIG.camera, 'userZoomMaxGameplay', 0.85, 1.6, 0.02)
    .name('三幕滚轮最远')
    .onChange(() => rig.applyUserZoomPolicy(getPresentActId()));
  c.add(CONFIG.camera, 'userZoomMax', 1, 1.8, 0.02)
    .name('一二幕滚轮最远')
    .onChange(() => rig.applyUserZoomPolicy(getPresentActId()));

  const vf = gui.addFolder('视口缘');
  vf.add(CONFIG.frame, 'viewportEdge', { 鱼眼暗角: 'fisheye', 纯方框: 'square' })
    .onChange(() => {
      syncViewportEdgeToDom();
      mask.apply(false);
      const act = ACTS.find((a) => a.id === getPresentActId()) ?? ACTS[0];
      applyPresentAct(act);
    });
  vf.add(CONFIG.frame, 'viewportFeatherPx', 0, 20, 1)
    .name('羽化(px)')
    .onChange(() => mask.apply(false));
  const refreshFisheyeVig = () => applyFisheyeEdgeToBorder();
  vf.add(CONFIG.frame, 'fisheyeVigEllipseX', 1.0, 2.2, 0.02).name('内缘暗角椭圆X').onChange(refreshFisheyeVig);
  vf.add(CONFIG.frame, 'fisheyeVigEllipseY', 1.0, 2.2, 0.02).name('内缘暗角椭圆Y').onChange(refreshFisheyeVig);
  vf.add(CONFIG.frame, 'fisheyeVigInner', 0, 0.42, 0.01).name('内缘暗角透明区').onChange(refreshFisheyeVig);
  vf.add(CONFIG.frame, 'fisheyeVigOpacity', 0, 1.2, 0.02).name('内缘暗角强度').onChange(refreshFisheyeVig);

  const p = gui.addFolder('后处理（桶形畸变+颗粒+径向暗角）');
  p.add(CONFIG.post, 'k1', -0.45, 0.65, 0.005).name('k1 桶形一阶');
  p.add(CONFIG.post, 'k2', -0.15, 0.45, 0.005).name('k2 桶形二阶');
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
  const refreshComic = () => refreshPrizeComicFx(items, { renderer, key, scene }, poolDecor);
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

/** 溶解定格/混帧：取消移轴与鱼眼中心偏移，避免两帧 UV 错位像绕某点旋 */
function applyDissolveNeutralView() {
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  post.setCenter(0.5, 0.5);
  post.setFisheyeFade(0);
  rig.setModeZoom(1);
  rig.applyUserZoomPolicy(5);
  rig.setZoom(1);
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

  const ax = input.axis();
  if (revealControlsOn) {
    tickRevealLiftTail(dt);
    tickCinemaWidenSequence(dt);
  }

  narrativeSceneDome.tick(dt);

  const inRevealDissolve = !!revealDissolve;
  const cur = mask.getRect();
  if (inRevealDissolve || cinemaWidenAnim) {
    Object.assign(viewRect, cur);
    modeBlend = 0;
    if (inRevealDissolve && !revealDissolve.exitBlending) applyDissolveNeutralView();
  } else {
    const a = 1 - Math.exp(-dt / 0.28);
    viewRect.x += (cur.x - viewRect.x) * a;
    viewRect.y += (cur.y - viewRect.y) * a;
    viewRect.w += (cur.w - viewRect.w) * a;
    viewRect.h += (cur.h - viewRect.h) * a;
    modeBlend += ((mask.viewMode === 'near' ? 1 : 0) - modeBlend) * a;
  }
  if (!revealDissolve?.exitBlending) applyViewRect();

  if (revealControlsOn) {
    revealCtl.tick(dt, { axis: ax, keys: input.keys });   // moveWalk 走 axis；Q/E 走 keys
  } else if (revealDissolve?.revealViewReady) {
    revealCtl.apply();
  } else if (world.visible) {
    claw.move(ax.x, ax.z, dt);
    rig.update(dt, t);
  }
  claw.update(dt, t);
  prizeItemSim?.tick(dt);
  poolDecorSim?.tick(items, dt, claw.getPoolPhysicsContext());
  tickUpgrades(dt);
  if (revealDissolve) {
    revealDissolve.update(dt, t);
  } else {
    post.render(dt, t);
  }
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  revealDissolve?.setSize();
  narrativeSceneDome.refit();
  Object.assign(viewRect, mask.getRect());   // 窗口变化时直接对齐，不做阻尼
  modeBlend = mask.viewMode === 'near' ? 1 : 0;
  // 画幅遮罩在 frameMask 内自行监听 resize
});
