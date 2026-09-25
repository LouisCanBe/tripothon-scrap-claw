// 独立出货展示屏（display.html）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { subscribeCollectDisplay, readLastCollectEvent } from './collectDisplayBus.js';
import { applyComicStyle } from '/comic-render.mjs';
import { createCollectEntrance, getEntranceConfig } from './collectDisplayEntrance.js';

const stage = document.getElementById('stage');
const elName = document.getElementById('prizeName');
const elMeta = document.getElementById('prizeMeta');
const elStatus = document.getElementById('status');
const elCta = document.getElementById('cta');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0e);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);

function layoutStage() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (w < 1 || h < 1) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
layoutStage();
new ResizeObserver(() => layoutStage()).observe(stage);
camera.position.set(0, 0.55, 2.4);

const hemi = new THREE.HemisphereLight(0xfff2dd, 0x1a1a22, 0.85);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe7c4, 0.9);
key.position.set(2, 4, 3);
scene.add(key);
const fill = new THREE.DirectionalLight(0xc8d4ff, 0.45);
fill.position.set(-2, 2, -2);
scene.add(fill);

/** 展台根：每次出货清空；spinGroup 只负责 idle 自转，content 负责入场位移 */
const stageRoot = new THREE.Group();
scene.add(stageRoot);

let spinGroup = null;
let entrance = null;
let displaySpinRate = 0;
let showGeneration = 0;
let pendingPrizeId = null;
const glbCache = new Map();

function disposeObject3D(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose?.();
    }
  });
}

function clearStage() {
  entrance = null;
  spinGroup = null;
  displaySpinRate = 0;
  for (const child of stageRoot.children) disposeObject3D(child);
  stageRoot.clear();
}

function fitObject(obj, targetSize = 1.1) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = targetSize / Math.max(size.x, size.y, size.z, 1e-6);
  obj.scale.setScalar(s);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.sub(c);
  obj.position.y -= box.min.y;
}

function preloadGlb(prize) {
  if (!prize?.glbUrl || glbCache.has(prize.id)) return;
  glbCache.set(
    prize.id,
    new GLTFLoader().loadAsync(prize.glbUrl).then((g) => g.scene),
  );
}

async function loadPrizeScene(prize) {
  if (!prize?.glbUrl) return null;
  preloadGlb(prize);
  const p = glbCache.get(prize.id);
  if (!p) return null;
  const scene = await p;
  return scene.clone(true);
}

function buildFallbackMesh(prize) {
  const color = prize.category === 'food' ? 0xc8a06a : 0x7a7d85;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.22, 0.28),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.y = 0.11;
  return mesh;
}

function mountPrizeVisual(model, prize) {
  const entCfg = getEntranceConfig();
  spinGroup = new THREE.Group();
  const lift = new THREE.Group();
  const tumble = new THREE.Group();
  tumble.add(model);
  lift.add(tumble);
  spinGroup.add(lift);
  stageRoot.add(spinGroup);

  if (entCfg.comicFx !== false) {
    applyComicStyle(model, true, { outline: entCfg.outline ?? 0.022 });
  }
  entrance = createCollectEntrance(lift, tumble, prize);
}

async function showPrize(prize, { fromDropHint = false } = {}) {
  if (!prize) return;
  const gen = ++showGeneration;

  elName.textContent = prize.name ?? prize.id ?? '—';
  elMeta.textContent = [prize.category === 'food' ? '食物' : '杂物', prize.quest ? '任务物' : null]
    .filter(Boolean).join(' · ');
  elCta.hidden = false;
  elCta.dataset.prizeId = prize.id ?? '';

  clearStage();
  elStatus.textContent = fromDropHint ? '出货中 · 准备展示…' : '加载模型…';

  const targetSize = 1.15 * (prize.visualScale ?? 1) * 0.4;

  try {
    let model = null;
    if (prize.glbUrl) {
      model = await loadPrizeScene(prize);
      if (gen !== showGeneration) return;
    }
    if (!model) {
      model = buildFallbackMesh(prize);
    } else {
      fitObject(model, targetSize);
    }
    if (gen !== showGeneration) {
      disposeObject3D(model);
      return;
    }
    mountPrizeVisual(model, prize);
    elStatus.textContent = '已出货';
  } catch (e) {
    console.warn(e);
    if (gen !== showGeneration) return;
    mountPrizeVisual(buildFallbackMesh(prize), prize);
    elStatus.textContent = '模型加载失败，显示占位';
  }
}

function onEvent(msg) {
  if (!msg?.prize) return;
  const prize = msg.prize;
  if (msg.type === 'collect.hole_drop') {
    pendingPrizeId = prize.id;
    preloadGlb(prize);
    elStatus.textContent = '出货中…';
    elName.textContent = prize.name ?? prize.id ?? '—';
    return;
  }
  if (msg.type === 'collect.vended') {
    pendingPrizeId = null;
    showPrize(prize, { fromDropHint: true });
  }
}

subscribeCollectDisplay(onEvent);
const last = readLastCollectEvent();
if (last?.type === 'collect.vended') showPrize(last.prize);
else if (last?.type === 'collect.hole_drop') onEvent(last);

addEventListener('resize', layoutStage);

const damp = (a, b, tau, dt) => a + (b - a) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
const clock = new THREE.Clock();

function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();
  const entCfg = getEntranceConfig();
  if (entrance) entrance.update(dt);
  if (spinGroup) {
    const target = entrance?.active
      ? (entCfg.spinDuringEntrance ?? 0.22)
      : (entCfg.idleSpin ?? 0.85);
    displaySpinRate = damp(displaySpinRate, target, entCfg.spinBlendTau ?? 0.4, dt);
    if (displaySpinRate > 1e-4) spinGroup.rotation.y += dt * displaySpinRate;
  } else {
    displaySpinRate = 0;
  }
  renderer.render(scene, camera);
}
loop();

// 调参：副屏控制台改 CONFIG.collectDisplay.entrance 后刷新；与主游戏共用 config.js
window.__display = { CONFIG, showPrize, clearStage };
