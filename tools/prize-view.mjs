import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const STATUS = {
  paired: '成套',
  'rot-pending': '待生成败露态',
  missing: '未生成',
  material: '只调材质',
  'memory-missing': '缺显形态',
};

const HALF = 0.26;
const loader = new GLTFLoader();
const cache = new Map();
const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
thumbRenderer.setSize(128, 128, false);
if ('outputColorSpace' in thumbRenderer && THREE.SRGBColorSpace) {
  thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
}
const previewRenderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('preview'),
  antialias: true,
  alpha: false,
});
previewRenderer.setSize(360, 360, false);
if ('outputColorSpace' in previewRenderer && THREE.SRGBColorSpace) {
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141418);
scene.add(new THREE.HemisphereLight(0xfff4e8, 0x2a241c, 0.95));
const key = new THREE.DirectionalLight(0xfff8f0, 1.25);
key.position.set(1.4, 2.2, 1.6);
scene.add(key);
const grid = new THREE.GridHelper(0.4, 8, 0x3a3a44, 0x2a2a32);
grid.position.y = 0;
scene.add(grid);

const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 0.01, 8);
camera.position.set(0.55, 0.42, 0.72);
camera.lookAt(0, 0.07, 0);

let shown = null;
let yaw = 0.4;
let pitch = 0.15;
let flashTimer = 0;
let flashSide = 0;
let activeItem = null;

function kb(n) { return n ? `${Math.round(n / 1024)}KB` : '缺'; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function slotTarget(collider) {
  const size = collider?.size ?? [0.1, 0.1, 0.1];
  if (collider?.shape === 'box') return Math.max(...size);
  if (collider?.shape === 'cylinder') return Math.max(size[0] * 2, size[1]);
  return (size[0] ?? 0.06) * 2;
}
function normalize(obj, collider) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const target = slotTarget(collider);
  obj.scale.setScalar(target / Math.max(size.x, size.y, size.z, 1e-6));
  obj.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(obj);
  const center = box2.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -box2.min.y, -center.z);
  const wrap = new THREE.Group();
  wrap.add(obj);
  return wrap;
}
function pose(group) {
  group.rotation.set(pitch, yaw, 0);
}
function paint(renderer, gridOn = true) {
  grid.visible = gridOn;
  renderer.render(scene, camera);
  grid.visible = true;
}
async function loadModel(url, collider) {
  if (cache.has(url)) return cache.get(url);
  const gltf = await loader.loadAsync(url);
  const group = normalize(gltf.scene, collider);
  cache.set(url, group);
  return group;
}
function show(group) {
  if (shown && shown !== group) scene.remove(shown);
  shown = group;
  if (!group) return;
  pose(group);
  if (group.parent !== scene) scene.add(group);
  paint(previewRenderer, true);
}

function fileUrl(file) {
  return `/assets/prizes-good-p2/${file.file}`;
}
function thumbButton(file, itemId, side) {
  if (!file.exists) {
    return `<button type="button" class="thumb" disabled><span class="ph">缺</span></button>
      <div class="miss">${esc(file.file)} 缺<br>${esc(file.label)}</div>`;
  }
  return `<button type="button" class="thumb" data-id="${esc(itemId)}" data-side="${side}" data-url="${esc(fileUrl(file))}">
      <img alt="${esc(file.label)}" />
      <span class="ph">绘制中</span>
    </button>
    <div class="miss">${esc(file.file)} ${kb(file.bytes)}<br>${esc(file.label)}</div>`;
}

function renderTable(data) {
  const c = data.counts || {};
  document.getElementById('prizeSummary').innerHTML =
    `奖池 ${c.total ?? 0} 件 · 成套 ${c.paired ?? 0} · <span class="warn">待生成败露态 ${c.rotPending ?? 0}</span> · <span class="warn">未生成 ${c.missing ?? 0}</span> · 配额 ${(data.quests || []).map(esc).join(' / ') || '—'}`;
  const rows = data.items || [];
  document.getElementById('prizeTable').innerHTML =
    '<tr><th>物品</th><th>显形态</th><th>败露态</th><th>状态</th></tr>'
    + rows.map(it => `<tr data-id="${esc(it.id)}"><td>${esc(it.name)}<br><span class="miss">${esc(it.id)}${it.quest ? ' · 配额' : ''}</span></td><td>${thumbButton(it.memory, it.id, 'memory')}</td><td>${thumbButton(it.rot, it.id, 'rot')}</td><td class="st-${esc(it.status)}">${esc(STATUS[it.status] || it.status)}</td></tr>`).join('');
  const unused = (data.orphans || []).filter(o => o.exists).map(o => `${o.id} ${kb(o.bytes)}`);
  document.getElementById('prizeOrphans').textContent = unused.length ? `未进池子：${unused.join(' · ')}` : '';
  return rows;
}

async function drawThumbs(rows) {
  const jobs = [];
  for (const it of rows) {
    for (const side of ['memory', 'rot']) {
      const file = it[side];
      if (!file?.exists) continue;
      const btn = document.querySelector(`.thumb[data-id="${CSS.escape(it.id)}"][data-side="${side}"]`);
      if (btn) jobs.push({ btn, url: fileUrl(file), collider: it.collider });
    }
  }
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const group = await loadModel(job.url, job.collider);
        pose(group);
        scene.add(group);
        paint(thumbRenderer, false);
        scene.remove(group);
        const img = job.btn.querySelector('img');
        img.src = thumbRenderer.domElement.toDataURL('image/png');
        job.btn.querySelector('.ph').remove();
      } catch (err) {
        const ph = job.btn.querySelector('.ph');
        if (ph) ph.textContent = '失败';
        console.warn('[prize]', job.url, err);
      }
    }
  }
  await worker();
}

function stopFlash() {
  clearInterval(flashTimer);
  flashTimer = 0;
  document.getElementById('flash').textContent = '并排闪切';
}

function select(item, side, fromFlash = false) {
  if (!fromFlash) stopFlash();
  activeItem = item;
  const file = item[side];
  const group = cache.get(fileUrl(file));
  document.querySelectorAll('.thumb.on').forEach(el => el.classList.remove('on'));
  document.querySelector(`.thumb[data-id="${CSS.escape(item.id)}"][data-side="${side}"]`)?.classList.add('on');
  const both = item.memory.exists && item.rot.exists;
  const flash = document.getElementById('flash');
  flash.disabled = !both;
  document.getElementById('stageMeta').textContent =
    `${item.name} · ${file.label} · ${file.file}${both ? '' : ' · 另一态还没有模型'}`;
  if (group) show(group);
}

document.getElementById('prizeTable').addEventListener('click', (e) => {
  const btn = e.target.closest('.thumb[data-url]');
  if (!btn || btn.disabled) return;
  const item = window.__prizeItems?.find(it => it.id === btn.dataset.id);
  if (!item) return;
  select(item, btn.dataset.side);
});

document.getElementById('flash').addEventListener('click', () => {
  if (!activeItem?.memory.exists || !activeItem?.rot.exists) return;
  if (flashTimer) { stopFlash(); return; }
  document.getElementById('flash').textContent = '停止闪切';
  const step = () => {
    flashSide = flashSide === 'rot' ? 'memory' : 'rot';
    try {
      select(activeItem, flashSide, true);
    } catch (err) {
      document.getElementById('stageMeta').textContent = String(err?.message ?? err);
    }
  };
  flashSide = 'memory';
  step();
  flashTimer = setInterval(step, 700);
});

const preview = document.getElementById('preview');
let drag = null;
preview.addEventListener('pointerdown', (e) => {
  if (!shown) return;
  drag = { x: e.clientX, y: e.clientY, yaw, pitch };
  preview.setPointerCapture(e.pointerId);
});
preview.addEventListener('pointermove', (e) => {
  if (!drag || !shown) return;
  yaw = drag.yaw + (e.clientX - drag.x) * 0.01;
  pitch = drag.pitch + (e.clientY - drag.y) * 0.01;
  pose(shown);
  paint(previewRenderer);
});
preview.addEventListener('pointerup', () => { drag = null; });

const data = await fetch('/api/prizes').then(r => r.json());
window.__prizeItems = data.items || [];
const rows = renderTable(data);
await drawThumbs(rows);
