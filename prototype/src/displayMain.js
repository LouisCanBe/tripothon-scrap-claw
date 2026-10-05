// 独立出货展示屏（display.html）
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import {
  subscribeCollectDisplay, readLastCollectEvent, resolveCollectPair, shouldUseRemoteSubscribe,
  itemToPrizePayload,
} from './collectDisplayBus.js';
import { PRIZE_TABLE } from './prizePool.js';
import { applyComicStyle } from '/comic-render.mjs';
import { createCollectEntrance, getEntranceConfig } from './collectDisplayEntrance.js';
import { YAW_STEPS, clipBase, clipGet, clipKey, clipPut } from './frameClipStore.js';

const FRAME = document.documentElement.dataset.display === 'frame';
const RELAY_HOST = FRAME && new URLSearchParams(location.search).get('relay') === 'host';
let relayDirty = true;
let relayDragging = false;
let relayDragTimer = 0;
let pixelLocked = false;
let bakeCancel = false;
let relayBaking = false;
let relayQuiet = false;
let relayQuietTimer = 0;
let clipStamp = '';
let ackResolve = null;
let bakeRunning = null;
const frameReady = new Set();
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
let setFrameChromeVisible = () => {};

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
  preserveDrawingBuffer: RELAY_HOST,
});
renderer.setPixelRatio(RELAY_HOST ? 1 : (FRAME ? (devicePixelRatio || 1) : Math.min(devicePixelRatio, 2)));
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);
let interlacer = null;

const scene = new THREE.Scene();
scene.background = new THREE.Color(FRAME ? 0xf3f0e8 : 0x0a0a0e);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40);

let calCard = null;
let calPatternOn = false;

function layoutCalCard() {
  if (!calCard) return;
  const d = CONFIG.collectDisplay.frame?.focusDistance ?? 2.5;
  const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * d;
  const viewW = viewH * Math.max(camera.aspect, 0.01);
  calCard.scale.set(viewW * 0.92, viewH * 0.92, 1);
  calCard.position.set(0, 0, -d);
}

function ensureCalCard() {
  if (!FRAME || calCard) return;
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1600;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 900, 1600);
  ctx.fillStyle = '#ffffff';
  for (let x = 36; x < 900; x += 72) ctx.fillRect(x, 0, 5, 1600);
  ctx.fillStyle = '#ff2a2a';
  ctx.fillRect(418, 0, 10, 1600);
  ctx.fillStyle = '#2aff4a';
  ctx.fillRect(436, 0, 10, 1600);
  ctx.fillStyle = '#3a7bff';
  ctx.fillRect(454, 0, 10, 1600);
  ctx.fillStyle = '#ffffff';
  for (const y of [140, 800, 1460]) ctx.fillRect(0, y, 900, 6);
  ctx.fillRect(390, 792, 120, 16);
  ctx.fillRect(442, 740, 16, 120);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;
  camera.add(mesh);
  calCard = mesh;
}

function setCalPattern(on) {
  if (!FRAME) return;
  calPatternOn = !!on;
  ensureCalCard();
  layoutCalCard();
  if (calCard) calCard.visible = calPatternOn;
  stageRoot.visible = !calPatternOn;
  if (frameRoom) frameRoom.visible = !calPatternOn;
  setFrameChromeVisible(!calPatternOn);
  stage.dataset.cal = calPatternOn ? '1' : '0';
  relayDirty = true;
}

let relaySize = null;

function layoutStage() {
  const w = relaySize?.w || stage.clientWidth;
  const h = relaySize?.h || stage.clientHeight;
  if (w < 1 || h < 1) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  layoutFrameLabels();
  layoutCalCard();
  relayDirty = true;
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
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = Math.max(6, size * 0.14);
      ctx.strokeStyle = 'rgba(255,252,247,0.92)';
      ctx.strokeText(text, 48, y);
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
      { text: elKicker?.textContent, size: 42, weight: 600, color: 'rgba(42,36,28,0.78)', gap: 18 },
      { text: elName?.textContent, size: 88, weight: 600, color: '#1c1916', gap: 16 },
      { text: elMeta?.textContent, size: 40, weight: 400, color: 'rgba(42,36,28,0.72)', gap: 12 },
    ]);
    paintBand(bottomBand, [
      { text: elLink?.textContent, size: 34, weight: 400, color: 'rgba(42,36,28,0.62)', gap: 14 },
      { text: elStatus?.textContent, size: 40, weight: 400, color: '#2a241c', gap: 18 },
      { text: elCta && !elCta.hidden ? elCta.textContent : '', size: 38, weight: 400, color: '#1c1916', gap: 12 },
    ]);
  };
  layoutFrameLabels();
  paintFrameLabels();
  setFrameChromeVisible = (visible) => {
    topBand.mesh.visible = visible;
    bottomBand.mesh.visible = visible;
  };
}

const hemi = new THREE.HemisphereLight(0xfff2dd, 0x1a1a22, 0.85);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffe7c4, 0.9);
key.position.set(2, 4, 3);
scene.add(key);
if (!FRAME) {
  const fill = new THREE.DirectionalLight(0xc8d4ff, 0.45);
  fill.position.set(-2, 2, -2);
  scene.add(fill);
}

/** 展台根：每次出货清空；spinGroup 只负责 idle 自转，content 负责入场位移 */
const stageRoot = new THREE.Group();
scene.add(stageRoot);
let frameRoom = null;

function deepenRoomShade(root) {
  const seen = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      mat.toneMapped = false;
      if (!mat.map || seen.has(mat.map)) continue;
      seen.add(mat.map);
      const img = mat.map.image;
      const w = img?.width || 0;
      const h = img?.height || 0;
      if (!w || !h) continue;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const px = imageData.data;
      const paper = 243;
      const gain = 2.15;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 8) continue;
        for (let c = 0; c < 3; c++) {
          const drop = Math.max(0, paper - px[i + c]);
          px[i + c] = Math.max(0, Math.min(255, Math.round(paper - drop * gain)));
        }
      }
      ctx.putImageData(imageData, 0, 0);
      mat.map.image = canvas;
      mat.map.needsUpdate = true;
      mat.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
}

function loadFrameRoom() {
  if (!FRAME) return;
  const url = CONFIG.collectDisplay.frame?.room;
  if (!url) return;
  new GLTFLoader().load(url, (gltf) => {
    const room = gltf.scenes.find((s) => /deep/i.test(s.name || ''))
      || gltf.scenes[gltf.scenes.length - 1];
    room.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      obj.castShadow = false;
      obj.receiveShadow = false;
    });
    deepenRoomShade(room);
    room.visible = !calPatternOn;
    scene.add(room);
    frameRoom = room;
    relayDirty = true;
  }, undefined, (err) => console.warn(err));
}

if (FRAME) {
  const pad = renderer.domElement;
  let drag = null;
  const endDrag = (e) => {
    if (drag && e.pointerId === drag.id) drag = null;
  };
  pad.addEventListener('pointerdown', (e) => {
    drag = { id: e.pointerId, x: e.clientX };
    pad.setPointerCapture(e.pointerId);
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || !spinGroup) return;
    const dx = e.clientX - drag.x;
    drag.x = e.clientX;
    spinGroup.rotation.y += dx * 0.01;
    noteRelayDrag();
  });
  pad.addEventListener('pointerup', endDrag);
  pad.addEventListener('pointercancel', endDrag);
}

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

/**
 * 副屏的说明行。口径（剧情设计-拾荒娃娃机.md 第六节）：
 * 副屏展出的是**他以为他拿到了什么**，所以只显示 prize.name 与它在这一幕的身份，
 * **不显示真相** —— 主屏已经演过败露态，这里越郑重，落差越成立。
 * payload 里的 truthName 留给后续的"揭晓"交互（`#cta[data-prize-id]`），不做默认文案。
 */
function displayMetaLine(prize) {
  const kind = prize.category === 'food' ? '食物' : '杂物';
  const face = prize.sourceAppearance === 'rot' ? '败露态' : '显形态';
  const parts = [kind, face];
  if (prize.quest) parts.push('任务物');
  return parts.join(' · ');
}

function clearStage() {
  entrance = null;
  spinGroup = null;
  displaySpinRate = 0;
  for (const child of stageRoot.children) disposeObject3D(child);
  stageRoot.clear();
}

function frameTargetSize() {
  const dist = Math.max(Math.abs(camera.position.z), 0.5);
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist;
  const halfW = halfH * Math.max(camera.aspect, 0.01);
  const fit = CONFIG.collectDisplay.frame?.fit ?? 0.7;
  return Math.min(halfW, halfH) * 2 * fit;
}

function fitObject(obj, targetSize = 1.1, centerY = null) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = targetSize / Math.max(size.x, size.y, size.z, 1e-6);
  obj.scale.setScalar(s);
  box.setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.sub(c);
  if (centerY == null) obj.position.y -= box.min.y;
  else obj.position.y += centerY;
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

function lightenFrameMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const converted = list.map((src) => {
      if (!src) return src;
      const mat = new THREE.MeshLambertMaterial();
      if (src.color) mat.color.copy(src.color);
      mat.map = src.map || null;
      mat.alphaMap = src.alphaMap || null;
      mat.transparent = !!src.transparent;
      mat.opacity = src.opacity ?? 1;
      mat.alphaTest = src.alphaTest || 0;
      mat.side = src.side;
      mat.depthWrite = src.depthWrite;
      mat.depthTest = src.depthTest;
      if (src.emissive) mat.emissive.copy(src.emissive);
      mat.emissiveMap = src.emissiveMap || null;
      mat.emissiveIntensity = src.emissiveIntensity ?? 1;
      return mat;
    });
    obj.material = Array.isArray(obj.material) ? converted : converted[0];
    obj.castShadow = false;
    obj.receiveShadow = false;
  });
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

  if (FRAME) lightenFrameMaterials(model);
  else if (entCfg.comicFx !== false) {
    applyComicStyle(model, true, { outline: entCfg.outline ?? 0.022 });
  }
  entrance = createCollectEntrance(lift, tumble, prize);
}

async function showPrize(prize, { fromDropHint = false } = {}) {
  if (!prize) return;
  const gen = ++showGeneration;
  if (RELAY_HOST) {
    bakeCancel = true;
    while (relayBaking) await new Promise((r) => setTimeout(r, 40));
    bakeCancel = false;
  }
  if (gen !== showGeneration) return;

  const cached = RELAY_HOST && pixelLocked ? await clipGet(currentClipKey(prize.id)) : null;
  if (cached?.drop?.length) relayQuiet = true;

  elName.textContent = prize.name ?? prize.id ?? '—';
  elMeta.textContent = displayMetaLine(prize);
  elCta.hidden = false;
  elCta.dataset.prizeId = prize.id ?? '';

  clearStage();
  elStatus.textContent = cached?.drop?.length
    ? '读取缓存…'
    : (fromDropHint ? '出货中 · 准备展示…' : '加载模型…');
  paintFrameLabels();
  relayDirty = true;

  const targetSize = FRAME
    ? frameTargetSize()
    : 1.15 * (prize.visualScale ?? 1) * 0.4;

  try {
    let model = null;
    if (prize.glbUrl) {
      model = await loadPrizeScene(prize);
      if (gen !== showGeneration) return;
    }
    if (!model) {
      model = buildFallbackMesh(prize);
    } else {
      fitObject(model, targetSize, FRAME ? camera.position.y : null);
    }
    if (gen !== showGeneration) {
      disposeObject3D(model);
      return;
    }
    mountPrizeVisual(model, prize);
    elStatus.textContent = '已出货';
    paintFrameLabels();
    if (cached?.drop?.length) {
      settleEntrance();
      if (!frameReady.has(prize.id)) await pushClip(prize.id, cached);
      holdRelayQuiet(cached.drop.length);
      sendRelay({ type: 'play', prizeId: prize.id, kind: 'drop', stamp: clipStamp });
      relayDirty = false;
    } else {
      relayQuiet = false;
    }
  } catch (e) {
    console.warn(e);
    relayQuiet = false;
    if (gen !== showGeneration) return;
    mountPrizeVisual(buildFallbackMesh(prize), prize);
    elStatus.textContent = '模型加载失败，显示占位';
    paintFrameLabels();
  }
}

function onEvent(msg) {
  if (msg?.type === 'frame.calibration') {
    applyFrameCalibration(msg);
    return;
  }
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
let relayShownAt = performance.now();

function loop() {
  requestAnimationFrame(loop);
  if (relayBaking) return;
  const rawDt = clock.getDelta();
  const spinDt = FRAME ? Math.min(rawDt, 1 / 30) : rawDt;
  const entCfg = getEntranceConfig();
  if (RELAY_HOST && entrance?.active && !relayBusy) {
    let left = Math.min(Math.max((performance.now() - relayShownAt) / 1000, 0), 0.2);
    while (left > 1e-4 && entrance.active) {
      const step = Math.min(left, 1 / 60);
      entrance.update(step);
      left -= step;
    }
  } else if (entrance && !RELAY_HOST) {
    entrance.update(spinDt);
  }
  if (spinGroup) {
    const target = FRAME
      ? (CONFIG.collectDisplay.frame?.spin ?? 0)
      : (entrance?.active
        ? (entCfg.spinDuringEntrance ?? 0.22)
        : (entCfg.idleSpin ?? 0.85));
    displaySpinRate = damp(displaySpinRate, target, entCfg.spinBlendTau ?? 0.4, spinDt);
    if (displaySpinRate > 1e-4) spinGroup.rotation.y += spinDt * displaySpinRate;
  } else {
    displaySpinRate = 0;
  }
  const moving = RELAY_HOST && (!!entrance?.active || relayDragging);
  if (RELAY_HOST) {
    const prevTier = relayTier;
    syncRelayTier(moving);
    if (prevTier !== relayTier) relayDirty = true;
  }
  const draw = !RELAY_HOST || (!relayQuiet && (relayDirty || moving) && !relayBusy && relayViews > 0 && relaySize);
  if (!draw) return;
  if (interlacer) interlacer.render(scene, camera);
  else renderer.render(scene, camera);
  const sent = pushRelayFrame();
  if (sent) relayShownAt = performance.now();
  if (RELAY_HOST && !moving && sent) relayDirty = false;
}

let relaySocket = null;
let relayViews = 0;
let relayBusy = false;
let relayTier = 'sharp';
let sharpViews = null;
let sharpViewWidth = null;

function noteRelayDrag() {
  if (!RELAY_HOST) return;
  relayDragging = true;
  relayDirty = true;
  clearTimeout(relayDragTimer);
  relayDragTimer = setTimeout(() => {
    relayDragging = false;
    relayDirty = true;
  }, 160);
}

function sharpProfile() {
  const frame = CONFIG.collectDisplay.frame ?? {};
  return {
    views: sharpViews ?? frame.views ?? 9,
    viewWidth: sharpViewWidth ?? frame.viewWidth ?? 640,
  };
}

function syncRelayTier(moving) {
  if (!interlacer) return;
  const next = moving ? 'motion' : 'sharp';
  if (next === relayTier) return;
  relayTier = next;
  const sharp = sharpProfile();
  interlacer.setOptions(next === 'motion'
    ? { views: Math.min(9, sharp.views), viewWidth: Math.min(640, sharp.viewWidth) }
    : { views: sharp.views, viewWidth: sharp.viewWidth });
}

function pushRelayFrame() {
  if (!RELAY_HOST || relayViews < 1 || !relaySize || relayBusy) return false;
  const sock = relaySocket;
  if (!sock || sock.readyState !== 1) return false;
  relayBusy = true;
  renderer.domElement.toBlob(async (blob) => {
    try {
      if (blob && sock.readyState === 1) sock.send(await blob.arrayBuffer());
    } finally {
      relayBusy = false;
    }
  }, 'image/png');
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clipCal() {
  const frame = CONFIG.collectDisplay.frame ?? {};
  const msg = pendingCalibration || {};
  return {
    pitch: Number.isFinite(msg.pitch) ? msg.pitch : (frame.pitch ?? 0.27777),
    offset: Number.isFinite(msg.offset) ? msg.offset : (frame.offset ?? 2),
    tan: Number.isFinite(msg.tan) ? msg.tan : (frame.tan ?? 10),
    spacing: frame.viewSpacing ?? 0.02,
  };
}

function refreshClipStamp() {
  const sharp = sharpProfile();
  clipStamp = clipBase(relaySize, {
    ...clipCal(),
    views: sharp.views,
    viewWidth: sharp.viewWidth,
  });
  return clipStamp;
}

function currentClipKey(id) {
  return clipKey(refreshClipStamp(), id);
}

function sendRelay(obj) {
  if (relaySocket?.readyState === 1) relaySocket.send(JSON.stringify(obj));
}

function holdRelayQuiet(frames) {
  relayQuiet = true;
  clearTimeout(relayQuietTimer);
  relayQuietTimer = setTimeout(() => { relayQuiet = false; }, frames * 50 + 400);
}

function settleEntrance() {
  let n = 0;
  while (entrance?.active && n < 120) {
    entrance.update(1 / 20);
    n += 1;
  }
}

function waitClipAck() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 4000);
    ackResolve = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
}

async function pushClip(id, rec) {
  if (!relaySocket || relaySocket.readyState !== 1 || frameReady.has(id)) return;
  sendRelay({ type: 'stamp', stamp: clipStamp });
  for (const kind of ['drop', 'yaw']) {
    const list = rec[kind] || [];
    for (let i = 0; i < list.length; i += 1) {
      if (bakeCancel) return;
      sendRelay({
        type: 'clip', prizeId: id, kind, index: i, count: list.length, stamp: clipStamp,
      });
      relaySocket.send(list[i]);
      await waitClipAck();
    }
  }
}

function renderPng() {
  if (interlacer) interlacer.render(scene, camera);
  else renderer.render(scene, camera);
  return new Promise((resolve) => {
    renderer.domElement.toBlob(async (blob) => {
      resolve(blob ? await blob.arrayBuffer() : null);
    }, 'image/png');
  });
}

async function stageForBake(prize) {  elName.textContent = prize.name ?? prize.id ?? '—';
  elMeta.textContent = displayMetaLine(prize);
  elCta.hidden = false;
  elStatus.textContent = '已出货';
  clearStage();
  paintFrameLabels();
  const targetSize = frameTargetSize();
  let model = prize.glbUrl ? await loadPrizeScene(prize) : null;
  if (!model) model = buildFallbackMesh(prize);
  else fitObject(model, targetSize, camera.position.y);
  mountPrizeVisual(model, prize);
  paintFrameLabels();
}

async function bakeOne(prize) {
  if (!relaySize || bakeCancel) return;
  relayBaking = true;
  try {
    const key = currentClipKey(prize.id);
    let rec = await clipGet(key);
    if (rec?.drop?.length && rec?.yaw?.length === YAW_STEPS) {
      await pushClip(prize.id, rec);
      return;
    }
    document.title = `预计算 ${prize.name || prize.id}`;
    await stageForBake(prize);
    if (bakeCancel) return;
    relayTier = '';
    syncRelayTier(true);
    const drop = [];
    let guard = 0;
    while (entrance?.active && guard < 80 && !bakeCancel) {
      entrance.update(1 / 20);
      const png = await renderPng();
      if (png) drop.push(png);
      guard += 1;
      document.title = `预计算 ${prize.name || prize.id} 下落 ${guard}`;
    }
    if (bakeCancel || !drop.length) return;
    relayTier = '';
    syncRelayTier(false);
    if (spinGroup) spinGroup.rotation.y = 0;
    const landed = await renderPng();
    if (landed) drop.push(landed);
    const yaw = [];
    for (let i = 0; i < YAW_STEPS && !bakeCancel; i += 1) {
      spinGroup.rotation.y = (i / YAW_STEPS) * Math.PI * 2;
      const png = await renderPng();
      if (png) yaw.push(png);
      document.title = `预计算 ${prize.name || prize.id} 转向 ${i + 1}/${YAW_STEPS}`;
    }
    if (bakeCancel || yaw.length !== YAW_STEPS) return;
    if (spinGroup) spinGroup.rotation.y = 0;
    rec = { drop, yaw };
    await clipPut(key, rec);
    await pushClip(prize.id, rec);
  } finally {
    relayBaking = false;
  }
}

function runBakeQueue() {
  if (bakeRunning) return bakeRunning;
  bakeCancel = false;
  relayBaking = true;
  bakeRunning = (async () => {
    try {
      while (!interlacer || !relaySize) {
        if (bakeCancel) return;
        await sleep(100);
      }
      let spins = 0;
      while (!frameRoom && spins < 30) {
        spins += 1;
        await sleep(100);
      }
      sendRelay({ type: 'stamp', stamp: refreshClipStamp() });
      await sleep(600);
      for (let i = 0; i < PRIZE_TABLE.length; i += 1) {
        if (bakeCancel) break;
        const prize = itemToPrizePayload(PRIZE_TABLE[i]);
        const rec = await clipGet(currentClipKey(prize.id));
        if (rec?.drop?.length && rec?.yaw?.length === YAW_STEPS) {
          document.title = `送缓存 ${i + 1}/${PRIZE_TABLE.length} ${prize.name}`;
          await pushClip(prize.id, rec);
        }
      }
      const total = PRIZE_TABLE.length;
      for (let i = 0; i < total; i += 1) {
        if (bakeCancel) break;
        const prize = itemToPrizePayload(PRIZE_TABLE[i]);
        document.title = `预计算 ${i + 1}/${total} ${prize.name}`;
        await bakeOne(prize);
      }
      if (!bakeCancel) {
        elStatus.textContent = '这块相框的画面缓存已备好';
        paintFrameLabels();
        relayDirty = true;
        document.title = '相框缓存已备好';
      }
    } finally {
      relayBaking = false;
      bakeRunning = null;
    }
  })();
  return bakeRunning;
}

if (RELAY_HOST) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const openRelay = () => {
    const sock = new WebSocket(`${proto}://${location.host}/api/frame/stream?role=host`);
    relaySocket = sock;
    sock.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'views') relayViews = msg.n | 0;
      if (msg.type === 'hello' && msg.w > 0 && msg.h > 0) {
        relaySize = { w: msg.w | 0, h: msg.h | 0 };
        layoutStage();
        if (msg.lock) {
          pixelLocked = true;
          frameReady.clear();
          document.title = '相框像素已锁定，先送已有缓存';
          runBakeQueue();
        } else if (pixelLocked) {
          sendRelay({ type: 'stamp', stamp: refreshClipStamp() });
        }
      }
      if (msg.type === 'have') {
        const ids = Array.isArray(msg.ids) ? msg.ids : (msg.prizeId ? [msg.prizeId] : []);
        if (!msg.stamp || msg.stamp === clipStamp) for (const id of ids) frameReady.add(id);
      }
      if (msg.type === 'ack') ackResolve?.();
      if (msg.type === 'drag' && spinGroup && Number.isFinite(+msg.dx)) {
        spinGroup.rotation.y += (+msg.dx) * 0.01;
        noteRelayDrag();
      }
    };
    sock.onclose = () => setTimeout(openRelay, 800);
  };
  openRelay();
}

function frameNumber(key, fallback) {
  const raw = new URLSearchParams(location.search).get(key);
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

let pendingCalibration = null;

function applyFrameCalibration(msg) {
  if (!FRAME || !msg) return;
  pendingCalibration = msg;
  const pitch = msg.pitch;
  const offset = msg.offset;
  if (Number.isFinite(pitch) || Number.isFinite(offset)) {
    elStatus.textContent = `pitch ${Number.isFinite(pitch) ? pitch : '—'} · offset ${Number.isFinite(offset) ? offset : '—'}`;
    paintFrameLabels();
  }
  if (typeof msg.pattern === 'boolean') setCalPattern(msg.pattern);
  if (!interlacer) return;
  const cal = {};
  if (Number.isFinite(msg.pitch)) cal.pitch = msg.pitch;
  if (Number.isFinite(msg.tan)) cal.tan = msg.tan;
  if (Number.isFinite(msg.offset)) cal.offset = msg.offset;
  if (Object.keys(cal).length) {
    interlacer.setCalibration(cal);
    relayDirty = true;
  }
  const opt = {};
  if (Number.isFinite(msg.views)) {
    sharpViews = msg.views;
    opt.views = msg.views;
  }
  if (Number.isFinite(msg.viewWidth)) {
    sharpViewWidth = msg.viewWidth;
    opt.viewWidth = msg.viewWidth;
  }
  if (Number.isFinite(msg.viewSpacing)) opt.viewSpacing = msg.viewSpacing;
  if (Number.isFinite(msg.focusDistance)) opt.focusDistance = msg.focusDistance;
  if (Object.keys(opt).length) {
    if (relayTier === 'motion') {
      const sharp = sharpProfile();
      opt.views = Math.min(9, sharp.views);
      opt.viewWidth = Math.min(640, sharp.viewWidth);
    }
    interlacer.setOptions(opt);
    relayDirty = true;
  }
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
      applyFrameCalibration(pendingCalibration);
    } catch (e) {
      console.warn(e);
      elStatus.textContent = '交织不可用，已改普通画面';
    }
  }
  loop();
}
loadFrameRoom();
startDisplay();

// 调参：副屏控制台改 CONFIG.collectDisplay.entrance 后刷新；与主游戏共用 config.js
window.__display = { CONFIG, showPrize, clearStage };
