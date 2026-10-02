// 装饰落垛 + 装饰专用活动范围（与可抓娃娃撒点分开）
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { itemFootprintRadius } from './prizePool.js';

/** 装饰可走/可摆范围：比娃娃更贴池壁（boundsExpand），物理 clamp 也用此范围 */
export function getDecorPoolBounds() {
  const cfg = CONFIG.pool?.decor ?? {};
  const [px0, px1] = CONFIG.pool.boundsX;
  const [pz0, pz1] = CONFIG.pool.boundsZ;
  const expandX = cfg.boundsExpandX ?? 0.07;
  const expandZ = cfg.boundsExpandZ ?? 0.055;
  const pad = cfg.edgeMargin ?? 0.032;
  return {
    bx0: px0 - expandX + pad,
    bx1: px1 + expandX - pad,
    bz0: pz0 - expandZ + pad,
    bz1: pz1 + expandZ - pad,
  };
}

function xzOverlap(x1, z1, r1, x2, z2, r2, gap = 0) {
  return Math.hypot(x1 - x2, z1 - z2) < r1 + r2 + gap;
}

/** @returns {{ x: number, z: number, r: number, topY: number }[]} */
export function buildPrizeSupporters(items) {
  const cfg = CONFIG.pool?.decor;
  const mul = cfg?.prizePlacementClearanceMul ?? cfg?.prizeClearanceMul ?? 1.08;
  const out = [];
  for (const it of items ?? []) {
    if (!it?.mesh) continue;
    const mesh = it.mesh;
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    out.push({
      kind: 'prize',
      x: mesh.position.x,
      z: mesh.position.z,
      r: itemFootprintRadius(it) * mul,
      topY: box.max.y,
    });
  }
  return out;
}

/**
 * @param {{ prizesOnly?: boolean }} opts prizesOnly=true 时只叠在娃娃上（避免装饰链式叠上天）
 */
export function computeSupportFootY(x, z, r, floorY, supporters, stackGap, opts = {}) {
  const cfg = CONFIG.pool?.decor;
  if (cfg?.stackOnPrizes !== true) return floorY;
  const maxH = (cfg?.maxStackY ?? 0.26) + floorY;
  const supportMul = cfg?.supportRadiusMul ?? 0.72;
  const rSupport = r * supportMul;
  let foot = floorY;
  for (const s of supporters) {
    if (opts.prizesOnly && s.kind !== 'prize') continue;
    const sr = (s.r ?? 0.05) * (s.kind === 'prize' ? 1 : supportMul);
    if (!xzOverlap(x, z, rSupport, s.x, s.z, sr, 0)) continue;
    const top = (s.topY ?? floorY) + stackGap;
    if (top > foot) foot = top;
  }
  return Math.min(foot, maxH);
}

function decorTopY(node) {
  node.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(node).max.y;
}

/**
 * 按当前 XZ 位置重算每件装饰脚底（先矮后高，允许叠在娃娃/装饰上）。
 * @param {THREE.Group} group poolDecor
 * @param {import('./prizePool.js').spawnPool extends Function ? unknown[] : unknown[]} items
 * @param {(group: THREE.Group, obj: THREE.Object3D, footY: number) => void} alignFoot
 */
/** 全部装饰 AABB 底贴 floorY（最稳，开局贴地） */
export function snapPoolDecorToFloor(group, alignFoot) {
  const floorY = CONFIG.pool?.decor?.floorY ?? 0.018;
  if (!group || !alignFoot) return;
  for (const node of group.children.filter((c) => c.userData?.poolDecor)) {
    alignFoot(group, node, floorY);
  }
}

export function restackPoolDecor(group, items, alignFoot) {
  const cfg = CONFIG.pool?.decor;
  if (!group || !alignFoot) return;
  if (cfg?.stackOnPrizes !== true) {
    snapPoolDecorToFloor(group, alignFoot);
    return;
  }

  const floorY = cfg?.floorY ?? 0.018;
  const stackGap = cfg?.stackGap ?? 0.004;
  const nodes = group.children.filter((c) => c.userData?.poolDecor);
  if (!nodes.length) return;

  nodes.sort((a, b) => {
    const ba = new THREE.Box3().setFromObject(a);
    const bb = new THREE.Box3().setFromObject(b);
    return ba.min.y - bb.min.y;
  });

  const prizeSupporters = buildPrizeSupporters(items);
  for (const node of nodes) {
    node.updateMatrixWorld(true);
    const boxR = new THREE.Box3().setFromObject(node);
    const r = node.userData.decorRadius
      ?? Math.max(boxR.max.x - boxR.min.x, boxR.max.z - boxR.min.z) * 0.5;
    const { x, z } = node.position;
    const footY = computeSupportFootY(x, z, r, floorY, prizeSupporters, stackGap, { prizesOnly: true });
    alignFoot(group, node, footY);
  }
}
