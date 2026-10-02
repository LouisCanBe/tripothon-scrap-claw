// 装饰娃娃：XZ 轻量碰撞（装饰互挤 + 被奖品/爪区推开），不参与抓取
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { itemFootprintRadius } from './prizePool.js';
import { getDecorPoolBounds } from './poolDecorStack.js';

function meshFootprintRadius(mesh, force = false) {
  const cfg = CONFIG.pool?.decor;
  const pad = cfg?.footprintPad ?? 1.08;
  if (!force && mesh.userData.decorRadius) return mesh.userData.decorRadius;
  mesh.updateMatrixWorld?.(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const sx = box.max.x - box.min.x;
  const sz = box.max.z - box.min.z;
  const r = Math.max(sx, sz) * 0.5 * pad;
  mesh.userData.decorRadius = r;
  return r;
}

export function invalidateDecorRadii(group) {
  if (!group) return;
  for (const mesh of group.children) {
    if (mesh.userData?.poolDecor) delete mesh.userData.decorRadius;
  }
}

function buildDecorBodies(group) {
  const bodies = [];
  if (!group) return bodies;
  for (const mesh of group.children) {
    if (!mesh.userData?.poolDecor) continue;
    const r = meshFootprintRadius(mesh);
    bodies.push({
      mesh,
      x: mesh.position.x,
      z: mesh.position.z,
      baseY: mesh.position.y,
      vx: 0,
      vz: 0,
      r,
      mass: r * r,
      sleeping: true,
    });
  }
  return bodies;
}

function clampDecorXZ(b, bx0, bx1, bz0, bz1, margin) {
  b.x = THREE.MathUtils.clamp(b.x, bx0 + margin + b.r, bx1 - margin - b.r);
  b.z = THREE.MathUtils.clamp(b.z, bz0 + margin + b.r, bz1 - margin - b.r);
}

/** @param {boolean} addImpulse 静止时用纯位置修正，避免微颤 */
function separatePair(a, b, rest, stiff, addImpulse) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  const minD = a.r + b.r + rest;
  if (d >= minD || d < 1e-5) return;
  const nx = dx / (d || 1);
  const nz = dz / (d || 1);
  const push = (minD - d) * stiff;
  const invMass = 1 / a.mass + 1 / b.mass;
  const wa = (1 / a.mass) / invMass;
  const wb = (1 / b.mass) / invMass;
  a.x -= nx * push * wa;
  a.z -= nz * push * wa;
  b.x += nx * push * wb;
  b.z += nz * push * wb;
  if (!addImpulse) return;
  a.vx -= nx * push * 1.4 * wa;
  a.vz -= nz * push * 1.4 * wa;
  b.vx += nx * push * 1.4 * wb;
  b.vz += nz * push * 1.4 * wb;
}

function settleBodies(bodies, cfg, bounds) {
  const { bx0, bx1, bz0, bz1 } = bounds;
  const iters = cfg.settleIterations ?? 14;
  const stiff = cfg.decorStiffness ?? 0.55;
  const rest = cfg.separateRest ?? 0.004;
  for (let k = 0; k < iters; k++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        separatePair(bodies[i], bodies[j], rest, stiff, false);
      }
    }
    for (const b of bodies) clampDecorXZ(b, bx0, bx1, bz0, bz1, 0.05);
  }
  for (const b of bodies) {
    b.mesh.position.x = b.x;
    b.mesh.position.z = b.z;
    b.baseY = b.mesh.position.y;
    b.vx = 0;
    b.vz = 0;
    b.sleeping = true;
  }
}

function itemMoved(it, threshold) {
  const x = it.mesh.position.x;
  const z = it.mesh.position.z;
  const lx = it._decorTrackX ?? x;
  const lz = it._decorTrackZ ?? z;
  it._decorTrackX = x;
  it._decorTrackZ = z;
  return Math.hypot(x - lx, z - lz) > threshold;
}

/**
 * 按当前网格/GLB 实际 XZ 占地做松弛（换装后应调用）。
 * @param {THREE.Group | null} group
 * @param {{ settleIterations?: number, separateRest?: number, footprintPad?: number }} overrides
 */
export function settlePoolDecorGroup(group, overrides = {}) {
  const cfg = CONFIG.pool?.decor;
  if (!group || !cfg?.enabled) return;

  invalidateDecorRadii(group);
  const { bx0, bx1, bz0, bz1 } = getDecorPoolBounds();
  const phys = typeof cfg.physics === 'object' ? cfg.physics : {};
  const settleCfg = {
    ...cfg,
    ...phys,
    settleIterations: overrides.settleIterations ?? cfg.settleIterations ?? 16,
    separateRest: overrides.separateRest ?? cfg.separateRest ?? 0.004,
    decorStiffness: overrides.decorStiffness ?? cfg.decorStiffness ?? 0.55,
  };
  const bodies = buildDecorBodies(group);
  settleBodies(bodies, settleCfg, { bx0, bx1, bz0, bz1 });
  for (const b of bodies) b.baseY = b.mesh.position.y;
}

/**
 * @param {THREE.Group | null} group poolDecor
 * @returns {{ tick: (items: unknown[], dt: number, clawCtx?: { x: number, z: number, pushDecor?: boolean }) => void } | null}
 */
export function attachPoolDecorPhysics(group) {
  const cfg = CONFIG.pool?.decor;
  if (!group || !cfg?.enabled || cfg.physics === false) return null;

  const phys = typeof cfg.physics === 'object' ? cfg.physics : {};
  const { bx0, bx1, bz0, bz1 } = getDecorPoolBounds();
  const [hx, hz] = CONFIG.claw.holePos;
  const holeR = cfg.avoidHoleRadius ?? 0.5;

  let bodies = buildDecorBodies(group);
  const settleCfg = { ...cfg, ...phys };
  const bounds = { bx0, bx1, bz0, bz1 };
  settleBodies(bodies, settleCfg, bounds);

  const prizePush = phys.prizePush ?? 0.72;
  const clawPush = phys.clawPush ?? 0.38;
  const clawR = phys.clawInfluenceRadius ?? 0.24;
  const decorItersActive = phys.iterations ?? 3;
  const decorItersIdle = phys.iterationsIdle ?? 1;
  const damp = phys.damping ?? 6.5;
  const stiffActive = phys.decorStiffness ?? 0.38;
  const stiffIdle = phys.decorStiffnessIdle ?? 0.22;
  const maxSpeed = phys.maxSpeed ?? 1.4;
  const sleepVel = phys.sleepVelocity ?? 0.018;
  const prizeMoveThresh = phys.prizeMoveThreshold ?? 0.004;

  return {
    /** Tripo 换装后 Group 替换 Mesh，需重建碰撞体与 baseY */
    rebuild(decorGroup) {
      const g = decorGroup ?? group;
      invalidateDecorRadii(g);
      bodies = buildDecorBodies(g);
      const post = {
        ...settleCfg,
        settleIterations: cfg.postUpgradeSettleIterations ?? settleCfg.settleIterations,
        separateRest: cfg.postUpgradeSeparateRest ?? settleCfg.separateRest ?? 0.004,
      };
      settleBodies(bodies, post, bounds);
    },
    tick(items, dt, clawCtx = null) {
      if (!bodies.length || dt <= 0) return;

      let sceneActive = clawCtx?.pushDecor === true;

      for (const it of items) {
        if (!it?.mesh || it.state === 'collected' || !it.mesh.visible) continue;
        if (it.state === 'falling') sceneActive = true;
        const px = it.mesh.position.x;
        const pz = it.mesh.position.z;
        const moved = itemMoved(it, prizeMoveThresh);
        if (moved && it.state === 'idle') sceneActive = true;

        if (it.state === 'gripped' || it.state === 'delivering') continue;
        if (!moved && it.state === 'idle') continue;

        const pr = itemFootprintRadius(it) * (phys.prizeRadiusMul ?? 0.9);
        for (const b of bodies) {
          const dx = b.x - px;
          const dz = b.z - pz;
          const d = Math.hypot(dx, dz);
          const minD = b.r + pr;
          if (d >= minD || d < 1e-4) continue;
          const nx = dx / d;
          const nz = dz / d;
          const pen = (minD - d) * prizePush;
          b.x += nx * pen;
          b.z += nz * pen;
          b.vx += nx * pen * (sceneActive ? 5 : 0);
          b.vz += nz * pen * (sceneActive ? 5 : 0);
          b.sleeping = false;
        }
      }

      if (clawCtx && clawCtx.pushDecor === true) {
        for (const b of bodies) {
          const dx = b.x - clawCtx.x;
          const dz = b.z - clawCtx.z;
          const d = Math.hypot(dx, dz);
          const minD = b.r + clawR;
          if (d >= minD || d < 1e-4) continue;
          const nx = dx / d;
          const nz = dz / d;
          const pen = (minD - d) * clawPush;
          b.x += nx * pen;
          b.z += nz * pen;
          b.vx += nx * pen * 3.2;
          b.vz += nz * pen * 3.2;
          b.sleeping = false;
          sceneActive = true;
        }
      }

      const decorIters = sceneActive ? decorItersActive : decorItersIdle;
      const stiff = sceneActive ? stiffActive : stiffIdle;
      const addImpulse = sceneActive;

      for (let k = 0; k < decorIters; k++) {
        for (let i = 0; i < bodies.length; i++) {
          for (let j = i + 1; j < bodies.length; j++) {
            separatePair(bodies[i], bodies[j], 0.003, stiff, addImpulse);
          }
        }
      }

      const decay = Math.exp(-damp * dt);
      for (const b of bodies) {
        if (Math.hypot(b.x - hx, b.z - hz) < holeR + b.r * 0.5) {
          const dx = b.x - hx;
          const dz = b.z - hz;
          const d = Math.hypot(dx, dz) || 1;
          const push = (holeR + b.r * 0.5 - d) * 1.1;
          b.x += (dx / d) * push;
          b.z += (dz / d) * push;
        }
        clampDecorXZ(b, bx0, bx1, bz0, bz1, 0.05);

        if (!sceneActive) {
          b.vx = 0;
          b.vz = 0;
          b.sleeping = true;
          b.mesh.position.x = b.x;
          b.mesh.position.z = b.z;
          b.mesh.position.y = b.baseY;
          continue;
        }

        b.vx *= decay;
        b.vz *= decay;
        let sp = Math.hypot(b.vx, b.vz);
        if (sp > maxSpeed) {
          b.vx *= maxSpeed / sp;
          b.vz *= maxSpeed / sp;
          sp = maxSpeed;
        }
        if (sp < sleepVel) {
          b.vx = 0;
          b.vz = 0;
          b.sleeping = true;
        } else {
          b.sleeping = false;
          b.x += b.vx * dt;
          b.z += b.vz * dt;
          if (sp > 0.06) b.mesh.rotation.y += (b.vx * 0.35 - b.vz * 0.18) * dt;
        }
        clampDecorXZ(b, bx0, bx1, bz0, bz1, 0.05);
        b.mesh.position.x = b.x;
        b.mesh.position.z = b.z;
        b.mesh.position.y = b.baseY;
      }
    },
  };
}
