// 奖池「堆娃娃」装饰：仅视觉，不进 items / 不参与 nearestItem 判定
// 灰盒四类 ball/roll/disk/ribbon → Tripo 同形好/坏（见 tools/prompts-decor-low.json）
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { GLB_MANIFEST_DECOR } from './assets.manifest-decor.js';
import { capTextures, enableShadows } from './prizePool.js';
import {
  buildPrizeSupporters,
  computeSupportFootY,
  getDecorPoolBounds,
  restackPoolDecor,
  snapPoolDecorToFloor,
} from './poolDecorStack.js';
import {
  invalidateDecorRadii,
  settlePoolDecorGroup,
} from './prizePoolDecorPhysics.js';

const DECOR_KINDS = ['ball', 'roll', 'disk', 'ribbon'];

/** 灰盒 kind → 默认可选 GLB（manifest 里同前缀的 id 也会自动并入） */
const KIND_GLB = {
  ball: ['ball_good', 'ball_junk', 'ball_yarn', 'ball_pingpong', 'ball_lint'],
  roll: ['roll_good', 'roll_junk', 'roll_foam', 'roll_tapecore', 'roll_bubble'],
  disk: ['disk_good', 'disk_junk', 'disk_washer', 'disk_token', 'disk_cork'],
  ribbon: ['ribbon_good', 'ribbon_junk', 'ribbon_lace', 'ribbon_string', 'ribbon_tape'],
};

function decorKindFromId(id) {
  return id.split('_')[0];
}

function glbPoolForKind(kind) {
  const manifest = GLB_MANIFEST_DECOR ?? {};
  const listed = KIND_GLB[kind] ?? [];
  const discovered = Object.keys(manifest).filter((id) => decorKindFromId(id) === kind);
  return [...new Set([...listed, ...discovered])];
}

const PLUSH_COLORS = [
  0x8a8478, 0x7a756c, 0x6e7568, 0x8f857a, 0x736a62, 0x7d8488,
  0x8c7d74, 0x6b6560, 0x85707a, 0x788272, 0x948a80, 0x6a635c,
];

function pickColor(i) {
  return PLUSH_COLORS[i % PLUSH_COLORS.length];
}

/** 毛绒 / Tripo 白膜随机染色（略偏灰彩，避免纯白） */
export function pickRandomDecorColor() {
  if (Math.random() < 0.82) {
    return PLUSH_COLORS[Math.floor(Math.random() * PLUSH_COLORS.length)];
  }
  return new THREE.Color().setHSL(Math.random(), 0.28 + Math.random() * 0.32, 0.4 + Math.random() * 0.18).getHex();
}

function applyDecorTint(root, hex, junk = false) {
  const cfg = CONFIG.pool?.decor ?? {};
  const keepMaps = cfg.decorKeepTripoMaps !== false;
  const strength = cfg.decorTintStrength ?? 0.36;
  const tint = new THREE.Color(hex);
  const mul = new THREE.Color(0xffffff).lerp(tint, strength);
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const src = Array.isArray(o.material) ? o.material : [o.material];
    const next = src.map((m) => {
      const cm = m.clone();
      const hasMap = keepMaps && !!cm.map;
      if (!hasMap) {
        cm.map = null;
        cm.emissiveMap = null;
        cm.normalMap = null;
        cm.aoMap = null;
        cm.color.copy(tint);
      } else {
        cm.emissiveMap = null;
        cm.color.copy(mul);
      }
      cm.roughness = THREE.MathUtils.clamp(cm.roughness ?? 0.86, 0.68, 0.94);
      cm.metalness = junk ? 0.12 : (hasMap ? 0.04 : 0.05);
      return cm;
    });
    o.material = next.length === 1 ? next[0] : next;
  });
}

function sizeMul(cfg) {
  return cfg.sizeMul ?? 1.45;
}

function sampleDecorXZ(bx0, bx1, bz0, bz1, cfg) {
  const margin = cfg.edgeMargin ?? 0.045;
  const cx = (bx0 + bx1) * 0.5;
  const cz = (bz0 + bz1) * 0.5;
  const hw = (bx1 - bx0) * 0.5 - margin;
  const hh = (bz1 - bz0) * 0.5 - margin;
  const inner = cfg.edgeInner ?? 0.32;
  const bandLo = cfg.edgeBand ?? 0.74;
  const edgeChance = cfg.edgeScatterChance ?? 0.45;
  const a = Math.random() * Math.PI * 2;
  const t = Math.random() < edgeChance
    ? bandLo + (1 - bandLo) * Math.random()
    : inner + (1 - inner) * Math.random();
  return { x: cx + Math.cos(a) * hw * t, z: cz + Math.sin(a) * hh * t };
}

function sampleDecorXZEdge(bx0, bx1, bz0, bz1, cfg) {
  const margin = cfg.edgeMargin ?? 0.032;
  const cx = (bx0 + bx1) * 0.5;
  const cz = (bz0 + bz1) * 0.5;
  const hw = (bx1 - bx0) * 0.5 - margin;
  const hh = (bz1 - bz0) * 0.5 - margin;
  const bandLo = cfg.edgeBand ?? 0.74;
  const a = Math.random() * Math.PI * 2;
  const t = bandLo + (1 - bandLo) * Math.random();
  return { x: cx + Math.cos(a) * hw * t, z: cz + Math.sin(a) * hh * t };
}

const DECOR_KIND_CYCLE = ['ball', 'roll', 'disk', 'ribbon'];

function shuffleKinds() {
  const a = [...DECOR_KIND_CYCLE];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createKindPicker() {
  let deck = shuffleKinds();
  let i = 0;
  return () => {
    if (i >= deck.length) {
      deck = shuffleKinds();
      i = 0;
    }
    return deck[i++];
  };
}

function makePlushMesh(kind, color, scale, cfg) {
  const sm = sizeMul(cfg);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.88,
    metalness: 0.01,
  });
  let mesh;
  if (kind === 'ball') {
    const r = 0.058 * scale * sm;
    mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
    mesh.scale.y = 0.78 + Math.random() * 0.22;
  } else if (kind === 'roll') {
    const r = 0.042 * scale * sm;
    const h = 0.14 * scale * sm;
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 12), mat);
    mesh.rotation.z = (Math.random() - 0.5) * 1.1;
    mesh.rotation.x = (Math.random() - 0.5) * 0.9;
  } else if (kind === 'disk') {
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065 * scale * sm, 0.072 * scale * sm, 0.034 * scale * sm, 14),
      mat,
    );
    mesh.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.5;
  } else {
    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.09 * scale * sm, 0.032 * scale * sm, 0.065 * scale * sm),
      mat,
    );
    mesh.rotation.y = Math.random() * Math.PI;
    mesh.rotation.x = (Math.random() - 0.5) * 0.4;
  }
  mesh.userData.poolDecor = true;
  mesh.userData.decorKind = kind;
  mesh.userData.decorTint = color;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = -2;
  refreshDecorFootprint(mesh);
  return mesh;
}

function refreshDecorFootprint(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  obj.userData.decorRadius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
}

function randomDecorScale(cfg) {
  const lo = cfg.scaleMin ?? 0.68;
  const hi = cfg.scaleMax ?? 1.62;
  return THREE.MathUtils.randFloat(lo, hi);
}

function decorPlacementRadius(mesh, cfg) {
  const base = mesh.userData.decorRadius ?? 0.05;
  return base * (cfg.placementRadiusMul ?? 0.86);
}

function xzClearance(x, z, r, others, placeGap) {
  return others.every((q) => {
    const d = Math.hypot(x - q.x, z - q.z);
    return d > r + q.r + placeGap;
  });
}

function recordDecorSupporter(node, x, z) {
  node.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node);
  return {
    x,
    z,
    r: node.userData.decorRadius ?? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5,
    topY: box.max.y,
  };
}

/**
 * @param {THREE.Object3D} parent
 * @param {unknown[]} [prizeItems] 已生成的可抓娃娃（先 spawnPool 再调本函数）
 */
export function spawnPoolDecor(parent, prizeItems = []) {
  const cfg = CONFIG.pool?.decor;
  if (!cfg?.enabled || !parent) return null;

  const group = new THREE.Group();
  group.name = 'poolDecor';

  const { bx0, bx1, bz0, bz1 } = getDecorPoolBounds();
  const [hx, hz] = CONFIG.claw.holePos;
  const holeR = cfg.avoidHoleRadius ?? 0.5;
  const placeGap = cfg.placementGap ?? 0.024;
  const count = cfg.count ?? 44;
  const maxStack = cfg.maxStackY ?? 0.26;
  const floorY = cfg.floorY ?? 0.018;
  const stackGap = cfg.stackGap ?? 0.004;
  const pickKind = createKindPicker();
  const prizeSupporters = buildPrizeSupporters(prizeItems);
  const placed = [];
  const maxTries = cfg.placementRetries ?? 420;
  const boundsPad = 0;
  const cx = (bx0 + bx1) * 0.5;
  const cz = (bz0 + bz1) * 0.5;
  const halfW = (bx1 - bx0) * 0.5;
  const edgeRelaxFrac = cfg.decorEdgePrizeRelaxFrac ?? 0.66;
  const prizeEdgeScale = cfg.prizeEdgeClearanceScale ?? 0.6;
  let colorIdx = 0;

  function obstaclesAt(x, z) {
    const dist = Math.hypot(x - cx, z - cz);
    const onEdge = dist > halfW * edgeRelaxFrac;
    const prizeScale = onEdge ? prizeEdgeScale : 1;
    const prizes = prizeScale === 1
      ? prizeSupporters
      : prizeSupporters.map((s) => ({ ...s, r: s.r * prizeScale }));
    return [...prizes, ...placed];
  }

  function tryPlaceOne(kind, scale, gapMul = 1, fixed = null, sampleZone = 'any') {
    const gap = placeGap * gapMul;
    const scaleSteps = fixed
      ? [scale, scale * 0.82, scale * 0.68]
      : [scale, scale * 0.9, scale * 0.78];
    for (const s of scaleSteps) {
      const mesh = makePlushMesh(kind, pickColor(colorIdx++), s, cfg);
      const r = decorPlacementRadius(mesh, cfg);
      let x = 0;
      let z = 0;
      let footY = floorY;
      const tries = fixed ? 1 : maxTries;
      let attempt = 0;
      while (attempt++ < tries) {
        if (fixed) {
          x = fixed.x;
          z = fixed.z;
        } else {
          const p = sampleZone === 'edge'
            ? sampleDecorXZEdge(bx0, bx1, bz0, bz1, cfg)
            : sampleDecorXZ(bx0, bx1, bz0, bz1, cfg);
          x = p.x;
          z = p.z;
        }
        const inBounds = x >= bx0 && x <= bx1 && z >= bz0 && z <= bz1;
        const clearHole = Math.hypot(x - hx, z - hz) > holeR;
        const obstacles = obstaclesAt(x, z);
        if (!xzClearance(x, z, r, obstacles, gap)) continue;
        footY = computeSupportFootY(x, z, r, floorY, prizeSupporters, stackGap, { prizesOnly: true });
        if (footY > floorY + maxStack + 0.002) continue;
        if (!inBounds || !clearHole) continue;
        mesh.position.set(x, 0, z);
        mesh.rotation.y = Math.random() * Math.PI * 2;
        group.add(mesh);
        alignDecorFoot(group, mesh, footY);
        placed.push({
          x,
          z,
          r,
          topY: new THREE.Box3().setFromObject(mesh).max.y,
        });
        return true;
      }
      disposeDecorMesh(mesh);
    }
    return false;
  }

  function gridTopUp(wantMin, margin, scaleLo, scaleHi) {
    const step = cfg.placementGridStep ?? 0.095;
    const cells = [];
    for (let x = bx0 + margin; x <= bx1 - margin; x += step) {
      for (let z = bz0 + margin; z <= bz1 - margin; z += step) {
        cells.push({ x, z });
      }
    }
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    for (const { x, z } of cells) {
      if (placed.length >= wantMin) return;
      if (Math.hypot(x - hx, z - hz) < holeR + 0.04) continue;
      tryPlaceOne(
        pickKind(),
        THREE.MathUtils.randFloat(scaleLo, scaleHi),
        fillGapMul,
        { x, z },
      );
    }
  }

  const edgeShare = cfg.edgePlacementShare ?? 0.62;
  const edgeMain = Math.floor(count * edgeShare);
  for (let i = 0; i < edgeMain; i++) {
    tryPlaceOne(pickKind(), randomDecorScale(cfg), 1, null, 'edge');
  }
  for (let i = edgeMain; i < count; i++) {
    tryPlaceOne(pickKind(), randomDecorScale(cfg), 1, null, 'any');
  }

  const fillTarget = cfg.fillCount ?? 0;
  const fillLo = cfg.fillScaleMin ?? 0.5;
  const fillHi = cfg.fillScaleMax ?? 0.82;
  const fillGapMul = (cfg.fillPlacementGap ?? 0.012) / (placeGap || 0.024);
  for (let f = 0; f < fillTarget; f++) {
    const zone = f % 3 !== 1 ? 'edge' : 'any';
    tryPlaceOne(pickKind(), THREE.MathUtils.randFloat(fillLo, fillHi), fillGapMul, null, zone);
  }

  const rimN = cfg.rimCount ?? 18;
  const edgeN = cfg.edgeScatterCount ?? 0;
  const wantTotal = count + fillTarget + rimN + edgeN;
  const hw = (bx1 - bx0) * 0.5;
  const hh = (bz1 - bz0) * 0.5;
  const bandLo = cfg.edgeBand ?? 0.74;
  for (let i = 0; i < rimN; i++) {
    const t = (i / rimN) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const u = bandLo + (1 - bandLo) * (0.35 + Math.random() * 0.65);
    const x = cx + Math.cos(t) * hw * u;
    const z = cz + Math.sin(t) * hh * u;
    if (Math.hypot(x - hx, z - hz) < holeR) continue;
    tryPlaceOne(pickKind(), randomDecorScale(cfg) * THREE.MathUtils.randFloat(0.92, 1.08), 1, { x, z });
  }
  for (let i = 0; i < edgeN; i++) {
    const side = i % 4;
    const along = Math.random();
    const inset = bandLo + (1 - bandLo) * Math.random();
    let x = cx;
    let z = cz;
    if (side === 0) {
      x = bx0 + (bx1 - bx0) * along;
      z = cz + hh * inset * (Math.random() < 0.5 ? 1 : -1);
    } else if (side === 1) {
      x = cx + hw * inset * (Math.random() < 0.5 ? 1 : -1);
      z = bz0 + (bz1 - bz0) * along;
    } else if (side === 2) {
      x = bx1 - (bx1 - bx0) * (1 - along);
      z = cz + hh * inset * (Math.random() < 0.5 ? 1 : -1);
    } else {
      x = cx + hw * inset * (Math.random() < 0.5 ? 1 : -1);
      z = bz1 - (bz1 - bz0) * (1 - along);
    }
    if (Math.hypot(x - hx, z - hz) < holeR + 0.03) continue;
    tryPlaceOne(pickKind(), THREE.MathUtils.randFloat(fillLo, fillHi * 1.05), fillGapMul, { x, z });
  }

  if (placed.length < wantTotal * 0.72) {
    gridTopUp(
      Math.min(wantTotal, Math.floor(wantTotal * 0.92)),
      boundsPad,
      fillLo,
      fillHi,
    );
  }
  if (placed.length < wantTotal * 0.85) {
    gridTopUp(wantTotal, 0, fillLo * 0.95, fillHi * 0.88);
  }

  parent.add(group);
  snapPoolDecorToFloor(group, alignDecorFoot);
  if (typeof console !== 'undefined' && console.log) {
    const n = group.children.filter((c) => c.userData?.poolDecor).length;
    console.log(`[decor] 摆放 ${n} 件（目标约 ${wantTotal}，贴地+避让）`);
  }
  return group;
}

function decorProtoColor(id) {
  if (id.includes('junk')) return 0x5a5248;
  if (id.startsWith('ball')) return 0x9a9488;
  if (id.startsWith('roll')) return 0x8a9080;
  if (id.startsWith('disk')) return 0xa0a4a8;
  return 0x8a8478;
}

/** GLB 未生成时的占位，形状贴近对应灰盒 */
export function makeDecorProto(id, scale = 1) {
  const mat = new THREE.MeshStandardMaterial({
    color: decorProtoColor(id),
    roughness: 0.9,
    metalness: id.includes('junk') ? 0.1 : 0.02,
  });
  let mesh;
  const junk = id.includes('junk');
  if (id.startsWith('ball')) {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.048, 10, 8),
      mat,
    );
    if (junk) mesh.scale.set(1.1, 0.55, 0.95);
  } else if (id.startsWith('roll')) {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.04, 0.11, 10), mat);
    if (junk) mesh.rotation.z = 0.45;
  } else if (id.startsWith('disk')) {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.02, 12), mat);
    mesh.rotation.x = Math.PI / 2;
    if (junk) mesh.scale.set(0.85, 1, 0.7);
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.028, 0.055), mat);
    if (junk) mesh.rotation.z = 0.25;
  }
  mesh.scale.multiplyScalar(scale);
  return finalizeDecorMesh(mesh, decorKindFromId(id));
}

function finalizeDecorMesh(mesh, kind) {
  mesh.userData.poolDecor = true;
  mesh.userData.decorKind = kind;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = -2;
  refreshDecorFootprint(mesh);
  return mesh;
}

function decorGlbNormalizeTarget(kind) {
  const cfg = CONFIG.pool?.decor ?? {};
  const base = cfg.glbTargetSize ?? 0.095;
  const mul = cfg.glbTargetSizeByKind?.[kind] ?? 1;
  return base * mul;
}

function normalizeDecorRoot(obj, target, kind) {
  const wrap = new THREE.Group();
  wrap.add(obj);
  // 必须先躺平再量尺寸；否则竖立瓶盖按高度归一化，躺平后直径会巨化
  if (kind === 'disk' || kind === 'ribbon') {
    bindKindRestOrientation(kind, wrap);
  }
  const inner = wrap.children[0];
  const box = new THREE.Box3().setFromObject(inner);
  const size = box.getSize(new THREE.Vector3());
  let m = Math.max(size.x, size.y, size.z, 1e-6);
  if (kind === 'disk' || kind === 'ribbon') {
    m = Math.max(size.x, size.z, 1e-6);
  }
  inner.scale.setScalar(target / m);
  regroundDecorInner(inner);
  return wrap;
}

/** 躺平后重新贴地、居中 XZ（在 wrap 内层节点上操作） */
function regroundDecorInner(inner) {
  const box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.x -= c.x;
  inner.position.z -= c.z;
  inner.position.y -= box.min.y;
}

/**
 * 瓶盖 / 布条 Tripo 常竖着导出；把最薄轴对齐世界 Y，再贴地（零旋转 = 趴在池底）。
 */
function bindKindRestOrientation(kind, wrap) {
  if (kind !== 'disk' && kind !== 'ribbon') return;
  const inner = wrap.children[0];
  if (!inner) return;

  const box = new THREE.Box3().setFromObject(inner);
  const s = box.getSize(new THREE.Vector3());
  const thinY = s.y <= s.x && s.y <= s.z;
  if (!thinY) {
    if (s.z <= s.x && s.z <= s.y) {
      inner.rotation.x = -Math.PI / 2;
    } else if (s.x <= s.y && s.x <= s.z) {
      inner.rotation.z = Math.PI / 2;
    } else {
      inner.rotation.x = Math.PI / 2;
    }
  }
  regroundDecorInner(inner);
}

function disposeDecorMesh(mesh) {
  if (!mesh) return;
  mesh.traverse((o) => {
    if (o.isMesh) {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
      else m?.dispose?.();
    }
  });
}

function allDecorGlbIds() {
  const fromManifest = Object.keys(GLB_MANIFEST_DECOR ?? {});
  const want = DECOR_KINDS.flatMap((k) => KIND_GLB[k]);
  return [...new Set([...want, ...fromManifest])];
}

let _decorCatalog = null;

async function loadDecorCatalog() {
  if (_decorCatalog) return _decorCatalog;
  const catalog = new Map();
  const manifest = GLB_MANIFEST_DECOR ?? {};
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const loadOne = async (id) => {
    const url = manifest[id]?.replace?.(/^\.\//, '');
    const kind = decorKindFromId(id);
    if (!url) {
      catalog.set(id, makeDecorProtoGroup(id, kind));
      return;
    }
    try {
      const gltf = await loader.loadAsync(url);
      const root = normalizeDecorRoot(gltf.scene, decorGlbNormalizeTarget(kind), kind);
      capTextures(root, CONFIG.pool?.decor?.textureMaxSize ?? 512);
      enableShadows(root);
      root.traverse((o) => { if (o.isMesh) o.userData.poolDecor = true; });
      root.userData.decorGlbId = id;
      root.userData.decorKind = kind;
      refreshDecorFootprint(root);
      catalog.set(id, root);
    } catch (e) {
      console.warn(`[decor] ${id} 未加载，用灰盒占位`, e.message);
      catalog.set(id, makeDecorProtoGroup(id, kind));
    }
  };

  await Promise.all(allDecorGlbIds().map(loadOne));
  _decorCatalog = catalog;
  return catalog;
}

function makeDecorProtoGroup(id, kind) {
  const proto = makeDecorProto(id, 1);
  const g = new THREE.Group();
  g.add(proto);
  g.userData.decorGlbId = id;
  g.userData.decorKind = kind ?? proto.userData.decorKind;
  g.userData.decorRadius = proto.userData.decorRadius;
  return g;
}

function pickGlbIdForKind(kind) {
  const pool = glbPoolForKind(kind);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function cloneDecorTemplate(template, scaleMul, tintHex, junk) {
  const root = template.clone(true);
  root.scale.setScalar(scaleMul);
  root.traverse((o) => {
    if (o.isMesh) {
      o.userData.poolDecor = true;
      o.castShadow = true;
      o.receiveShadow = true;
      o.renderOrder = -2;
    }
  });
  applyDecorTint(root, tintHex, junk);
  refreshDecorFootprint(root);
  return root;
}

function meshWorldVolume(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  const s = box.getSize(new THREE.Vector3());
  return s.x * s.y * s.z;
}

/** 主网格顶点最低点落地；忽略体积极小的 Tripo 碎屑（避免 AABB 抬高或碎屑拉低整件） */
function computeDecorSupportY(obj, group) {
  group.updateMatrixWorld(true);
  const meshes = [];
  obj.traverse((o) => {
    if (o.isMesh && o.geometry?.attributes?.position) meshes.push(o);
  });
  if (!meshes.length) return new THREE.Box3().setFromObject(obj).min.y;

  meshes.sort((a, b) => meshWorldVolume(b) - meshWorldVolume(a));
  const vol0 = meshWorldVolume(meshes[0]);
  const minVol = Math.max(vol0 * 0.045, 1e-8);
  const significant = meshes.filter((m) => meshWorldVolume(m) >= minVol);
  const v = new THREE.Vector3();
  let minY = Infinity;
  for (const mesh of significant) {
    const pos = mesh.geometry.attributes.position;
    const m = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (v.y < minY) minY = v.y;
    }
  }
  if (!Number.isFinite(minY)) {
    return new THREE.Box3().setFromObject(obj).min.y;
  }
  return minY;
}

/** 世界 AABB 底对齐 footY（不用顶点扫描，避免 Tripo 碎屑/主体抬高悬空） */
export function alignDecorFoot(group, obj, footY) {
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.y += footY - box.min.y;
  group.updateMatrixWorld(true);
  refreshDecorFootprint(obj);
}

/** 奖品 GLB 变高后重落垛（main 在 upgradeVisuals 完成后调用） */
export function restackPoolDecorWithPrizes(group, prizeItems) {
  restackPoolDecor(group, prizeItems, alignDecorFoot);
}

/** 换装后用世界 AABB 在 XZ 推开（比圆近似更贴长条/瓶盖外形） */
function relaxDecorBboxXZ(group) {
  const cfg = CONFIG.pool?.decor;
  const passes = cfg?.bboxRelaxPasses ?? 10;
  const { bx0, bx1, bz0, bz1 } = getDecorPoolBounds();
  const nodes = group.children.filter((c) => c.userData?.poolDecor);
  if (nodes.length < 2) return;

  for (let p = 0; p < passes; p++) {
    group.updateMatrixWorld(true);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const boxA = new THREE.Box3().setFromObject(a);
        const boxB = new THREE.Box3().setFromObject(b);
        const overlapX = Math.min(boxA.max.x, boxB.max.x) - Math.max(boxA.min.x, boxB.min.x);
        const overlapZ = Math.min(boxA.max.z, boxB.max.z) - Math.max(boxA.min.z, boxB.min.z);
        if (overlapX <= 0.001 || overlapZ <= 0.001) continue;
        const acx = (boxA.min.x + boxA.max.x) * 0.5;
        const acz = (boxA.min.z + boxA.max.z) * 0.5;
        const bcx = (boxB.min.x + boxB.max.x) * 0.5;
        const bcz = (boxB.min.z + boxB.max.z) * 0.5;
        const dx = bcx - acx;
        const dz = bcz - acz;
        const d = Math.hypot(dx, dz) || 1;
        const push = Math.min(overlapX, overlapZ) * 0.52 + (cfg.placementGap ?? 0.024) * 0.25;
        a.position.x -= (dx / d) * push * 0.5;
        a.position.z -= (dz / d) * push * 0.5;
        b.position.x += (dx / d) * push * 0.5;
        b.position.z += (dz / d) * push * 0.5;
      }
    }
    for (const n of nodes) {
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(n);
      const r = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
      const margin = 0.05;
      n.position.x = THREE.MathUtils.clamp(n.position.x, bx0 + margin + r, bx1 - margin - r);
      n.position.z = THREE.MathUtils.clamp(n.position.z, bz0 + margin + r, bz1 - margin - r);
    }
  }
  invalidateDecorRadii(group);
}

function transferDecorRotation(kind, old, neu) {
  const yaw = old.rotation.y;
  if (kind === 'ball') {
    neu.rotation.set(0, yaw, 0);
    return;
  }
  if (kind === 'disk') {
    neu.rotation.set(
      (Math.random() - 0.5) * 0.42,
      yaw,
      (Math.random() - 0.5) * 0.32,
    );
    return;
  }
  if (kind === 'ribbon') {
    neu.rotation.set(
      (Math.random() - 0.5) * 0.38,
      yaw,
      (Math.random() - 0.5) * 0.28,
    );
    return;
  }
  neu.rotation.copy(old.rotation);
}

/**
 * 替换逻辑：每个灰盒带 decorKind → 同形 GLB（好/坏 50%）。
 * glbShare：每件独立概率是否替换（1=全换）；未换的保持毛绒灰盒。
 */
export async function upgradePoolDecor(group, prizeItems = []) {
  const cfg = CONFIG.pool?.decor;
  if (!cfg?.enabled || !cfg?.glbEnabled || !group) return;

  const catalog = await loadDecorCatalog();
  const meshes = group.children.filter((c) => c.userData?.poolDecor);
  if (!meshes.length) return;

  const share = cfg.glbShare ?? 1;
  let swapped = 0;
  let skipped = 0;

  for (const old of meshes) {
    if (share < 1 && Math.random() > share) {
      skipped += 1;
      continue;
    }
    const kind = old.userData.decorKind;
    if (!kind || !KIND_GLB[kind]) continue;

    const glbId = pickGlbIdForKind(kind);
    const template = catalog.get(glbId);
    if (!template) continue;

    const floorY = cfg.floorY ?? 0.018;
    const footY = cfg.stackOnPrizes === true
      ? new THREE.Box3().setFromObject(old).min.y
      : floorY;
    const oldR = old.userData.decorRadius ?? 0.05;
    const tplR = template.userData.decorRadius ?? 0.045;
    let scaleMul = (oldR / Math.max(tplR, 1e-4)) * THREE.MathUtils.randFloat(0.88, 1.08);
    const scaleCap = kind === 'disk'
      ? (cfg.decorDiskScaleCap ?? 1.08)
      : (cfg.decorScaleCap ?? 1.28);
    scaleMul = THREE.MathUtils.clamp(scaleMul, 0.7, scaleCap);

    const tint = old.userData.decorTint ?? pickRandomDecorColor();
    const junk = glbId.includes('junk');
    const neu = cloneDecorTemplate(template, scaleMul, tint, junk);
    neu.position.set(old.position.x, old.position.y, old.position.z);
    transferDecorRotation(kind, old, neu);
    neu.userData.decorKind = kind;
    neu.userData.poolDecor = true;
    neu.userData.decorTint = tint;

    group.add(neu);
    alignDecorFoot(group, neu, footY);

    group.remove(old);
    disposeDecorMesh(old);
    swapped += 1;
  }

  if (swapped) {
    settlePoolDecorGroup(group, {
      settleIterations: cfg.postUpgradeSettleIterations ?? 36,
      separateRest: cfg.postUpgradeSeparateRest ?? 0.014,
      decorStiffness: 0.62,
    });
    relaxDecorBboxXZ(group);
    snapPoolDecorToFloor(group, alignDecorFoot);
    console.log(
      `[decor] 按 kind 替换 ${swapped} 件，已松弛并落垛` +
      (skipped ? `（保留毛绒 ${skipped} 件）` : ''),
    );
  }
}
