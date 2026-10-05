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
import { getGlbManifest } from './glbManifest.js';
import { markItemVisualScale } from './poolDevPersist.js';
import { enqueueRendererCompile } from './renderCompile.js';

// shape: 'box' [w,h,d] | 'cylinder' [r,h] | 'sphere' [r, y压扁系数]
// gripFactor: 0~1，越小越滑/越重
//
// 【两态物资 · 剧情设计-拾荒娃娃机.md 规则 A】
// 每件东西只有一个 collider，但有 manifest（显形：他以为的）与 rot（败露：真实）两副面孔。
//   不写 variants 的物品 = 两态共用模型，只做材质覆盖（#VARIANT_MAT）。
//   写了 variants.rot.glb   = 败露态换模型（任务三件套走这条，轮廓与显形态共用）。
// 抓取判定从头到尾只读 collider，两态切换不动判定 —— 机制是诚实的，眼睛不是。
export const VARIANT_MANIFEST = 'manifest';
export const VARIANT_ROT = 'rot';

/** 败露态的通用材质覆盖：压暗、去饱和、加粗糙（同 mesh 不做新模型时的做法）。
 *  一点自发光是为了"灯灭了还看得见" —— 不是发光，是残光，别调亮。 */
const VARIANT_MAT = {
  roughness: 0.96,
  metalness: 0.02,
  tint: 0x7c6a52,        // 脏黄褐，乘在贴图上 → 整体压暗发霉
  emissive: 0x2a241c,    // 残光：让"灯灭了还看得见轮廓"成立，别再往上加
};

export const PRIZE_TABLE = [
  // ==== 任务三件套：显形态（他以为的） ====
  // 显形态与败露态是**两个独立 id**，会同时出现在池子里。
  // 这不矛盾：池子就是同一批东西的两副面孔混在一起，他分不出哪个是哪个。
  // 显形态不写 truthName —— 副屏只显示"他以为的"，真相是留给后续揭晓交互的。
  { id: 'bread',   name: '面包',     category: 'food', quest: true,  gripFactor: 0.95, bounceMaterial: 'soft',
    collider: { shape: 'box',      size: [0.18, 0.10, 0.11] }, visual: { type: 'primitive', color: 0xc8a06a } },
  { id: 'can',     name: '罐头',     category: 'food', quest: true,  gripFactor: 0.85, bounceMaterial: 'metal',
    collider: { shape: 'cylinder', size: [0.052, 0.13] },      visual: { type: 'primitive', color: 0xb9bec6 } },
  { id: 'veg',     name: '青菜',     category: 'food', quest: true,  gripFactor: 0.90, bounceMaterial: 'soft',
    collider: { shape: 'sphere',   size: [0.075, 0.65] },      visual: { type: 'primitive', color: 0x7f9c5a } },

  // ==== 任务三件套：败露态（真实的）。collider 与显形态逐一相同 = 轮廓共用 ====
  // glb = 显形态那一件的模型别名（两态共用同一套轮廓）；to = 这一态实际要装的 GLB。
  // truthName 是"观众知道、他还在骗自己"的那个名字，不进副屏默认文案，留给后续揭晓按钮。
  { id: 'bread-rot', name: '面包',   truthName: '发霉面包', category: 'food', quest: true, gripFactor: 0.90, bounceMaterial: 'soft',
    collider: { shape: 'box',      size: [0.18, 0.10, 0.11] }, visual: { type: 'primitive', color: 0x77815f },
    variants: { manifest: { glb: 'bread', to: 'bread' }, rot: { glb: 'bread', to: 'moldy', mat: { tint: 0x76805c, roughness: 0.97 } } } },
  { id: 'can-rot', name: '罐头',     truthName: '锈罐头', category: 'food', quest: true, gripFactor: 0.80, bounceMaterial: 'metal',
    collider: { shape: 'cylinder', size: [0.052, 0.13] },      visual: { type: 'primitive', color: 0x8a5f45 },
    variants: { manifest: { glb: 'can', to: 'can' }, rot: { glb: 'can', to: 'rustcan', mat: { tint: 0x8a5f45, roughness: 0.88 } } } },
  { id: 'veg-rot', name: '青菜',     truthName: '烂菜', category: 'food', quest: true, gripFactor: 0.85, bounceMaterial: 'soft',
    collider: { shape: 'sphere',   size: [0.075, 0.65] },      visual: { type: 'primitive', color: 0x5c6b4a },
    variants: { manifest: { glb: 'veg', to: 'veg' }, rot: { glb: 'veg', to: 'rot', mat: { tint: 0x5c6b4a, roughness: 0.98 } } } },

  // ==== 干扰物资（不记配额）。显形态与败露态共用一套 GLB，败露态只做材质覆盖（省资产）====
  { id: 'carton',  name: '牛奶盒',   category: 'food', gripFactor: 0.95, bounceMaterial: 'rubber',
    collider: { shape: 'box',      size: [0.12, 0.15, 0.09] }, visual: { type: 'primitive', color: 0xd6cfc0 },
    variants: { rot: { mat: { tint: 0x8c8578, roughness: 0.95 } } } },
  { id: 'cheese',  name: '干酪块',   category: 'food', gripFactor: 0.90, bounceMaterial: 'soft',
    collider: { shape: 'box',      size: [0.11, 0.08, 0.09] }, visual: { type: 'primitive', color: 0xd9b64f },
    variants: { rot: { mat: { tint: 0x8a8558, roughness: 0.97 } } } },
  { id: 'jar',     name: '玻璃罐',   category: 'food', gripFactor: 0.65, bounceMaterial: 'glass',
    collider: { shape: 'cylinder', size: [0.06, 0.14] },       visual: { type: 'primitive', color: 0x9fb4ac },
    variants: { rot: { mat: { tint: 0x6f7a76, roughness: 0.5 } } } },

  // ==== 保留条目：旧存档/旧事件里可能出现 'apple'，不 spawn 但仍能解析名字 ====
  { id: 'apple',   name: '果子',     category: 'food', gripFactor: 0.75, bounceMaterial: 'soft', disabled: true,
    collider: { shape: 'sphere',   size: [0.06, 0.95] },       visual: { type: 'primitive', color: 0xa8574a },
    variants: { rot: { mat: { tint: 0x7d5a48, roughness: 0.97 } } } },
];

/** 按 id 找物资表条目 */
export function prizeDefById(id) {
  return PRIZE_TABLE.find(d => d.id === id) ?? null;
}

/**
 * 该物品在指定态下的 GLB 别名。
 *   variants[x].glb = 显形态那一件的模型别名（写它才能两态共用轮廓）；
 *   没写就用自己的 id（干扰物资那种"同一套 GLB 只换材质"的情况）。
 */
export function variantGlbKey(def, appearance = VARIANT_MANIFEST) {
  if (!def) return null;
  const v = appearance === VARIANT_ROT ? def.variants?.rot : def.variants?.manifest;
  return v?.glb ?? def.id;
}

/** 该物品在指定态下实际要装的 GLB（多数时候等于 glb 别名，败露态换模型时由 to 覆盖） */
export function variantVisualKey(def, appearance = VARIANT_MANIFEST) {
  const key = variantGlbKey(def, appearance);
  if (!def || !key) return key;
  const v = appearance === VARIANT_ROT ? def.variants?.rot : def.variants?.manifest;
  return v?.to ?? key;
}

/** 该物品在指定态下的材质覆盖（无则回退通用败露材质） */
export function variantMatPreset(def, appearance = VARIANT_MANIFEST) {
  if (appearance !== VARIANT_ROT) return null;
  return { ...VARIANT_MAT, ...(def?.variants?.rot?.mat ?? {}) };
}

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

function buildPrimitive(def, appearance = VARIANT_MANIFEST) {
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
  // 显形态用表里的干净色；败露态（无 GLB 时的几何体兜底）直接压成脏色
  const preset = variantMatPreset(def, appearance);
  const base = new THREE.Color(def.visual.color);
  const color = preset ? base.clone().lerp(new THREE.Color(preset.tint), 0.75).getHex() : def.visual.color;
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: preset?.roughness ?? 0.75,
    metalness: preset?.metalness ?? 0.05,
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
    if (def.disabled) continue;
    let x = 0, z = 0, ok = false, tries = 0;
    while (!ok && tries++ < 300) {
      x = THREE.MathUtils.randFloat(bx0 + 0.12, bx1 - 0.12);
      z = THREE.MathUtils.randFloat(bz0 + 0.12, bz1 - 0.12);
      ok = Math.hypot(x - hx, z - hz) > 0.55 &&
           placed.every(p => Math.hypot(x - p[0], z - p[1]) > 0.30);
    }
    placed.push([x, z]);

    const { mesh, restY } = buildPrimitive(def, VARIANT_MANIFEST);
    mesh.position.set(x, restY, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    scene.add(mesh);

    const item = {
      ...def, mesh, restY,
      appearance: null,   // 两态当前值；null = 还没装 GLB（由 upgradeVisuals 定显形态）
      spawn: { x, z, rotY: mesh.rotation.y },
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
    if (!o.isMesh || o.userData?.comicOutline) return;
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
// rest：终态缩放。**一律是 1** —— collider（判定/贴墙/装饰堆叠）读的是原始尺寸，
//       视觉长期缩水会变成"判得比看得大"。败露态只是把 dur 拉长，弹得更慢更沉。
export function tickUpgrades(dt) {
  for (let i = _swapAnims.length - 1; i >= 0; i--) {
    const a = _swapAnims[i];
    a.t += dt / (a.dur ?? 0.28);
    const k = Math.min(a.t, 1);
    const e = 1 - Math.pow(1 - k, 3);
    const rest = a.rest ?? 1;
    a.obj.scale.setScalar(k >= 1 ? rest : (rest * 0.6 + rest * 0.4 * e) + Math.sin(k * Math.PI) * 0.06 * rest);
    if (k >= 1) _swapAnims.splice(i, 1);
  }
}

// GLTFLoader 实例复用：同一次换态里多个物品要同一个 URL 时，three 的 FileLoader
// 会把并发的同 URL 请求合并成一次（r170 默认 THREE.Cache.enabled=false，所以**不缓存解析结果**，
// 只顺带暖了浏览器 HTTP 缓存）。收益不大但也不亏，主要是别每件都 new 一个 loader。
let _loader = null;
async function prizeLoader() {
  if (!_loader) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    _loader = new GLTFLoader();
  }
  return _loader;
}

/**
 * 幕级换态：整池物资在 manifest（他以为的）与 rot（真实的）之间切换。
 * 调用点在全黑期间（见 main.js 的 onPoolAppearance），玩家看不到换的过程。
 * 已被抓走/已出货的物品不动 —— 记忆里的东西不会被改。
 * 整批同时换（Promise.all），不逐件串行 —— 重开时也不是一只只变回去。
 */
export async function setPoolAppearance(items, appearance, { renderer, camera, parent, animate = true } = {}) {
  const want = appearance === VARIANT_ROT ? VARIANT_ROT : VARIANT_MANIFEST;
  const targets = (items ?? []).filter(
    it => it?.mesh
      && it.appearance !== want
      && !['gripped', 'delivering', 'falling', 'collected'].includes(it.state),
  );
  await Promise.all(targets.map(
    it => swapItemAppearance(it, want, { renderer, camera, parent, animate }).catch(() => null),
  ));
  if (targets.length) _onAppearanceChanged?.(items, want);
  return targets.length;
}

/** 单件换态：换模型（若有）或换材质，失败时退回几何体兜底 */
export async function swapItemAppearance(item, appearance, { renderer, camera, parent, animate = true } = {}) {
  const want = appearance === VARIANT_ROT ? VARIANT_ROT : VARIANT_MANIFEST;
  const visualKey = variantVisualKey(item, want);
  const url = visualKey ? getGlbManifest()[visualKey] ?? null : null;
  const matPreset = variantMatPreset(item, want);
  const root = parent ?? item.mesh?.parent;
  if (!root) return null;

  let next = null;
  if (url) {
    try {
      const loader = await prizeLoader();
      const gltf = await loader.loadAsync(url);
      const g = normalizeGLB(gltf.scene, item.collider, item.restY);
      if (COARSE) capTextures(g, CONFIG.mobile.maxTextureSize);
      if (matPreset) applyMaterialPreset(g, matPreset);
      enableShadows(g);
      next = g;
    } catch (e) {
      console.warn(`[两态] ${item.id} 的 ${want} 模型 ${url} 加载失败，退回材质覆盖`, e);
    }
  }
  if (!next) {
    // 无独立模型：复制当前视觉，套败露材质
    next = item.mesh.clone(true);
    applyMaterialPreset(next, matPreset ?? VARIANT_MAT);
  }

  next.position.copy(item.mesh.position);
  next.rotation.copy(item.mesh.rotation);
  if (item.mesh.visible === false) next.visible = true;
  root.remove(item.mesh);
  root.add(next);
  enableShadows(next);
  item.mesh = next;
  item.appearance = want;
  item.visualUrl = url ?? null;
  markItemVisualScale(item);
  clampItemToPoolBounds(item);
  // 终态缩放一律回到 1：collider（判定/贴墙/装饰堆叠）读的是原始尺寸，
  // 视觉长期缩水会变成"判得比看得大"。败露态只是在弹出动画上更慢更沉一点。
  if (animate && renderer && camera) {
    next.scale.setScalar(0.6);
    _swapAnims.push({ obj: next, t: 0, rest: 1, dur: want === VARIANT_ROT ? 0.5 : 0.28 });
  } else {
    next.scale.setScalar(1);
  }
  return next;
}

/**
 * 预算败露态模型：让它们在换货前就进浏览器 HTTP 缓存、并把并发请求合并掉，
 * 这样终幕在全黑里换货时基本只剩解析时间，黑屏不会被网络拖长。
 * （three r170 默认不缓存解析结果，所以这不是"零成本"；如果黑屏还是偏长，
 *   可以在 main.js 里开 THREE.Cache.enabled = true 再试。）
 * 第四幕（他最暖的一幕）空闲时调用。
 */
export async function preloadVariantVisuals(items, appearance = VARIANT_ROT) {
  const manifest = getGlbManifest();
  const urls = [...new Set((items ?? [])
    .map(it => manifest[variantVisualKey(it, appearance)])
    .filter(Boolean))];
  if (!urls.length) return 0;
  const loader = await prizeLoader();
  let ok = 0;
  await Promise.all(urls.map(u => loader.loadAsync(u).then(() => { ok += 1; }).catch(() => {})));
  return ok;
}

/** 给一个视觉根节点套上败露材质（保留法线/粗糙贴图，只改颜色与粗糙金属度） */
function applyMaterialPreset(root, preset) {  root.traverse((o) => {
    if (!o.isMesh || o.userData?.comicOutline) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (!m) return m;
      const n = m.clone();
      if (n.color && preset.tint != null) n.color = new THREE.Color(preset.tint);
      if (preset.roughness != null && 'roughness' in n) n.roughness = preset.roughness;
      if (preset.metalness != null && 'metalness' in n) n.metalness = preset.metalness;
      if (preset.emissive != null && n.emissive) n.emissive = new THREE.Color(preset.emissive);
      n.needsUpdate = true;
      return n;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

// 换态完成后的外挂（main.js 注入 → 重刷漫画描边等），避免 prizePool ↔ prizeComicFx 互相 import
let _onAppearanceChanged = null;
export function setAppearanceChangeHook(fn) { _onAppearanceChanged = fn; }

export async function upgradeVisuals(parent, items, renderer, camera, onProgress) {
  const manifest = getGlbManifest();
  // 两态：只给"还没有视觉归属"（appearance 为 null）的物品装上显形态 GLB。
  // 已经定过态的物品由 setPoolAppearance 负责，避免开场把 rot 模型当显形态装上。
  const pending = items.filter(it => it.appearance == null && manifest[variantVisualKey(it, VARIANT_MANIFEST)]);
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
        const key = variantVisualKey(pending[i], VARIANT_MANIFEST);
        results[i] = { status: 'fulfilled', value: await track(loader.loadAsync(manifest[key])) };
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

  // 只编译本批奖品（勿 compile 整个 world；且与外壳/爪 compile 串行排队）
  const batch = new THREE.Group();
  for (const { g } of ready) {
    parent.remove(g);
    batch.add(g);
  }
  await enqueueRendererCompile(renderer, camera, batch);
  for (const { g } of ready) {
    batch.remove(g);
    parent.add(g);
  }

  // 逐个弹出换装
  for (const { item, g } of ready) {
    if (item.state !== 'idle') { parent.remove(g); continue; }  // 已被抓走/收集
    parent.remove(item.mesh);
    g.visible = true;
    g.scale.setScalar(0.6);
    _swapAnims.push({ obj: g, t: 0 });
    item.mesh = g;   // 引用替换：爪机/判定读的都是 item.mesh，无感知
    item.appearance = VARIANT_MANIFEST;
    item.visualUrl = manifest[variantVisualKey(item, VARIANT_MANIFEST)] ?? null;
    markItemVisualScale(item);
    await _sleep(90);
  }
  _onAppearanceChanged?.(items, VARIANT_MANIFEST);
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

/** 通关重开：已入洞物品回到初始位 */
/** GLB/几何体底面与池底 (y=0) 偏差时校正（仅 idle 开局）
 *  注意要按**原尺寸**测：开盘弹出动画还没跑完时 mesh.scale 可能只有 0.6~0.9，
 *  直接量会把 restY 记小，落回时沉进地板里（而且这个错会跟一局）。 */
export function groundIdlePrizesToFloor(items, floorY = 0) {
  for (const it of items ?? []) {
    if (!it?.mesh || it.state !== 'idle') continue;
    const s = it.mesh.scale.clone();
    it.mesh.scale.set(1, 1, 1);
    it.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(it.mesh);
    const dy = floorY - box.min.y;
    it.mesh.scale.copy(s);
    it.mesh.updateMatrixWorld(true);
    if (Math.abs(dy) < 0.0004) continue;
    it.mesh.position.y += dy;
    it.restY = it.mesh.position.y;
  }
}

export function resetAllPoolItems(items) {
  for (const it of items) {
    if (!it.mesh || !it.spawn) continue;
    it.state = 'idle';
    it.vy = 0;
    it.mesh.visible = true;
    it.mesh.position.set(it.spawn.x, it.restY, it.spawn.z);
    it.mesh.rotation.set(0, it.spawn.rotY, 0);
    clampItemToPoolBounds(it);
  }
}
