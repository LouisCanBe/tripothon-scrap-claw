// 奖池「堆娃娃」装饰：仅视觉，不进 items / 不参与 nearestItem 判定
import * as THREE from 'three';
import { CONFIG } from './config.js';

// 拾荒机台：褪色旧毛绒，低饱和灰褐/尘绿/旧粉
const PLUSH_COLORS = [
  0x8a8478, 0x7a756c, 0x6e7568, 0x8f857a, 0x736a62, 0x7d8488,
  0x8c7d74, 0x6b6560, 0x85707a, 0x788272, 0x948a80, 0x6a635c,
];

function pickColor(i) {
  return PLUSH_COLORS[i % PLUSH_COLORS.length];
}

function sizeMul(cfg) {
  return cfg.sizeMul ?? 1.45;
}

/** 偏向奖池四周边缘撒布（中心留给可抓奖品） */
function sampleDecorXZ(bx0, bx1, bz0, bz1, cfg) {
  const cx = (bx0 + bx1) * 0.5;
  const cz = (bz0 + bz1) * 0.5;
  const hw = (bx1 - bx0) * 0.5 - 0.06;
  const hh = (bz1 - bz0) * 0.5 - 0.06;
  const inner = cfg.edgeInner ?? 0.68;
  const a = Math.random() * Math.PI * 2;
  const t = inner + (1 - inner) * Math.random();
  return {
    x: cx + Math.cos(a) * hw * t,
    z: cz + Math.sin(a) * hh * t,
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = -2;
  const box = new THREE.Box3().setFromObject(mesh);
  mesh.userData.decorRadius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5;
  return mesh;
}

function randomDecorScale(cfg) {
  const lo = cfg.scaleMin ?? 0.68;
  const hi = cfg.scaleMax ?? 1.62;
  return THREE.MathUtils.randFloat(lo, hi);
}

/**
 * @param {THREE.Object3D} parent 通常 world
 * @returns {THREE.Group | null}
 */
export function spawnPoolDecor(parent) {
  const cfg = CONFIG.pool?.decor;
  if (!cfg?.enabled || !parent) return null;

  const group = new THREE.Group();
  group.name = 'poolDecor';

  const [bx0, bx1] = CONFIG.pool.boundsX;
  const [bz0, bz1] = CONFIG.pool.boundsZ;
  const [hx, hz] = CONFIG.claw.holePos;
  const holeR = cfg.avoidHoleRadius ?? 0.5;
  const minD = cfg.minSpacing ?? 0.09;
  const count = cfg.count ?? 44;
  const maxY = cfg.maxStackY ?? 0.26;
  const kinds = ['ball', 'ball', 'roll', 'roll', 'disk', 'ribbon'];
  const placed = [];

  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    let ok = false;
    let tries = 0;
    while (!ok && tries++ < 240) {
      const p = sampleDecorXZ(bx0, bx1, bz0, bz1, cfg);
      x = p.x;
      z = p.z;
      ok = x >= bx0 + 0.06 && x <= bx1 - 0.06 && z >= bz0 + 0.06 && z <= bz1 - 0.06
        && Math.hypot(x - hx, z - hz) > holeR
        && placed.every((q) => Math.hypot(x - q[0], z - q[1]) > minD);
    }
    if (!ok) continue;
    placed.push([x, z]);

    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const scale = randomDecorScale(cfg);
    const mesh = makePlushMesh(kind, pickColor(i), scale, cfg);
    const layer = Math.floor(Math.random() * 3);
    const y = 0.018 + layer * (maxY / 3) + Math.random() * 0.04;
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
  }

  // 池壁一圈「垫高」小团，强化堆满感
  const rimN = cfg.rimCount ?? 18;
  const cx = (bx0 + bx1) * 0.5;
  const cz = (bz0 + bz1) * 0.5;
  const hw = (bx1 - bx0) * 0.5 - 0.04;
  const hh = (bz1 - bz0) * 0.5 - 0.04;
  for (let i = 0; i < rimN; i++) {
    const t = (i / rimN) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
    const u = 0.9 + Math.random() * 0.1;
    const x = cx + Math.cos(t) * hw * u;
    const z = cz + Math.sin(t) * hh * u;
    if (Math.hypot(x - hx, z - hz) < holeR) continue;
    const mesh = makePlushMesh('ball', pickColor(count + i), randomDecorScale(cfg) * 1.05, cfg);
    mesh.position.set(x, 0.03 + Math.random() * 0.06, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    group.add(mesh);
  }

  parent.add(group);
  return group;
}
