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
  setPoolAppearance, setAppearanceChangeHook, preloadVariantVisuals, VARIANT_ROT,
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
import { applyStaticCopy, copy, onLangChange, t as tr, toggleLang } from './i18n.js';
import { primeAudioFiles, primeAudioDecode, unlockAudio } from './gameAudio.js';
import { enqueueRendererCompile, setCoalesceIncrementalCompile } from './renderCompile.js';
import { SceneControls, SceneControlPresets } from './sceneControls.js';
import { applyRevealWorld, REVEAL_WORLDS, walkBoxFromBounds } from './revealWorlds.js';
import { buildWalkSpace } from './revealWalkSpace.js';
import { mountMarbleImmersive } from './revealMarble.js';
import { createRevealDissolveTransition } from './revealTransition.js';
import { createModelFade } from './modelFade.js';
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
import { preloadNarrativeImages } from './narrativeAssets.js';
import { initPresent, applyPresentAct, getPresentActId } from './present.js';
import { resolveViewportEdgeFromQuery, syncViewportEdgeToDom, applyFisheyeEdgeToBorder } from './frameEdge.js';

loadPoolDevOverrides();
setCoalesceIncrementalCompile(true);
primeAudioFiles();
resolveViewportEdgeFromQuery();
syncViewportEdgeToDom();
preloadNarrativeImages();
if (window.__boot) window.__boot.started = true;   // 自动化验收标记：模块已执行
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

/** 调参面板：npm start 默认关且 H 无效。?gui=1 / ?dev=1 或 npm run game:dev 打开后 H 可切换。 */
function parseDevGui() {
  const p = new URLSearchParams(location.search);
  if (p.has('gui')) return p.get('gui') !== '0';
  if (p.has('dev')) return p.get('dev') !== '0';
  return false;
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
const decorReady = upgradePoolDecor(poolDecor, items)
  .then(() => {
    decorLoaded = true;
    paintLoading();
    return poolDecorSim?.rebuild?.(poolDecor);
  })
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

// 两态换货后重刷漫画描边（换的是模型/材质，描边子网格得跟着重建）。
// 注册点放在 items / poolDecor / renderer 都声明之后，避免时序误读。
setAppearanceChangeHook(() => {
  try { refreshPrizeComicFx(items, { renderer, key, scene }, poolDecor); }
  catch (e) { console.warn('[两态] 描边刷新失败', e); }
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

// —— 全幕累计入洞数；界面留到终幕收束才显示（「今天收集了 N 个物资」）——
let globalGrabCount = 0;
function paintGrabStat() {
  const el = document.getElementById('globalGrabStat');
  if (!el) return;
  el.dataset.n = String(globalGrabCount);
  el.textContent = tr('grabStat', { n: globalGrabCount });
}
function bumpGlobalGrabCount() {
  globalGrabCount += 1;
  paintGrabStat();
}

// —— 爪机 ——
let director;   // 前向声明：claw 的 hooks 里闭包引用
const claw = new ClawMachine(world, items, {
  onClawVisualReady: () => refreshClawComicFx(claw),
  onMessage: (t) => director?.msg(t),
  onCollect: (item) => {
    bumpGlobalGrabCount();
    if (director?.act?.id !== 3) toast(tr('collected', { name: copy(item.name) }));
    director?.notify('collect', item);
  },
  onGrabFail: (kind) => director?.notify('grabFail', kind),
  shouldSkipCollectLine: () => director?.shouldSkipCollectLine?.() ?? false,
  onHoleDrop: (item) => publishHoleDrop(item),
  onVended: (item) => {
    publishVended(item);
    director?.onQuotaLanded?.(item);
  },
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
const machineVisualsReady = Promise.all([prizesReady, clawReady, decorReady]);

/** 上货条满后、点「开始」前：模型 / 装饰 / 音效预解码 */
function fullBootReadiness() {
  return Promise.allSettled([
    machineVisualsReady,
    primeAudioDecode(),
  ]);
}
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
const revealSpawnGui = [];
const revealWalkGui = [];
const revealWalkFallbackGui = [];
const _revealSpawnPos = new THREE.Vector3();
const _revealSpawnCenter = new THREE.Vector3();
const _revealSpawnSize = new THREE.Vector3();

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
  const gen = ++revealLoadGen;
  revealStillReady = false;
  revealMarbleLoad = mountMarbleImmersive(revealRoot, {
    colliderUrl: CONFIG.reveal.colliderGlb,
    spzUrl: CONFIG.reveal.spz,
    showBoundsHelper: !!CONFIG.reveal.showBoundsHelper,
  }).then((immersive) => {
    if (gen === revealLoadGen) beginRevealStillBake(immersive);
    return immersive;
  }).catch((e) => {
    if (gen === revealLoadGen) revealMarbleLoad = null;
    throw e;
  });
}

let revealStillRT = null;
let revealStillBake = null;
let revealStillReady = false;
let revealLoadGen = 0;

function revealStillTarget() {
  const pr = renderer.getPixelRatio();
  const w = Math.max(1, Math.floor(innerWidth * pr));
  const h = Math.max(1, Math.floor(innerHeight * pr));
  if (!revealStillRT || revealStillRT.width !== w || revealStillRT.height !== h) {
    revealStillRT?.dispose();
    revealStillRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    revealStillRT.texture.colorSpace = THREE.SRGBColorSpace;
    revealStillReady = false;
  }
  return revealStillRT;
}

/**
 * 点云库默认视角变化不够（大约 8° 或 1 米）就不会重新排序。
 * 出生点和它加载时的相机几乎重合，所以会一直空着，直到环视转到足够角度。
 * 这里按出生点强制排一次，再把这一帧画进定格。
 */
function splatViewers() {
  const list = [];
  revealRoot.traverse((o) => {
    if (o.viewer?.runSplatSort) list.push(o.viewer);
  });
  return list;
}

function captureGameplayView() {
  return {
    bg: scene.background,
    bgI: scene.backgroundIntensity,
    worldVis: world.visible,
    rootVis: revealRoot.visible,
    pos: camera.position.clone(),
    quat: camera.quaternion.clone(),
    fov: camera.fov,
    yaw: revealCtl.yaw,
    pitch: revealCtl.pitch,
  };
}

function restoreGameplayView(saved) {
  scene.background = saved.bg;
  scene.backgroundIntensity = saved.bgI;
  world.visible = saved.worldVis;
  revealRoot.visible = saved.rootVis;
  camera.position.copy(saved.pos);
  camera.quaternion.copy(saved.quat);
  camera.fov = saved.fov;
  camera.updateProjectionMatrix();
  revealCtl.yaw = saved.yaw;
  revealCtl.pitch = saved.pitch;
  applyViewRect();
  applySplatPresentation();
}

function poseRevealStill(immersive) {
  world.visible = false;
  revealRoot.visible = true;
  scene.background = null;
  applyDissolveNeutralView();
  applySplatPresentation();
  applyMarbleRevealSpawn(immersive);
}

const STILL_SAMPLES = [[0.5, 0.62], [0.32, 0.58], [0.68, 0.58], [0.5, 0.78], [0.42, 0.48], [0.58, 0.72]];

function sampleLooksLit(readAt) {
  let peak = 0;
  let bright = 0;
  for (const [u, v] of STILL_SAMPLES) {
    const px = readAt(u, v);
    if (!px) return false;
    const s = px[0] + px[1] + px[2];
    if (s > peak) peak = s;
    if (s > 24) bright += 1;
  }
  return peak > 36 && bright >= 2;
}

function stillLooksLit(rt) {
  const buf = new Uint8Array(4);
  return sampleLooksLit((u, v) => {
    const x = Math.max(0, Math.min(rt.width - 1, (rt.width * u) | 0));
    const y = Math.max(0, Math.min(rt.height - 1, (rt.height * v) | 0));
    try {
      renderer.readRenderTargetPixels(rt, x, y, 1, 1, buf);
    } catch {
      return null;
    }
    return buf;
  });
}

function canvasLooksLit() {
  const gl = renderer.getContext();
  const buf = new Uint8Array(4);
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  return sampleLooksLit((u, v) => {
    const x = Math.max(0, Math.min(w - 1, (w * u) | 0));
    const y = Math.max(0, Math.min(h - 1, (h * v) | 0));
    try {
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    } catch {
      return null;
    }
    return buf;
  });
}

async function sortSplatsAtSpawn(immersive, gen) {
  let saved = captureGameplayView();
  poseRevealStill(immersive);
  const viewers = splatViewers();
  for (const v of viewers) {
    v.update(renderer, camera);
    if (v.sortRunning && v.sortPromise) {
      const pending = v.sortPromise;
      restoreGameplayView(saved);
      await pending;
      if (gen !== revealLoadGen) return;
      saved = captureGameplayView();
      poseRevealStill(immersive);
      v.update(renderer, camera);
    }
    v.update(renderer, camera);
    v.runSplatSort(true, true);
    await Promise.resolve();
    const pending = v.sortPromise;
    restoreGameplayView(saved);
    if (pending) await pending;
    if (gen !== revealLoadGen) return;
    saved = captureGameplayView();
    poseRevealStill(immersive);
  }
  restoreGameplayView(saved);
}

let revealStillPromise = null;

function beginRevealStillBake(immersive) {
  if (revealStillReady) return Promise.resolve();
  if (revealStillPromise) return revealStillPromise;
  const gen = revealLoadGen;
  revealStillPromise = bakeRevealStillAsync(immersive, gen).finally(() => {
    if (gen === revealLoadGen) revealStillPromise = null;
  });
  return revealStillPromise;
}

async function bakeRevealStillAsync(immersive, gen) {
  const rt = revealStillTarget();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (gen !== revealLoadGen) return;
    await sortSplatsAtSpawn(immersive, gen);
    if (gen !== revealLoadGen) return;
    const saved = captureGameplayView();
    poseRevealStill(immersive);
    post.renderToTarget(rt, 1 / 60, performance.now() * 0.001);
    const lit = stillLooksLit(rt);
    restoreGameplayView(saved);
    if (lit) {
      revealStillReady = true;
      revealStillBake = null;
      return;
    }
    await new Promise((r) => requestAnimationFrame(r));
  }
  revealStillReady = true;
  revealStillBake = null;
}

async function ensureRevealStill() {
  if (!revealMarbleLoad) startRevealMarblePreload();
  const immersive = await revealMarbleLoad;
  if (!revealStillReady) await beginRevealStillBake(immersive);
  return revealStillRT.texture;
}

function revealSpawnOrigin(immersive, out = _revealSpawnPos) {
  const { bounds } = immersive;
  const center = bounds.getCenter(_revealSpawnCenter);
  const size = bounds.getSize(_revealSpawnSize);
  const spawn = CONFIG.reveal.spawn;
  // yaw 0 朝 −Z。offsetZFrac 为正是往 +Z，也就是身后，不是视线前方。
  return out.set(
    center.x + (spawn?.offsetX ?? 0),
    bounds.min.y + (spawn?.eyeHeight ?? 1.55),
    center.z + size.z * (spawn?.offsetZFrac ?? 0),
  );
}

function applyMarbleRevealSpawn(immersive) {
  const spawn = CONFIG.reveal.spawn;
  revealCtl.yaw = (spawn?.yaw ?? 0) + (CONFIG.reveal.yawOffset ?? 0);
  revealCtl.pitch = spawn?.pitch ?? 0;
  revealCtl.pos.copy(revealSpawnOrigin(immersive));
  applyRevealWalkBounds(immersive);
  revealCtl.apply();
}

function syncWalkFallbackGui() {
  const meshOn = CONFIG.reveal.walk?.useMesh !== false && !!revealCtl.walkSpace;
  for (const c of revealWalkFallbackGui) {
    if (meshOn) c.disable();
    else c.enable();
  }
}

function applyRevealWalkBounds(immersive) {
  if (!immersive) {
    revealCtl.setBounds(null);
    revealCtl.setWalkSpace(null);
    revealCtl.setColliderMeshes(null);
    syncRevealWalkHelper(null);
    syncWalkFallbackGui();
    return;
  }
  const walk = CONFIG.reveal.walk ?? {};
  let space = null;
  if (walk.useMesh !== false && immersive.colliderMeshes?.length) {
    space = buildWalkSpace(immersive.colliderMeshes, revealSpawnOrigin(immersive), {
      meshInset: walk.meshInset ?? 0.16,
      sealMeters: walk.sealMeters ?? 0.6,
      grid: walk.grid ?? 96,
      wallY0: walk.wallY0 ?? 1,
      wallY1: walk.wallY1 ?? 2.35,
    });
  }
  revealCtl.setWalkSpace(space);
  if (space) {
    revealCtl.setBounds(null);
    console.info(`[reveal walk] GLB ${space.source} ${space.cells} cells / ${space.polygon.length} pts`);
  } else {
    const walkBox = walkBoxFromBounds(
      immersive.bounds,
      walk,
      CONFIG.reveal.boundsMargin ?? 0.55,
    );
    revealCtl.setBounds(walkBox, 0);
    console.info('[reveal walk] 网格抽边失败，回退偏转盒');
  }
  revealCtl.setColliderMeshes(
    walk.meshClip ? immersive.colliderMeshes : null,
    CONFIG.reveal.collisionSkin ?? 0.2,
  );
  syncRevealWalkHelper(space ?? revealCtl.walkBox);
  syncWalkFallbackGui();
}

let revealWalkHelper = null;

function syncRevealWalkHelper(space) {
  if (revealWalkHelper) {
    revealWalkHelper.removeFromParent();
    revealWalkHelper.geometry?.dispose();
    revealWalkHelper.material?.dispose?.();
    revealWalkHelper = null;
  }
  if (!space || !CONFIG.reveal.showWalkHelper) return;
  let pts = null;
  const y = (space.minY ?? 0) + 0.08;
  if (space.kind === 'mesh' && space.polygon?.length >= 3) {
    pts = space.polygon.map((p) => new THREE.Vector3(p.x, y, p.z));
    pts.push(pts[0].clone());
  } else if (space.kind !== 'mesh' && space.minX != null) {
    const { yaw, cx, cz, minX, maxX, minZ, maxZ } = space;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const toWorld = (lx, lz) => new THREE.Vector3(cx + lx * c - lz * s, y, cz + lx * s + lz * c);
    pts = [
      toWorld(minX, minZ),
      toWorld(maxX, minZ),
      toWorld(maxX, maxZ),
      toWorld(minX, maxZ),
      toWorld(minX, minZ),
    ];
  }
  if (!pts) return;
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const color = space.kind === 'mesh' ? 0x9eefc2 : 0x88c8ff;
  revealWalkHelper = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  }));
  revealWalkHelper.renderOrder = 12;
  revealWalkHelper.name = 'revealWalkHelper';
  revealRoot.add(revealWalkHelper);
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
  if (splatLookActive()) return;
  const exp = CONFIG.render.exposure ?? 1.18;
  if (!CONFIG.pool.comicFx.enabled) {
    // 全景回退才渐亮。点云直出时曝光由 splatLook 管，避免再提成奶白。
    const expK = 1 - (1 - lift) ** 2.4;
    renderer.toneMappingExposure = exp * (0.56 + 0.4 * expK);
  }
}

const GAME_OUTPUT_COLOR_SPACE = renderer.outputColorSpace;

function splatLookActive() {
  return shouldLinkMarbleScene() && revealRoot.visible;
}

function restoreGameplayGrade() {
  post.setRevealLook(null);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = GAME_OUTPUT_COLOR_SPACE;
  renderer.toneMappingExposure = CONFIG.pool.comicFx.enabled
    ? (CONFIG.pool.comicFx.exposure ?? 1.15)
    : (CONFIG.render.exposure ?? 1.18);
}

/** 点云在画面上时改走 Hub 同款直出。H 面板改 splatLook 后下一帧生效。 */
function applySplatPresentation() {
  if (!splatLookActive()) {
    if (post._revealLook) restoreGameplayGrade();
    return;
  }
  const look = CONFIG.reveal.splatLook ?? {};
  post.setRevealLook(look);
  renderer.toneMapping = look.toneMapping === 'aces'
    ? THREE.ACESFilmicToneMapping
    : THREE.NoToneMapping;
  // 点云着色器写出的已是显示颜色。OutputPass 再做一次 sRGB 会发白，直出时关掉这层。
  renderer.outputColorSpace = look.toneMapping === 'aces'
    ? GAME_OUTPUT_COLOR_SPACE
    : THREE.LinearSRGBColorSpace;
  renderer.toneMappingExposure = look.exposure ?? 1;
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
let revealWalkUnlocked = false;
let revealWalkAfterOrbit = false;
let revealPictureGate = null;
const elHint = document.getElementById('hint');
const elViewDots = document.getElementById('viewDots');

function syncRevealWalkFeel() {
  const r = CONFIG.reveal;
  revealCtl.moveSpeed = r.moveSpeed ?? 0.9;
  revealCtl.moveAccel = r.moveAccel ?? 1.5;
  revealCtl.moveDecel = r.moveDecel ?? 4.2;
  revealCtl.walkBob = r.walkBob !== false && revealWalkUnlocked;
  revealCtl.walkBobAmount = r.walkBobAmount ?? 0.014;
  revealCtl.walkBobHz = r.walkBobHz ?? 0.6;
  revealCtl.lookSpeedMax = r.lookSpeedMax ?? 3.4;
}

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
      moveWalk: revealWalkUnlocked,
      moveVertical: false,
      keyboardLook: false,
    });
  }
  syncRevealWalkFeel();
}

function unlockRevealWalk() {
  revealWalkUnlocked = true;
  revealWalkAfterOrbit = false;
  applyRevealFeatures();
  if (revealImmersive) applyRevealWalkBounds(revealImmersive);
  if (revealControlsOn && elHint) {
    elHint.textContent = tr('lookDrag');
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
  elHint.textContent = revealWalkUnlocked
    ? tr('lookDrag')
    : (immersive ? tr('lookFps') : tr('lookOrbit'));
  elHint.style.opacity = '1';
  toast(immersive ? tr('ruinImmersive') : tr('ruinOrbit'));
}

function stepRevealPictureGate() {
  const g = revealPictureGate;
  if (!g) return;
  g.frames += 1;
  if (!g.sorted) {
    for (const v of splatViewers()) {
      v.update(renderer, camera);
      if (!v.sortRunning) v.runSplatSort(true, true);
    }
    g.sorted = true;
  }
  if (canvasLooksLit()) g.lit += 1;
  else g.lit = 0;
  if (g.lit >= 2 || g.frames > 90) {
    revealPictureGate = null;
    enableRevealControls({ recapture: false });
    startCinemaWidenSequence();
  }
}

async function teardownRevealAssets() {
  if (revealImmersive) {
    revealImmersive.dispose();
    revealImmersive = null;
    revealMarbleLoad = null;
  }
  revealRoot.visible = false;
  syncRevealWalkHelper(null);
  revealRoot.clear();
  revealCtl.setColliderMeshes(null);
  revealCtl.setWalkSpace(null);
  revealCtl.setBounds(null);
}

function rememberRevealWorldSpawn() {
  const profile = REVEAL_WORLDS[CONFIG.reveal.world];
  if (profile?.spawn && CONFIG.reveal.spawn) Object.assign(profile.spawn, CONFIG.reveal.spawn);
  if (profile && CONFIG.reveal.walk) {
    profile.walk = { ...(profile.walk ?? {}), ...CONFIG.reveal.walk };
  }
}

/** 换终幕世界：点云、全景、碰撞和出生点一起换。已经在终幕里就当场重载。 */
async function setRevealWorld(id) {
  if (id !== CONFIG.reveal.world) rememberRevealWorldSpawn();
  applyRevealWorld(CONFIG.reveal, id);
  revealLoadGen += 1;
  revealStillBake = null;
  revealStillReady = false;
  revealStillPromise = null;
  const showing = revealRoot.visible;
  if (!revealImmersive && revealMarbleLoad) {
    try { revealImmersive = await revealMarbleLoad; }
    catch { revealMarbleLoad = null; }
  }
  if (revealImmersive) await teardownRevealAssets();
  for (const c of revealSpawnGui) c.updateDisplay();
  for (const c of revealWalkGui) c.updateDisplay();
  if (!showing) {
    startRevealMarblePreload();
    return CONFIG.reveal.world;
  }
  scene.background = null;
  revealRoot.visible = true;
  try {
    startRevealMarblePreload();
    revealImmersive = await revealMarbleLoad;
    applyMarbleRevealSpawn(revealImmersive);
    applySplatPresentation();
  } catch (e) {
    console.error('[reveal world]', e);
    revealImmersive = null;
    revealMarbleLoad = null;
    if (!(await applyRevealPanoFallback())) toast(tr('marbleFail'), true);
  }
  return CONFIG.reveal.world;
}

// 整组模型淡入淡出。终幕用来让娃娃机消失；换 GLB 后同一接口还能用，dir:'in' 是反向出现。
const modelFade = createModelFade();

// —— 终幕"机器逐个构件消失"的分组 ——
// 留着：底座 + 背板 + 洞口暗腔 + 池底（机器塌了还剩个台子），
//       以及爪子和池里的物资（坏掉的东西才是这一幕要看的东西）。
// 先走：立柱 / 顶盖 / 面板（"壳"）；再走：爪子 + 池底装饰（"里子"）。
// 写成函数声明（不立刻求值）：world / claw 都在下面才声明。
// post 也要收进来：灰盒件的命名是 machine_post_*，装了 Tripo 壳之后它们虽然被隐藏，
// 但沿用的还是同一套名字，露出来会穿帮。
const SHELL_TOP_RE = /machine_(top|panel|frame|post)|EXPORT_machine_(top|panel|frame|post)/i;
const SHELL_CORE_RE = /machine_(base|back|floor|hole)|EXPORT_machine_(base|back|hole)/i;

function collectMachineParts() {
  const deck = [];      // 先消失：顶盖 / 立柱 / 面板
  const keep = [];      // 最后剩下来的：底座 / 背板 / 洞
  const clawParts = [];
  const decor = [];
  const used = new Set();

  const root = machineShellBuilt?.shell;
  // 先按"最深优先"排序再归属，否则 machineShellProcedural 这种容器会把它里面
  // 真正的构件（立柱 / 顶盖 / 面板）整包吞掉，导致一个都认不出来。
  const matched = [];
  root?.traverse?.((o) => {
    if (!o.isMesh) return;
    const n = o.name || '';
    const group = SHELL_TOP_RE.test(n) ? deck : SHELL_CORE_RE.test(n) ? keep : null;
    if (!group) return;
    let depth = 0;
    for (let p = o.parent; p && p !== root; p = p.parent) depth += 1;
    matched.push({ o, group, depth });
  });
  matched.sort((a, b) => b.depth - a.depth);
  for (const { o, group } of matched) {
    if (used.has(o)) continue;
    group.push(o);
    used.add(o);
  }
  // 一个都没认出来（换了壳的命名）：返回空 deck，由调用方决定整组淡。
  // 注意**不要**把 root 塞进来 —— 那会和它自己的子 mesh 重复 traverse，不透明度被平方。
  void root;

  const clawRoot = claw?.comicVisualRoot;
  if (clawRoot) clawParts.push(clawRoot);
  const decorGroup = world.getObjectByName('poolDecor');
  if (decorGroup) decor.push(decorGroup);
  // 池里的东西也一起走：它们不是"机器的一部分"，但这一幕是"眼前的东西一层层没了"
  const prizeItems = (items ?? []).map(it => it?.mesh).filter(Boolean);

  return { deck, keep, clawParts, decor, items: prizeItems };
}

const sleepMsLocal = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 终幕：机器一层层化掉。**镜头不动**，只是眼前的东西渐次淡去，最后整幅溶解。
 *
 * 实现要点（踩过两个坑）：
 *   1. **不 hide()**。淡完就 visible=false 等于淡到一半硬切一刀。
 *   2. **壳/东西/台子不是三段轮着淡**，而是一条**各自起点不同、终点都是 0** 的连续曲线：
 *      壳最先开始、东西稍后跟上、台子收尾，全程交叠。
 *      用 modelFade 的 stageCurve 一次算完，避免"同一批 mesh 被 traverse 两次"（不透明度会被平方）。
 *
 * @param {'all'|'shell'|'core'} stage
 * @param {number} dur 整段时长（秒）
 */
function fadeMachineStage(stage = 'all', dur = 7.5, overlap = 0.5) {
  const { deck, clawParts, decor, items: prizeItems } = collectMachineParts();
  const rest = [...clawParts, ...decor, ...prizeItems];

  if (stage === 'shell') {
    if (!deck.length) return sleepMsLocal(dur * 1000);
    return modelFade.sequence([{ parts: deck, dur }], { overlap });
  }
  if (stage === 'core') {
    if (!rest.length) return sleepMsLocal(dur * 1000);
    return modelFade.sequence([{ parts: rest, dur }], { overlap });
  }

  // 'all'：壳 → 东西 → 台子，三段起点错开、终点都是 0，整段交叠成一次溶解。
  // 每段用 match 按名字认自己的范围（名字沿父级向上找，爪子和装饰只有组名）。
  if (!deck.length) {
    // 认不出构件（换了壳的命名）：整组一起淡
    return modelFade.sequence([{ parts: [world], dur }], { overlap });
  }
  const shellRe = /machine_(top|panel|frame|post)|EXPORT_machine_(top|panel|frame|post)/i;
  const coreRe = /poolDecor|claw|prize/i;
  const baseRe = /machine_(base|back|floor|hole)|EXPORT_machine_(base|back|hole)/i;
  return modelFade.out(world, {
    dur,
    ease: modelFade.stageCurve([
      { start: 0,            dur: dur * 0.30, match: (n) => shellRe.test(n) },
      { start: dur * 0.12,   dur: dur * 0.62, match: (n) => coreRe.test(n) },
      { start: dur * 0.50,   dur: dur * 0.50, match: (n) => baseRe.test(n) },
    ]),
  });
}

// —— 终幕俯拍扫过奖池（备用机位；终幕现在不用它，镜头全程不动）——
// 机位固定写成常量：同一条轨迹每次都能复现，方便和美术对图。
// 机器内腔：X ±1.45 / Z ±1.02 / 池底 y=0，奖池逻辑边界 X ±1.30 / Z ±0.85，
// 所以 look 一律落在池面内，不要跑到机器背后的空处去。
// 这一段是"灯灭了，只剩地上那几件坏东西"，所以压得低、收得近，看得清轮廓。
const POOL_SCAN = {
  startPos: [2.55, 2.20, 1.85],
  startLook: [-0.55, 0.05, 0.10],
  endPos: [-2.05, 1.95, 2.10],
  endLook: [0.35, 0.03, -0.10],
  fov: 58,
};

// 构件化掉之后补的那一镜：低机位贴近池面，盯着剩下的几件
const POOL_FLOOR_SCAN = {
  startPos: [0.55, 0.98, 2.25],
  startLook: [0.15, 0.02, 0.20],
  endPos: [-0.95, 0.86, 2.05],
  endLook: [-0.35, 0.02, 0.05],
  fov: 62,
};

let poolScanResolve = null;

/**
 * 镜头扫过奖池；restore=true 时扫完把镜头交还三观察位。
 * preset='floor' 用"贴着池面看剩下的东西"那条更近的轨迹（构件化掉之后那一镜）。
 */
function poolScanBeat({ dur = 6, restore = true, preset = 'sweep' } = {}) {
  cancelPoolScan();
  const path = preset === 'floor' ? POOL_FLOOR_SCAN : POOL_SCAN;
  return new Promise((resolve) => {
    poolScanResolve = resolve;
    const finish = () => {
      if (restore) rig.setScan(null);
      poolScanResolve = null;
      resolve();
    };
    rig.setScan({
      ...path,
      fromPos: rig.pos.toArray(),
      fromLook: rig.look.toArray(),
      dur,
      easeDur: Math.min(1.6, dur * 0.3),
      onDone: finish,
    });
  });
}

function cancelPoolScan() {
  rig.setScan(null);
  const r = poolScanResolve;
  poolScanResolve = null;
  r?.();
}

// —— 败露态灯光：不是"终幕冷光"，是"灯灭了" ——
// 但**不能真的黑**：地上那几件坏掉的东西要还看得见，
// 全靠一点环境残光 + 败露材质自带的一点点自发光（见 prizePool 的 VARIANT_MAT）。
// 这一拍要看的是"东西还是那些东西"，全黑就等于什么都没说。
function applyRotLighting() {
  applyMemoryLighting({ key, fill, glow, hemi, ambient });
  // 灯灭了，但东西要看得清 —— 这几个系数是"看得出贴图"和"不像没灭灯"的平衡点，
  // 往低调会先丢掉的是霉斑和锈迹（那正是这几件模型的信息量）。
  ambient.intensity *= 0.8;
  hemi.intensity *= 0.52;
  key.intensity *= 0.34;
  key.color.set(0xa8b8c4);
  fill.intensity *= 0.26;
  fill.color.set(0x8b9aa6);
  glow.visible = false;
  scene.environmentIntensity = (CONFIG.render.envIntensity ?? 1) * 0.85;
}

function restoreMemoryLighting() {
  applyMemoryLighting({ key, fill, glow, hemi, ambient });
  scene.environmentIntensity = CONFIG.render.envIntensity ?? 1;
}

// —— 败露态模型预算：第四幕空闲时偷偷取回来 ——
// 终幕换货在全黑 1.4s 里做，那会儿不能再等下载，否则黑屏会被拖长。
const idle = window.requestIdleCallback?.bind(window) ?? ((fn) => setTimeout(fn, 900));
let rotPreloadStarted = false;
function preloadRotVisuals() {
  if (rotPreloadStarted) return;
  rotPreloadStarted = true;
  const run = () => preloadVariantVisuals(items, VARIANT_ROT)
    .then(n => console.info(`[两态] 败露态模型已预算 ${n} 件`))
    .catch(() => {});
  try { idle(run, { timeout: 4000 }); } catch { run(); }
}

function disableRevealControls() {
  revealCtl.stopOrbitSweep();
  revealCtl.resetWalkFeel();
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
  modelFade.restore();
  cancelPoolScan();
  revealWalkUnlocked = false;
  revealWalkAfterOrbit = false;
  revealPictureGate = null;
  restoreGameplayGrade();
  world.visible = true;
  CONFIG.post.grain = POST_GRAIN_DEFAULT;
}

async function onGameplayRestart() {
  revealDissolve?.dispose();
  revealDissolve = null;
  disableRevealControls();
  await teardownRevealAssets();
  globalGrabCount = 0;
  paintGrabStat();
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
    revealWalkAfterOrbit = true;
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
        try {
          const still = await ensureRevealStill();
          revealDissolve?.setToTexture(still);
        } catch (e) {
          console.error('[reveal still]', e);
        }
        narrativeBg.clearSceneBackdrop();
        await onReveal({ deferControls: true });
      },
      onComplete: () => {
        mask.resetWideViewport();
        mask.setCinemaLetterboxProgress(0);
        Object.assign(viewRect, mask.getRect());
        revealDissolve = null;
        // 先确认实时画面不是黑的，再出「环视」并开始转。
        revealPictureGate = { frames: 0, lit: 0, nudged: false };
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
  modelFade.release();
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
        toast(tr('ruinFail'), true);
        CONFIG.reveal.mode = 'pano';
        applyRevealFeatures();
      }
      if (!(await applyRevealPanoFallback())) toast(tr('marbleFail'), true);
    }
  } else if (!(await applyRevealPanoFallback())) {
    toast(tr('panoFail'), true);
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
    onFadeMemoryMachine: (step) => fadeMachineStage(step?.stage ?? 'shell', step?.dur ?? 2.6),
    // 终幕"扫过腐败食物模型"：镜头交给专门的俯拍机位，按 dur 扫过奖池。
    // restore=false 时留在结束位置（交给后面的 fadeGhost / reveal 接住）。
    onPoolScan: (opts) => poolScanBeat(opts),    onPoolScanCancel: () => cancelPoolScan(),
    // 腐败食物模型淡成一层淡影，停在那儿不彻底消失
    onFadeGhost: (step) => modelFade.ghost(world, { dur: step?.dur ?? 3.4, hold: step?.hold ?? 0.16 }),
    // 两态换货：manifest（他以为的）↔ rot（真实的）
    // 换模型发生在 #glitch 的全黑里；灯光另外走 onGlitchEnd，
    // 因为故障段自己会在黑场后把灯光切冷（onLightsCold），谁后谁说了算。
    onPoolAppearance: async (appearance) => {
      await setPoolAppearance(items, appearance, { renderer, camera, parent: world, animate: false });
      groundIdlePrizesToFloor(items, 0);
      if (appearance !== VARIANT_ROT) restoreMemoryLighting();
    },
    onGlitchEnd: () => { applyRotLighting(); },
    onRestockPool: async () => {
      resetAllPoolItems(items.filter(it => it.state === 'collected'));
      if (poolDecor) restackPoolDecorWithPrizes(poolDecor, items);
      poolDecorSim?.rebuild?.(poolDecor);
    },
    setFisheyeFade: (v) => post.setFisheyeFade(v),
    onActEnter: (act) => {
      if (act?.id === 1) {
        world.visible = false;
        document.documentElement.classList.add('act-opening');
      }
      // 第四幕（最暖的一幕）就该开始为终幕的换货备料
      if ((act?.id ?? 0) >= 4) { startRevealMarblePreload(); preloadRotVisuals(); }
    },
    onOpenViewport: () => {
      document.documentElement.classList.remove('act-opening');
      mask.growCircle(3.4);
    },
    onRevealMachine: async () => {
      await machineVisualsReady.catch(() => {});
      document.getElementById('actLabel')?.classList.remove('show');
      world.visible = true;
    },
    onRestart: onGameplayRestart,
  },
});
startCollectDisplayPairPanel(director);
startCollectGamePing();

// —— 输入接线（带幕间权限闸 + 演出锁）——
// director.interactive：俯拍扫视角 / 终幕演出期间为 false，用户输入一律不生效。
input.on('drop', () => { if (director.interactive && director.allow('drop')) claw.startDrop(); });
input.on('view', (v) => { if (director.interactive && director.allow('view')) { rig.setView(v); director.notify('view', v); } });
input.on('cycle', (d) => {
  if (revealControlsOn || !director.interactive) return;
  if (director.allow('view')) { rig.cycle(d); director.notify('view', rig.cur); }
});
input.on('next', () => director.skip());
input.on('replay', () => { director.restart(); toast(tr('restart')); });
// 近/远取景切换：仅居中画幅幕开放（一幕右布局用 far 会穿帮）
input.on('frameMode', () => {
  if (revealControlsOn && revealCtl.features.modeToggle) {
    revealCtl.toggleMode();
    toast(revealCtl.mode === 'fps' ? tr('fps') : tr('orbit'));
    return;
  }
  if (director.act?.layout === 'center') {
    mask.toggleViewMode();
    toast(mask.viewMode === 'near' ? tr('near') : tr('far'));
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
  onCycle: (d) => {
    if (revealControlsOn) return;
    if (director.allow('view')) { rig.cycle(d); director.notify('view', rig.cur); }
  },
  onZoomFactor: (f) => {
    if (revealControlsOn) revealCtl.applyWheelFactor(f);   // 触屏双指捏合（滚轮走 canvas 上的 sceneControls）
    else rig.setUserZoom(rig.userZoom * f);
  },
});

// —— 调参面板（仅 dev / ?gui=1 可开；画幅按钮是调试入口，正常流程由导演接管）——
const gui = new GUI({ title: '爪机手感调参' });
const TITLE_GAME = '拾荒娃娃机';
const TITLE_GUI = '拾荒娃娃机 · 调参';
const guiUnlocked = parseDevGui();
let guiOn = guiUnlocked;
function syncDocumentTitle() {
  document.title = guiOn ? TITLE_GUI : TITLE_GAME;
}
gui.show(guiOn);
syncDocumentTitle();
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

  const sf = gui.addFolder('终幕点云');
  const worldLabels = Object.fromEntries(
    Object.entries(REVEAL_WORLDS).map(([id, world]) => [world.label, id]),
  );
  const worldPick = { world: CONFIG.reveal.world };
  sf.add(worldPick, 'world', worldLabels).name('世界').onChange((id) => {
    setRevealWorld(id).catch((e) => console.error('[reveal world]', e));
  });
  const splatLook = CONFIG.reveal.splatLook;
  sf.add(splatLook, 'toneMapping', { 直出: 'none', ACES: 'aces' }).name('色调映射');
  sf.add(splatLook, 'exposure', 0.4, 2, 0.02).name('曝光');
  sf.add(splatLook, 'bloom', 0, 1.2, 0.02).name('泛光');
  sf.add(splatLook, 'bloomThreshold', 0.3, 1, 0.02).name('泛光阈值');
  sf.add(splatLook, 'vignette', 0, 1, 0.02).name('暗角');
  sf.add(splatLook, 'grain', 0, 0.15, 0.005).name('颗粒');
  sf.add(splatLook, 'saturation', 0, 1.6, 0.02).name('饱和');
  sf.add(splatLook, 'warmth', -0.4, 0.4, 0.02).name('冷暖');
  sf.add(splatLook, 'chroma', 0, 1, 0.02).name('色散');
  sf.add(splatLook, 'fisheye', 0, 0.65, 0.005).name('桶形');
  sf.add(CONFIG.reveal, 'fov', 35, 90, 1).name('FOV').onChange((v) => {
    revealCtl.baseFov = v;
    camera.fov = v;
    camera.updateProjectionMatrix();
  });
  const spawn = CONFIG.reveal.spawn;
  const pushSpawn = () => {
    rememberRevealWorldSpawn();
    if (revealImmersive) applyMarbleRevealSpawn(revealImmersive);
  };
  revealSpawnGui.push(
    sf.add(spawn, 'yaw', -Math.PI, Math.PI, 0.01).name('朝向').onChange(pushSpawn),
    sf.add(spawn, 'pitch', -1.2, 1.2, 0.01).name('俯仰').onChange(pushSpawn),
    sf.add(spawn, 'eyeHeight', 0.8, 3.2, 0.01).name('眼高').onChange(pushSpawn),
    sf.add(spawn, 'offsetX', -3, 3, 0.05).name('左右').onChange(pushSpawn),
    sf.add(spawn, 'offsetZFrac', -0.45, 0.45, 0.01).name('进深').onChange(pushSpawn),
  );
  const walk = CONFIG.reveal.walk;
  const pushWalkMesh = () => {
    rememberRevealWorldSpawn();
    if (revealImmersive) applyRevealWalkBounds(revealImmersive);
  };
  const pushWalkFallback = () => {
    rememberRevealWorldSpawn();
    if (walk.useMesh !== false && revealCtl.walkSpace) return;
    if (revealImmersive) applyRevealWalkBounds(revealImmersive);
  };
  revealWalkGui.push(
    sf.add(walk, 'useMesh').name('碰撞网格边界').onChange(pushWalkMesh),
    sf.add(walk, 'meshInset', 0, 1.2, 0.02).name('网格内缩').onChange(pushWalkMesh),
    sf.add(walk, 'sealMeters', 0, 1.4, 0.05).name('缺口闭合').onChange(pushWalkMesh),
    sf.add(walk, 'wallY0', 0.2, 2.2, 0.05).name('墙带底').onChange(pushWalkMesh),
    sf.add(walk, 'wallY1', 0.8, 3.2, 0.05).name('墙带顶').onChange(pushWalkMesh),
  );
  revealWalkFallbackGui.push(
    sf.add(walk, 'yaw', -Math.PI, Math.PI, 0.01).name('回退盒偏转').onChange(pushWalkFallback),
    sf.add(walk, 'insetMinX', 0, 2.4, 0.05).name('回退左墙').onChange(pushWalkFallback),
    sf.add(walk, 'insetMaxX', 0, 2.4, 0.05).name('回退右墙').onChange(pushWalkFallback),
    sf.add(walk, 'insetMinZ', 0, 2.4, 0.05).name('回退前墙').onChange(pushWalkFallback),
    sf.add(walk, 'insetMaxZ', 0, 2.4, 0.05).name('回退后墙').onChange(pushWalkFallback),
  );
  revealWalkGui.push(...revealWalkFallbackGui);
  sf.add(CONFIG.reveal, 'showWalkHelper').name('显示行走范围').onChange(() => {
    syncRevealWalkHelper(revealCtl.walkSpace ?? revealCtl.walkBox);
  });
  syncWalkFallbackGui();
  sf.add(CONFIG.reveal, 'moveSpeed', 0.2, 4, 0.05).name('走速').onChange(syncRevealWalkFeel);
  sf.add(CONFIG.reveal, 'moveAccel', 0, 12, 0.1).name('加速').onChange(syncRevealWalkFeel);
  sf.add(CONFIG.reveal, 'moveDecel', 0, 16, 0.1).name('减速').onChange(syncRevealWalkFeel);
  sf.add(CONFIG.reveal, 'walkBob').name('晃动').onChange(syncRevealWalkFeel);
  sf.add(CONFIG.reveal, 'walkBobAmount', 0, 0.08, 0.002).name('晃动幅度').onChange(syncRevealWalkFeel);
  sf.add(CONFIG.reveal, 'walkBobHz', 0.4, 2.4, 0.05).name('晃动频率').onChange(syncRevealWalkFeel);
  sf.add(CONFIG.reveal, 'lookSpeedMax', 0, 8, 0.05).name('转头上限').onChange(syncRevealWalkFeel);
  sf.add(CONFIG.reveal, 'splatKeepSorted').name('跟手排序');

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
      toast(m === 'joystick' ? tr('moveStick') : tr('moveKeys'));
    },
    '设计稿叠加(G)': () => design.toggle(),
    '右布局(一幕)': () => mask.setLayout('right'),
    '居中(二~四幕)': () => mask.setLayout('center'),
    '展开16:9': () => mask.setLayout('wide'),
  };
  for (const k of Object.keys(act)) gui.add(act, k);
}
input.on('gui', () => {
  if (!guiUnlocked) return;
  guiOn = !guiOn;
  gui.show(guiOn);
  syncDocumentTitle();
});

// —— 调试钩子（控制台/自动化用）——
window.__debug = {
  claw, rig, director, mask, items, CONFIG, toast, world, modelFade, scene, narrativeBg,
  lights: { key, fill, glow, hemi, ambient },
  revealCtl, enableRevealControls, revealPreview, onReveal, setRevealWorld, unlockRevealWalk,
  preloadRotVisuals, poolScanBeat, applyRotLighting, restoreMemoryLighting,
  /** 控制台/自动化：看终幕"构件分组"认出来哪些（顶盖/立柱/面板 vs 底座/背板） */
  machineParts: () => {
    const p = collectMachineParts();
    const n = (a) => a.map(o => o.name || o.type);
    return { deck: n(p.deck), keep: n(p.keep), claw: n(p.clawParts), decor: n(p.decor), items: p.items.length };
  },
  /** 控制台/自动化：手动跑一段构件消失（'shell' | 'core' | 'all'） */
  fadeMachineStage,
  /** 控制台/自动化：把相机瞬间对到某个观察位（调试截图用，不等阻尼） */
  snapCamera: (view = 'front', zoom = 1) => {
    rig.setScan(null);
    rig.setView(view);
    rig.setZoom(zoom);
    rig.setUserZoom(1);
    for (let i = 0; i < 240; i++) rig.update(1 / 60, i / 60);
    return [rig.pos.x, rig.pos.y, rig.pos.z].map(v => +v.toFixed(2));
  },
  /** 控制台/自动化：每件物资这一刻到底装的是哪个模型、有没有贴图、材质是什么颜色 */
  visualReport: () => items.map((it) => {
    const mats = [];
    it.mesh?.traverse?.((o) => {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        mats.push({
          name: m.name || '',
          hasMap: !!m.map,
          mapSize: m.map?.image?.width ? `${m.map.image.width}x${m.map.image.height}` : null,
          color: m.color ? '#' + m.color.getHexString() : null,
          emissive: m.emissive ? '#' + m.emissive.getHexString() : null,
          roughness: m.roughness,
        });
      }
    });
    const box = new THREE.Box3().setFromObject(it.mesh);
    return {
      id: it.id,
      appearance: it.appearance,
      visualUrl: (it.visualUrl || '').split('/').pop() || null,
      visible: !!it.mesh?.visible,
      y: +it.mesh?.position?.y?.toFixed(3),
      size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)),
      matCount: mats.length,
      mats: mats.slice(0, 2),
    };
  }),
  /** 控制台/自动化：把奖池整体切到某一态（'manifest' | 'rot'），等价于幕间换货那一下 */
  setPoolAppearance: (appearance) => setPoolAppearance(items, appearance, { renderer, camera, parent: world, animate: false }),
  /** 控制台/自动化：看这一刻整池的显示态分布 */
  appearanceStats: () => items.reduce((m, it) => {
    const k = it.appearance ?? 'none';
    m[k] = (m[k] ?? 0) + 1;
    if (it.appearance === 'rot') m.rotIds = [...(m.rotIds ?? []), it.id];
    return m;
  }, {}),
  get revealImmersive() { return revealImmersive; },
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
const loadStartBtn = document.getElementById('loadStart');
let prizeDone = 0, prizeTotal = 1, clawLoaded = false, shellLoaded = false, shellTripoCount = 0, decorLoaded = false;

function setLoadStatus(msg) {
  const t = loadingEl?.querySelector('.t');
  if (t && msg) t.textContent = msg;
}

const paintLoading = () => {
  const frac = (prizeDone + (clawLoaded ? 1 : 0) + (shellLoaded ? 1 : 0) + (decorLoaded ? 1 : 0)) / (prizeTotal + 3);
  const pct = frac * 100 | 0;
  loadFill.style.width = pct + '%';
  loadPct.textContent = pct + '%';
  if (!shellLoaded) setLoadStatus(tr('loadShell'));
  else if (!clawLoaded) setLoadStatus(tr('loadClaw'));
  else if (prizeTotal > 0 && prizeDone < prizeTotal) {
    setLoadStatus(tr('loadStock', { n: prizeDone, total: prizeTotal }));
  } else if (!decorLoaded) setLoadStatus(tr('loadDecor'));
  else setLoadStatus(tr('loadArrange'));
};

let loadGateReady = false;
let gameStarted = false;

async function onLoadGateReady() {
  if (loadGateReady) return;
  loadGateReady = true;
  const startIdx = parseStartActIndex();
  director.setStartActIndex(startIdx);
  if ((ACTS[startIdx]?.id ?? 1) === 1) world.visible = false;
  setCoalesceIncrementalCompile(false);
  setLoadStatus(tr('loadWarm'));
  void enqueueRendererCompile(renderer, camera, world, { force: true });
  setLoadStatus(startIdx > 0
    ? tr('loadReadyAct', { n: ACTS[startIdx]?.id ?? startIdx + 1 })
    : tr('loadReady'));
  loadFill.style.width = '100%';
  loadPct.textContent = '100%';
  loadingEl?.classList.add('ready');
  loadingEl?.setAttribute('aria-busy', 'false');
  if (loadStartBtn) {
    loadStartBtn.hidden = false;
    loadStartBtn.focus();
  }
  if (window.__boot) {
    window.__boot.loadReady = true;
    window.__boot.started = true;
  }
}

function beginGame() {
  if (gameStarted) return;
  gameStarted = true;
  const startIdx = parseStartActIndex();
  unlockAudio();
  if (loadStartBtn) loadStartBtn.hidden = true;
  loadingEl?.classList.add('fading');
  // 字先收掉，黑场再慢慢揭开，盖住开场那一下编译卡顿
  setTimeout(() => {
    loadingEl?.classList.add('done');
    document.documentElement.classList.remove('game-booting');
    director.start();
    if (startIdx > 0) toast(tr('tryAct', { label: copy(ACTS[startIdx]?.label) || tr('loadReadyAct', { n: startIdx + 1 }) }));
    if (window.__boot) window.__boot.booted = true;
  }, 420);
  setTimeout(() => loadingEl?.remove(), 2400);
}

applyStaticCopy();
document.getElementById('langToggle')?.addEventListener('click', () => toggleLang());
onLangChange(() => {
  if (gameStarted || !loadingEl || loadingEl.classList.contains('done')) return;
  if (loadGateReady) {
    const startIdx = parseStartActIndex();
    setLoadStatus(startIdx > 0
      ? tr('loadReadyAct', { n: ACTS[startIdx]?.id ?? startIdx + 1 })
      : tr('loadReady'));
  } else paintLoading();
});

loadStartBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  beginGame();
});

fullBootReadiness().then(onLoadGateReady);
setTimeout(onLoadGateReady, 45000);

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
  modelFade.tick(dt);

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
    revealCtl.tick(dt, { axis: ax, keys: input.keys });   // moveWalk 走 axis；Q/E 不升降
    if (revealWalkAfterOrbit && !revealCtl.orbiting) unlockRevealWalk();
  } else if (revealPictureGate) {
    revealCtl.apply();
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
  applySplatPresentation();
  if (CONFIG.reveal.splatKeepSorted !== false && splatLookActive()) {
    for (const v of splatViewers()) {
      if (!v.sortRunning) v.runSplatSort(true);
    }
  }
  if (revealDissolve) {
    revealDissolve.update(dt, t);
  } else {
    post.render(dt, t);
    if (revealPictureGate) stepRevealPictureGate();
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
