// 独立出货展示屏（display.html）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import {
  subscribeCollectDisplay, readLastCollectEvent, resolveCollectPair, shouldUseRemoteSubscribe,
} from './collectDisplayBus.js';
import { applyComicStyle } from '/comic-render.mjs';
import { createCollectEntrance, getEntranceConfig } from './collectDisplayEntrance.js';

const FRAME = document.documentElement.dataset.display === 'frame';
const stage = document.getElementById('stage');
const elName = document.getElementById('prizeName');
const elMeta = document.getElementById('prizeMeta');
const elStatus = document.getElementById('status');
const elLink = document.getElementById('link');
const elCta = document.getElementById('cta');
const elKicker = document.querySelector('header h1');

const copy = CONFIG.collectDisplay.copy ?? {};
if (elKicker && copy.kicker) elKicker.textContent = copy.kicker;
if (copy.waiting) elName.textContent = copy.waiting;
if (copy.statusIdle) elStatus.textContent = copy.statusIdle;
if (elCta && copy.cta) elCta.textContent = copy.cta;

let paintFrameLabels = () => {};
let layoutFrameLabels = () => {};

let sseState = shouldUseRemoteSubscribe() ? 'connecting' : 'open';
let hubGameActive = false;
let sawGameEvent = false;

function refreshLinkLine() {
  const pair = resolveCollectPair();
  if (!shouldUseRemoteSubscribe()) {
    elLink.textContent = '同步：本地（同机 BroadcastChannel）';
    paintFrameLabels();
    return;
  }
  const conn = { connecting: '连接服务器…', open: '已连服务器', error: '重连中…' }[sseState] ?? sseState;
  let hint = '';
  if (sseState === 'open') {
    if (sawGameEvent) hint = ' · 已与主游戏联动';
    else if (hubGameActive) hint = ' · 主游戏在线，等待出货';
    else hint = ' · 请先打开主游戏（同 WiFi、同 pair）';
  }
  elLink.textContent = `${conn} · pair=${pair}${hint}`;
  paintFrameLabels();
}
refreshLinkLine();

function onHubStatus(msg) {
  if (msg?.type !== 'collect.hub_status') return;
  hubGameActive = !!msg.gameActive;
  // 主游戏超过 GAME_ACTIVE_MS 无 ping/出货 → 副屏文案回「请先打开主游戏」
  if (!hubGameActive) sawGameEvent = false;
  refreshLinkLine();
}

const renderer = new THREE.WebGLRenderer({
  antialias: !FRAME,
  alpha: !FRAME,
  powerPreference: FRAME ? 'high-performance' : undefined,
});
renderer.setPixelRatio(FRAME ? (devicePixelRatio || 1) : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
let interlacer = null;

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
  layoutFrameLabels();
}
layoutStage();
new ResizeObserver(() => layoutStage()).observe(stage);
camera.position.set(0, 0.55, 2.4);

if (FRAME) {
  // 文字画在焦平面上，左右眼看到同一位置，透镜不会把字切成条纹。
  scene.add(camera);
  const labelDistance = CONFIG.collectDisplay.frame?.focusDistance ?? 2.5;
  const font = '"Microsoft YaHei", "Segoe UI", sans-serif';

  function makeBand(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    return { canvas, ctx, tex, mesh };
  }

  function paintBand(band, lines) {
    const { ctx, canvas, tex } = band;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let y = 28;
    for (const line of lines) {
      const text = (line.text ?? '').trim();
      if (!text) continue;
      let size = line.size;
      ctx.font = `${line.weight} ${size}px ${font}`;
      while (size > 28 && ctx.measureText(text).width > w - 96) {
        size -= 2;
        ctx.font = `${line.weight} ${size}px ${font}`;
      }
      ctx.fillStyle = line.color;
      ctx.fillText(text, 48, y);
      y += size + line.gap;
    }
    tex.needsUpdate = true;
  }

  const topBand = makeBand(1600, 480);
  const bottomBand = makeBand(1600, 360);
  camera.add(topBand.mesh, bottomBand.mesh);

  layoutFrameLabels = () => {
    const d = labelDistance;
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * d;
    const viewW = viewH * Math.max(camera.aspect, 0.01);
    const topH = viewH * 0.30;
    const botH = viewH * 0.22;
    topBand.mesh.scale.set(viewW, topH, 1);
    topBand.mesh.position.set(0, (viewH - topH) / 2, -d);
    bottomBand.mesh.scale.set(viewW, botH, 1);
    bottomBand.mesh.position.set(0, -(viewH - botH) / 2, -d);
  };

  paintFrameLabels = () => {
    paintBand(topBand, [
      { text: elKicker?.textContent, size: 42, weight: 600, color: 'rgba(240,236,224,0.75)', gap: 18 },
      { text: elName?.textContent, size: 88, weight: 600, color: '#f0ece0', gap: 16 },
      { text: elMeta?.textContent, size: 40, weight: 400, color: 'rgba(240,236,224,0.65)', gap: 12 },
    ]);
    paintBand(bottomBand, [
      { text: elLink?.textContent, size: 34, weight: 400, color: 'rgba(240,236,224,0.55)', gap: 14 },
      { text: elStatus?.textContent, size: 40, weight: 400, color: 'rgba(240,236,224,0.78)', gap: 18 },
      { text: elCta && !elCta.hidden ? elCta.textContent : '', size: 38, weight: 400, color: 'rgba(240,236,224,0.85)', gap: 12 },
    ]);
  };
  layoutFrameLabels();
  paintFrameLabels();
}

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
  paintFrameLabels();

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
    paintFrameLabels();
  } catch (e) {
    console.warn(e);
    if (gen !== showGeneration) return;
    mountPrizeVisual(buildFallbackMesh(prize), prize);
    elStatus.textContent = '模型加载失败，显示占位';
    paintFrameLabels();
  }
}

function onEvent(msg) {
  if (msg?.type === 'collect.hub_status') {
    onHubStatus(msg);
    return;
  }
  if (!msg?.prize) return;
  sawGameEvent = true;
  refreshLinkLine();
  const prize = msg.prize;
  if (msg.type === 'collect.hole_drop') {
    pendingPrizeId = prize.id;
    preloadGlb(prize);
    elStatus.textContent = '出货中…';
    elName.textContent = prize.name ?? prize.id ?? '—';
    paintFrameLabels();
    return;
  }
  if (msg.type === 'collect.vended') {
    pendingPrizeId = null;
    showPrize(prize, { fromDropHint: true });
  }
}

subscribeCollectDisplay(onEvent, {
  onLink: (s) => {
    sseState = s;
    refreshLinkLine();
  },
});
if (!shouldUseRemoteSubscribe()) {
  const last = readLastCollectEvent();
  if (last?.type === 'collect.vended') showPrize(last.prize);
  else if (last?.type === 'collect.hole_drop') onEvent(last);
}

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
  if (interlacer) interlacer.render(scene, camera);
  else renderer.render(scene, camera);
}

function frameNumber(key, fallback) {
  const raw = new URLSearchParams(location.search).get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function startDisplay() {
  if (FRAME) {
    try {
      const { InterlaceRenderer } = await import('jupiter-interlace-sdk');
      const frame = CONFIG.collectDisplay.frame ?? {};
      const mode = new URLSearchParams(location.search).get('mode');
      interlacer = new InterlaceRenderer(renderer, {
        calibration: {
          pitch: frameNumber('pitch', frame.pitch ?? 0.27777),
          tan: frameNumber('tan', frame.tan ?? 10),
          offset: frameNumber('offset', frame.offset ?? 2),
          order: 'forward',
          subpixelOrder: 'RGB',
          rotation: 0,
        },
        render: {
          mode: mode === '2d' || mode === 'view' ? mode : 'interlaced',
          views: frame.views ?? 9,
          viewWidth: frame.viewWidth ?? 480,
          viewSpacing: frame.viewSpacing ?? 0.04,
          focusDistance: frame.focusDistance ?? 2.5,
          toneMapping: 'aces',
          exposure: 1,
        },
      });
    } catch (e) {
      console.warn(e);
      elStatus.textContent = '交织不可用，已改普通画面';
    }
  }
  loop();
}
startDisplay();

// 调参：副屏控制台改 CONFIG.collectDisplay.entrance 后刷新；与主游戏共用 config.js
window.__display = { CONFIG, showPrize, clearStage };
