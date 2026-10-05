if (window.top === window) document.getElementById('openAlone')?.remove();

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
if ('outputColorSpace' in previewRenderer && THREE.SRGBColorSpace) {
  previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
}
function fitPreview() {
  const canvas = previewRenderer.domElement;
  const size = Math.max(1, Math.round(canvas.clientWidth));
  if (canvas.width !== size || canvas.height !== size) previewRenderer.setSize(size, size, false);
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
  fitPreview();
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
    + rows.map(it => `<tr data-id="${esc(it.id)}"><td>${esc(it.name)}<div class="quest-line"><input type="checkbox" data-quest="${esc(it.id)}" ${it.quest ? 'checked' : ''} ${it.inGame ? '' : 'disabled'}><input type="text" data-dish="${esc(it.id)}" value="${esc(it.dish || '')}" placeholder="做成的菜"></div><span class="miss">${esc(it.id)}</span></td><td>${thumbButton(it.memory, it.id, 'memory')}</td><td>${thumbButton(it.rot, it.id, 'rot')}</td><td class="st-${esc(it.status)}">${esc(STATUS[it.status] || it.status)}</td></tr>`).join('');
  const unused = (data.orphans || []).filter(o => o.exists).map(o => `${o.id} ${kb(o.bytes)}`);
  document.getElementById('prizeOrphans').textContent = unused.length ? `未进池子：${unused.join(' · ')}` : '';
  publishedGame = data.published || [];
  renderQuest(rows);
  return rows;
}

let publishedGame = [];

function liveFaces(items) {
  const table = document.getElementById('prizeTable');
  return (items || []).filter(it => it.inGame).map(it => ({
    id: it.id,
    quest: !!table.querySelector(`[data-quest="${CSS.escape(it.id)}"]`)?.checked,
    dish: (table.querySelector(`[data-dish="${CSS.escape(it.id)}"]`)?.value ?? '').trim(),
    name: it.name || '',
    rotTo: it.rot?.id || '',
  }));
}

function syncReasons(items) {
  const live = liveFaces(items);
  const game = publishedGame;
  const reasons = [];
  const liveIds = new Set(live.map(r => r.id));
  const gameIds = new Set(game.map(r => r.id));
  const missing = [...liveIds].filter(id => !gameIds.has(id));
  const extra = [...gameIds].filter(id => !liveIds.has(id));
  if (missing.length) reasons.push(`游戏里还没有 ${missing.join('、')}`);
  if (extra.length) reasons.push(`游戏里多了 ${extra.join('、')}`);
  let quest = false;
  let dish = false;
  let other = false;
  for (const row of live) {
    const g = game.find(x => x.id === row.id);
    if (!g) continue;
    if (!!row.quest !== !!g.quest) quest = true;
    if ((row.dish || '') !== (g.dish || '')) dish = true;
    if (row.name !== (g.name || '') || row.rotTo !== (g.rotTo || '')) other = true;
  }
  if (quest) reasons.push('配额勾选还没写入');
  if (dish) reasons.push('菜名还没写入');
  if (other) reasons.push('名称或败露态还没写入');
  return reasons;
}

function paintSave(items) {
  const reasons = syncReasons(items);
  const btn = document.getElementById('saveQuest');
  const state = document.getElementById('syncState');
  const dirty = reasons.length > 0;
  btn.classList.toggle('dirty', dirty);
  btn.textContent = dirty ? '保存到游戏' : '已与游戏一致';
  if (state) {
    state.classList.toggle('dirty', dirty);
    state.textContent = dirty ? `与游戏不一致：${reasons.join('，')}` : '与游戏一致';
  }
}

function renderQuest(items) {
  const table = document.getElementById('prizeTable');
  const preview = () => {
    const dishes = [...table.querySelectorAll('[data-quest]:checked')].map(el => {
      const dish = table.querySelector(`[data-dish="${CSS.escape(el.dataset.quest)}"]`);
      return dish?.value.trim() || el.dataset.quest;
    });
    const el = document.getElementById('menuPreview');
    if (el) el.textContent = dishes.length ? `今日菜单：${dishes.join(' · ')}` : '还没有配额';
    paintSave(items);
  };
  table.querySelectorAll('[data-quest]').forEach(el => el.addEventListener('change', preview));
  table.querySelectorAll('[data-dish]').forEach(el => el.addEventListener('input', preview));
  preview();
  document.getElementById('saveQuest').onclick = async () => {
    const payload = (items || []).filter(it => it.inGame).map(it => ({
      id: it.id,
      quest: !!table.querySelector(`[data-quest="${CSS.escape(it.id)}"]`)?.checked,
      dish: table.querySelector(`[data-dish="${CSS.escape(it.id)}"]`)?.value ?? '',
      questLabel: it.questLabel || it.name,
    }));
    const res = await fetch('/api/prizes/quest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload }),
    }).then(r => r.json());
    if (res.error) { note(res.error); return; }
    if (res.published) publishedGame = res.published;
    for (const row of payload) {
      const it = (items || []).find(x => x.id === row.id);
      if (!it) continue;
      it.quest = row.quest;
      it.dish = row.dish.trim();
    }
    note(res.line ? `已写入游戏。\n${res.line}` : '已写入游戏');
    preview();
  };
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
  fitPreview();
  paint(previewRenderer);
});
preview.addEventListener('pointerup', () => { drag = null; });
addEventListener('resize', () => { if (shown) show(shown); });

const genNote = document.getElementById('genNote');
function note(text) { genNote.textContent = text; }

document.getElementById('genFill').addEventListener('click', async () => {
  const text = document.getElementById('genText').value;
  const res = await fetch('/api/prizes/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(r => r.json());
  if (res.error) { note(res.error); return; }
  if (!res.blocked && res.id) document.getElementById('genId').value = res.id;
  if (res.blocked) document.getElementById('genId').value = res.id || '';
  document.getElementById('genMemory').value = res.memoryPrompt || '';
  document.getElementById('genRot').value = res.rotPrompt || '';
  note(res.note || '已补全');
});

async function uploadRef() {
  const file = document.getElementById('genFile').files?.[0];
  if (!file) return null;
  const res = await fetch('/api/prizes/upload?filename=' + encodeURIComponent(file.name), {
    method: 'POST', body: file,
  }).then(r => r.json());
  if (res.error) throw new Error(res.error);
  return res.image;
}

function genBody(image) {
  return {
    id: document.getElementById('genId').value.trim(),
    name: document.getElementById('genText').value.trim(),
    memoryPrompt: document.getElementById('genMemory').value.trim(),
    rotPrompt: document.getElementById('genRot').value.trim(),
    image,
  };
}

document.getElementById('genRun').addEventListener('click', async () => {
  try {
    const image = await uploadRef();
    const body = genBody(image);
    if (!body.id || !body.memoryPrompt || !body.rotPrompt) {
      note('先补全，并填英文 id');
      return;
    }
    const ok = confirm(`生成新的一对 ${body.id} 和 ${body.id}-rot？会花两次积分，并写进游戏。已有的不会覆盖。`);
    if (!ok) return;
    const res = await fetch('/api/prizes/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json());
    if (res.error) { note(res.error); return; }
    note(`已开始生成 ${res.ids.join(' 和 ')}，并写入游戏池子`);
  } catch (err) { note(String(err.message ?? err)); }
});

let refreshing = false;
let seenJob = null;

async function refreshList() {
  if (refreshing) return;
  refreshing = true;
  const scroll = document.getElementById('listScroll');
  const top = scroll?.scrollTop ?? 0;
  try {
    const data = await fetch('/api/prizes').then(r => r.json());
    window.__prizeItems = data.items || [];
    const rows = renderTable(data);
    if (scroll) scroll.scrollTop = top;
    await drawThumbs(rows);
  } finally {
    refreshing = false;
  }
}

async function pollJob() {
  try {
    const job = await fetch('/api/prizes/job').then(r => r.json());
    if (!job.ids?.length) return;
    const line = job.running
      ? `正在生成：${(job.pending || []).join(', ')}`
      : `生成结束：完成 ${(job.done || []).join(', ') || '无'}${job.pending?.length ? '；还没有 ' + job.pending.join(', ') : ''}`;
    document.getElementById('genJob').textContent = line;
    const sig = `${job.running ? 1 : 0}|${(job.pending || []).join(',')}|${(job.done || []).join(',')}`;
    if (seenJob !== null && sig !== seenJob) await refreshList();
    seenJob = sig;
  } catch { /* 面板还没重启时忽略 */ }
}
setInterval(pollJob, 4000);
pollJob();

await refreshList();
