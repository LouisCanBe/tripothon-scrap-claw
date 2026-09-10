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

// shape: 'box' [w,h,d] | 'cylinder' [r,h] | 'sphere' [r, y压扁系数]
// gripFactor: 0~1，越小越滑/越重（ junk 普遍偏低 ）
export const PRIZE_TABLE = [
  // —— 任务三件套（食物）——
  { id: 'bread',   name: '面包',     category: 'food', quest: true,  gripFactor: 0.95,
    collider: { shape: 'box',      size: [0.18, 0.10, 0.11] }, visual: { type: 'primitive', color: 0xc8a06a } },
  { id: 'can',     name: '罐头',     category: 'food', quest: true,  gripFactor: 0.85,
    collider: { shape: 'cylinder', size: [0.052, 0.13] },      visual: { type: 'primitive', color: 0xb9bec6 } },
  { id: 'veg',     name: '蔬菜',     category: 'food', quest: true,  gripFactor: 0.90,
    collider: { shape: 'sphere',   size: [0.075, 0.65] },      visual: { type: 'primitive', color: 0x7f9c5a } },

  // —— 与任务物"轮廓相同"的垃圾（核心设计语言）——
  { id: 'moldy',   name: '发霉面包', category: 'junk', gripFactor: 0.90,
    collider: { shape: 'box',      size: [0.18, 0.10, 0.11] }, visual: { type: 'primitive', color: 0x77815f } },
  { id: 'rustcan', name: '锈罐头盒', category: 'junk', gripFactor: 0.80,
    collider: { shape: 'cylinder', size: [0.052, 0.13] },      visual: { type: 'primitive', color: 0x8a5f45 } },
  { id: 'rot',     name: '腐败团',   category: 'junk', gripFactor: 0.85,
    collider: { shape: 'sphere',   size: [0.075, 0.65] },      visual: { type: 'primitive', color: 0x5c6b4a } },

  // —— 填充物：食物 ——
  { id: 'carton',  name: '纸盒',     category: 'food', gripFactor: 0.95,
    collider: { shape: 'box',      size: [0.12, 0.15, 0.09] }, visual: { type: 'primitive', color: 0xd6cfc0 } },
  { id: 'cheese',  name: '干酪块',   category: 'food', gripFactor: 0.90,
    collider: { shape: 'box',      size: [0.11, 0.08, 0.09] }, visual: { type: 'primitive', color: 0xd9b64f } },
  { id: 'bottle',  name: '瓶子',     category: 'food', gripFactor: 0.70,
    collider: { shape: 'cylinder', size: [0.045, 0.17] },      visual: { type: 'primitive', color: 0x7c93a6 } },
  { id: 'apple',   name: '果子',     category: 'food', gripFactor: 0.75,
    collider: { shape: 'sphere',   size: [0.06, 0.95] },       visual: { type: 'primitive', color: 0xa8574a } },
  { id: 'jar',     name: '玻璃罐',   category: 'food', gripFactor: 0.65,
    collider: { shape: 'cylinder', size: [0.06, 0.14] },       visual: { type: 'primitive', color: 0x9fb4ac } },

  // —— 填充物：垃圾（更滑 / 更重 → 天然难度）——
  { id: 'brick',   name: '碎砖',     category: 'junk', gripFactor: 0.35,
    collider: { shape: 'box',      size: [0.16, 0.09, 0.10] }, visual: { type: 'primitive', color: 0x6e5a50 } },
  { id: 'bone',    name: '骨头',     category: 'junk', gripFactor: 0.55,
    collider: { shape: 'cylinder', size: [0.03, 0.19] },       visual: { type: 'primitive', color: 0xcfc8b8 } },
  { id: 'cloth',   name: '破布团',   category: 'junk', gripFactor: 0.80,
    collider: { shape: 'sphere',   size: [0.08, 0.55] },       visual: { type: 'primitive', color: 0x5a5f6b } },
  { id: 'stone',   name: '石块',     category: 'junk', gripFactor: 0.45,
    collider: { shape: 'sphere',   size: [0.065, 0.85] },      visual: { type: 'primitive', color: 0x71706a } },
  { id: 'foil',    name: '锡箔团',   category: 'junk', gripFactor: 0.60,
    collider: { shape: 'box',      size: [0.10, 0.06, 0.10] }, visual: { type: 'primitive', color: 0xa9adb2 } },
];

function buildPrimitive(def) {
  const { shape, size } = def.collider;
  let geo, restY;
  if (shape === 'box') {
    geo = new THREE.BoxGeometry(...size);
    restY = size[1] / 2;
  } else if (shape === 'cylinder') {
    geo = new THREE.CylinderGeometry(size[0], size[0], size[1], 18);
    restY = size[1] / 2;
  } else { // sphere（y 压扁 → 袋状）
    geo = new THREE.SphereGeometry(size[0], 20, 14);
    geo.scale(1, size[1], 1);
    restY = size[0] * size[1];
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

    items.push({
      ...def, mesh, restY,
      state: 'idle',   // idle | gripped | falling | delivering | collected
      vy: 0,
    });
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
// Tripo 接缝：GLB 热替换
// 页面先用几何体秒开；manifest 有条目的物品加载完成后原位替换。
// 动态 import GLTFLoader —— 没有任何 GLB 时零成本。
// ============================================================
export function upgradeVisuals(scene, items) {
  const pending = items.filter(it => GLB_MANIFEST[it.id]);
  if (!pending.length) return;

  import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => {
    const loader = new GLTFLoader();
    for (const item of pending) {
      loader.loadAsync(GLB_MANIFEST[item.id])
        .then(gltf => {
          if (item.state !== 'idle') return; // 已被抓走/收集，不换
          const g = normalizeGLB(gltf.scene, item.collider, item.restY);
          g.position.copy(item.mesh.position);
          g.rotation.copy(item.mesh.rotation);
          scene.remove(item.mesh);
          scene.add(g);
          item.mesh = g;   // 引用替换：爪机/判定读的都是 item.mesh，无感知
        })
        .catch(err => console.warn(`[Tripo] ${item.id} 加载失败，保留几何体`, err));
    }
  });
}

// Tripo 输出的比例/轴心不统一，载入侧归一，四步：
export function normalizeGLB(obj, collider, restY) {
  // 1. 测包围盒
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());

  // 2. 等比缩放到 collider 槽位尺寸（以最大边为基准 → 判定与视觉一致）
  const target =
    collider.shape === 'box'      ? Math.max(...collider.size) :
    collider.shape === 'cylinder' ? Math.max(collider.size[0] * 2, collider.size[1]) :
                                    collider.size[0] * 2;
  obj.scale.setScalar(target / Math.max(size.x, size.y, size.z, 1e-6));

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
