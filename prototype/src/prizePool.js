// ============================================================
// 奖池：数据表驱动 + 生成器 + Tripo 热替换接缝
//
// 关键架构（换皮管线的地基）：
//   collider —— 判定用几何体参数，抓取/滑落逻辑只读这里，永不变
//   visual   —— 外观。几何体永远先生成（页面秒开）；
//               assets.manifest.js 里有 GLB 条目的物品，
//               加载完成后【原位热替换】，判定代码零改动。
//
// 设计语言验证：食物与垃圾共用轮廓库（箱形/圆柱/球袋状），
// 灰盒阶段只靠颜色区分 —— 用来最早验证"轮廓相近"是否成立。
// ============================================================
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { GLB_MANIFEST } from './assets.manifest.js';
import { markItemVisualScale } from './poolDevPersist.js';

// shape: 'box' [w,h,d] | 'cylinder' [r,h] | 'sphere' [r, y压扁系数]
// gripFactor: 0~1，越小越滑/越重（ junk 普遍偏低 ）
export const PRIZE_TABLE = [
  // —— 任务三件套（食物）——
  { id: 'bread',   name: '面包',     category: 'food', quest: true,  gripFactor: 0.95, bounceMaterial: 'soft',
    collider: { shape: 'box',      size: [0.18, 0.10, 0.11] }, visual: { type: 'primitive', color: 0xc8a06a } },
  { id: 'can',     name: '罐头',     category: 'food', quest: true,  gripFactor: 0.85, bounceMaterial: 'metal',
    collider: { shape: 'cylinder', size: [0.052, 0.13] },      visual: { type: 'primitive', color: 0xb9bec6 } },
  { id: 'veg',     name: '蔬菜',     category: 'food', quest: true,  gripFactor: 0.90, bounceMaterial: 'soft',
    collider: { shape: 'sphere',   size: [0.075, 0.65] },      visual: { type: 'primitive', color: 0x7f9c5a } },

  // —— 与任务物"轮廓相同"的垃圾（核心设计语言）——
  { id: 'moldy',   name: '发霉面包', category: 'junk', gripFactor: 0.90, bounceMaterial: 'soft',
    collider: { shape: 'box',      size: [0.18, 0.10, 0.11] }, visual: { type: 'primitive', color: 0x77815f } },
  { id: 'rustcan', name: '锈罐头盒', category: 'junk', gripFactor: 0.80, bounceMaterial: 'metal',
    collider: { shape: 'cylinder', size: [0.052, 0.13] },      visual: { type: 'primitive', color: 0x8a5f45 } },
  { id: 'rot',     name: '腐败团',   category: 'junk', gripFactor: 0.85, bounceMaterial: 'soft',
    collider: { shape: 'sphere',   size: [0.075, 0.65] },      visual: { type: 'primitive', color: 0x5c6b4a } },

  // —— 填充物：食物 ——
  { id: 'carton',  name: '纸盒',     category: 'food', gripFactor: 0.95, bounceMaterial: 'rubber',
    collider: { shape: 'box',      size: [0.12, 0.15, 0.09] }, visual: { type: 'primitive', color: 0xd6cfc0 } },
  { id: 'cheese',  name: '干酪块',   category: 'food', gripFactor: 0.90, bounceMaterial: 'soft',
    collider: { shape: 'box',      size: [0.11, 0.08, 0.09] }, visual: { type: 'primitive', color: 0xd9b64f } },
  { id: 'bottle',  name: '瓶子',     category: 'food', gripFactor: 0.70, bounceMaterial: 'glass',
    collider: { shape: 'cylinder', size: [0.045, 0.17] },      visual: { type: 'primitive', color: 0x7c93a6 } },
  { id: 'apple',   name: '果子',     category: 'food', gripFactor: 0.75, bounceMaterial: 'soft',
    collider: { shape: 'sphere',   size: [0.06, 0.95] },       visual: { type: 'primitive', color: 0xa8574a } },
  { id: 'jar',     name: '玻璃罐',   category: 'food', gripFactor: 0.65, bounceMaterial: 'glass',
    collider: { shape: 'cylinder', size: [0.06, 0.14] },       visual: { type: 'primitive', color: 0x9fb4ac } },

  // —— 填充物：垃圾（更滑 / 更重 → 天然难度）——
  { id: 'brick',   name: '碎砖',     category: 'junk', gripFactor: 0.35, bounceMaterial: 'ceramic',
    collider: { shape: 'box',      size: [0.16, 0.09, 0.10] }, visual: { type: 'primitive', color: 0x6e5a50 } },
  { id: 'bone',    name: '骨头',     category: 'junk', gripFactor: 0.55, bounceMaterial: 'stone',
    collider: { shape: 'cylinder', size: [0.03, 0.19] },       visual: { type: 'primitive', color: 0xcfc8b8 } },
  { id: 'cloth',   name: '破布团',   category: 'junk', gripFactor: 0.80, bounceMaterial: 'cloth',
    collider: { shape: 'sphere',   size: [0.08, 0.55] },       visual: { type: 'primitive', color: 0x5a5f6b } },
  { id: 'stone',   name: '石块',     category: 'junk', gripFactor: 0.45, bounceMaterial: 'stone',
    collider: { shape: 'sphere',   size: [0.065, 0.85] },      visual: { type: 'primitive', color: 0x71706a } },
  { id: 'foil',    name: '锡箔团',   category: 'junk', gripFactor: 0.60, bounceMaterial: 'metal',
    collider: { shape: 'box',      size: [0.10, 0.06, 0.10] }, visual: { type: 'primitive', color: 0xa9adb2 } },
];

export function poolVisualScale() {
  return CONFIG.pool.visualScale ?? 1;
}

function slotScale() {
  return poolVisualScale();
}

/** 水平占地半径（米），用于贴池壁 clamp */
export function itemFootprintRadius(def) {
  const s = poolVisualScale();
  const { shape, size } = def.collider;
  if (shape === 'box') return Math.max(size[0], size[2]) * 0.5 * s;
  if (shape === 'cylinder') return size[0] * s;
  return size[0] * s;
}

export function clampItemToPoolBounds(item) {
  if (!item?.mesh || item.state === 'collected' || item.state === 'gripped') return;
  const [bx0, bx1] = CONFIG.pool.boundsX;
  const [bz0, bz1] = CONFIG.pool.boundsZ;
  const r = itemFootprintRadius(item) + (CONFIG.pool.boundsWallMargin ?? 0.06);
  item.mesh.position.x = THREE.MathUtils.clamp(item.mesh.position.x, bx0 + r, bx1 - r);
  item.mesh.position.z = THREE.MathUtils.clamp(item.mesh.position.z, bz0 + r, bz1 - r);
}

function buildPrimitive(def) {
  const s = slotScale();
  const { shape, size } = def.collider;
  const sz = size.map(v => v * s);
  let geo, restY;
  if (shape === 'box') {
    geo = new THREE.BoxGeometry(...sz);
    restY = sz[1] / 2;
  } else if (shape === 'cylinder') {
    geo = new THREE.CylinderGeometry(sz[0], sz[0], sz[1], 18);
    restY = sz[1] / 2;
  } else { // sphere（y 压扁 → 袋状）
    geo = new THREE.SphereGeometry(sz[0], 20, 14);
    geo.scale(1, size[1], 1);
    restY = sz[0] * size[1];
  }
  const mat = new THREE.MeshStandardMaterial({
    color: def.visual.color,
    roughness: 0.75,
    metalness: def.category === 'junk' ? 0.3 : 0.05,
  });
  return { mesh: new THREE.Mesh(geo, mat), restY };
}

// 撒布：拒绝采样保证最小间距，避开洞口
export function spawnPool(scene) {
  const items = [];
  const [bx0, bx1] = CONFIG.pool.boundsX;
  const [bz0, bz1] = CONFIG.pool.boundsZ;
  const [hx, hz] = CONFIG.claw.holePos;
  const placed = [];

  for (const def of PRIZE_TABLE) {
    let x = 0, z = 0, ok = false, tries = 0;
    while (!ok && tries++ < 300) {
      x = THREE.MathUtils.randFloat(bx0 + 0.12, bx1 - 0.12);
      z = THREE.MathUtils.randFloat(bz0 + 0.12, bz1 - 0.12);
      ok = Math.hypot(x - hx, z - hz) > 0.55 &&
           placed.every(p => Math.hypot(x - p[0], z - p[1]) > 0.30);
    }
    placed.push([x, z]);

    const { mesh, restY } = buildPrimitive(def);
    mesh.position.set(x, restY, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);

    const item = {
      ...def, mesh, restY,
      state: 'idle',   // idle | gripped | falling | delivering | collected
      vy: 0,
    };
    markItemVisualScale(item);
    clampItemToPoolBounds(item);
    items.push(item);
  }
  return items;
}

// 合爪判定：水平距离最近的 idle 物品
export function nearestItem(items, x, z, radius) {
  let best = null, bestD = radius;
  for (const it of items) {
    if (it.state !== 'idle') continue;
    const d = Math.hypot(it.mesh.position.x - x, it.mesh.position.z - z);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

// ============================================================
// Tripo 接缝：GLB 热替换（无卡顿版）
// 流程：全部并行下载解析 → 隐身挂进场景 → compileAsync 异步编译着色器
//       （不阻塞主线程，卡顿的真凶是 16 个 PBR 材质同帧编译）
//       → 逐个"弹出"换装（把换装从瑕疵变成一个上货小动画）
// 动态 import GLTFLoader —— 没有任何 GLB 时零成本。
// ============================================================
const _swapAnims = [];
const _sleep = ms => new Promise(r => setTimeout(r, ms));
const COARSE = matchMedia('(pointer: coarse)').matches;   // 触屏设备（iPad/手机）

// 触屏设备贴图降尺寸：Tripo GLB 可能带 2K/4K 贴图，16 件解码后显存上 GB → iPad 直接崩标签页
// 阴影标志统一设置：不透明 mesh 投影+接影；透明件（玻璃罩等）只接影不投影
export function enableShadows(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const transparent = Array.isArray(o.material)
      ? o.material.some(m => m?.transparent)
      : o.material?.transparent;
    o.castShadow = !transparent;
    o.receiveShadow = true;
  });
}

export function capTextures(root, max) {  root.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        const tex = m[k], img = tex?.image;
        if (!img?.width || img.width <= max) continue;
        const c = document.createElement('canvas');
        c.width = max;
        c.height = Math.max(1, Math.round(img.height * max / img.width));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        tex.image = c;
        tex.needsUpdate = true;
      }
    }
  });
}

// 弹出动画（easeOut + 微回弹），由主循环每帧驱动
export function tickUpgrades(dt) {
  for (let i = _swapAnims.length - 1; i >= 0; i--) {
    const a = _swapAnims[i];
    a.t += dt / 0.28;
    const k = Math.min(a.t, 1);
    const e = 1 - Math.pow(1 - k, 3);
    a.obj.scale.setScalar(k >= 1 ? 1 : 0.6 + 0.4 * e + Math.sin(k * Math.PI) * 0.06);
    if (k >= 1) _swapAnims.splice(i, 1);
  }
}

export async function upgradeVisuals(parent, items, renderer, camera, onProgress) {
  const pending = items.filter(it => GLB_MANIFEST[it.id]);
  if (!pending.length) return;

  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  let done = 0;
  const track = p => p.finally(() => onProgress?.(++done, pending.length));   // 成败都计进度
  // 触屏设备限流加载：16 个 GLB 同时下载解析会内存尖峰；桌面端保持全并行
  const results = new Array(pending.length);
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await track(loader.loadAsync(GLB_MANIFEST[pending[i].id])) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  const lanes = COARSE ? Math.min(CONFIG.mobile.glbConcurrency, pending.length) : pending.length;
  await Promise.all(Array.from({ length: lanes }, worker));

  // 归一化 + 隐身挂场景（此时尚未显示，不触发逐材质编译卡顿）
  const ready = [];
  for (let i = 0; i < pending.length; i++) {
    const res = results[i], item = pending[i];
    if (res.status !== 'fulfilled') {
      console.warn(`[Tripo] ${item.id} 加载失败，保留几何体`, res.reason);
      continue;
    }
    const g = normalizeGLB(res.value.scene, item.collider, item.restY);
    if (COARSE) capTextures(g, CONFIG.mobile.maxTextureSize);
    enableShadows(g);
    g.position.copy(item.mesh.position);
    g.rotation.copy(item.mesh.rotation);
    clampItemToPoolBounds({ ...item, mesh: g });
    g.visible = false;
    parent.add(g);
    ready.push({ item, g });
  }
  if (!ready.length) return;

  // 一次性异步编译全部新材质（KHR_parallel_shader_compile 支持时不卡帧）
  try { await renderer.compileAsync(parent, camera); } catch { /* 不支持则退化为同步，与旧行为一致 */ }

  // 逐个弹出换装
  for (const { item, g } of ready) {
    if (item.state !== 'idle') { parent.remove(g); continue; }  // 已被抓走/收集
    parent.remove(item.mesh);
    g.visible = true;
    g.scale.setScalar(0.6);
    _swapAnims.push({ obj: g, t: 0 });
    item.mesh = g;   // 引用替换：爪机/判定读的都是 item.mesh，无感知
    markItemVisualScale(item);
    await _sleep(90);
  }
}

// Tripo 输出的比例/轴心不统一，载入侧归一，四步：
export function normalizeGLB(obj, collider, restY) {
  // 1. 测包围盒
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());

  // 2. 等比缩放到 collider 槽位尺寸（以最大边为基准 → 判定与视觉一致）
  const scaleMul = slotScale();
  const target =
    (collider.shape === 'box'      ? Math.max(...collider.size) :
    collider.shape === 'cylinder' ? Math.max(collider.size[0] * 2, collider.size[1]) :
                                    collider.size[0] * 2) * scaleMul;
  obj.scale.setScalar(target / Math.max(size.x, size.y, size.z, 1e-6));

  const extraX = CONFIG.pool.glbExtraRotX ?? 0;
  if (extraX) obj.rotation.x += extraX;

  // 3. pivot 归一：底面中心对齐"物品原点"，再按几何体约定下沉 restY
  //    （约定：item.mesh.position.y === restY 时底面贴地，与抓取/落回逻辑一致）
  const box2 = new THREE.Box3().setFromObject(obj);
  const center = box2.getCenter(new THREE.Vector3());
  obj.position.set(-center.x, -box2.min.y - restY, -center.z);

  // 4. 包 Group 返回（不动原 mesh，保留 PBR 贴图）
  const wrapper = new THREE.Group();
  wrapper.add(obj);
  return wrapper;
}
