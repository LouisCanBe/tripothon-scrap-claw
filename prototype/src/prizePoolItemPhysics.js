// 可抓奖品：极弱 XZ 互挤（仅 idle），弱于装饰层
import { CONFIG } from './config.js';
import { itemFootprintRadius, clampItemToPoolBounds } from './prizePool.js';

function separateIdleItems(entryA, entryB, rest, stiff, maxStep) {
  const meshA = entryA.it.mesh;
  const meshB = entryB.it.mesh;
  if (!meshA || !meshB) return;
  const ax = meshA.position.x;
  const az = meshA.position.z;
  const bx = meshB.position.x;
  const bz = meshB.position.z;
  const dx = bx - ax;
  const dz = bz - az;
  const d = Math.hypot(dx, dz);
  const minD = entryA.r + entryB.r + rest;
  if (d >= minD || d < 1e-5) return;
  const nx = dx / d;
  const nz = dz / d;
  let push = (minD - d) * stiff;
  push = Math.min(push, maxStep);
  meshA.position.x -= nx * push * 0.5;
  meshA.position.z -= nz * push * 0.5;
  meshB.position.x += nx * push * 0.5;
  meshB.position.z += nz * push * 0.5;
}

/**
 * @param {ReturnType<import('./prizePool.js').spawnPool>} items
 */
export function attachPrizeItemPhysics(items) {
  const cfg = CONFIG.pool?.prizePhysics;
  if (!cfg?.enabled || !items?.length) return null;

  const stiff = cfg.stiffness ?? 0.065;
  const rest = cfg.rest ?? 0.012;
  const maxStep = cfg.maxStepPerFrame ?? 0.0035;
  const iters = cfg.iterations ?? 1;

  return {
    tick(dt) {
      if (dt <= 0) return;
      const idle = [];
      for (const it of items) {
        if (it.state !== 'idle' || !it.mesh?.visible) continue;
        idle.push({ it, r: itemFootprintRadius(it) * (cfg.radiusMul ?? 0.88) });
      }
      if (idle.length < 2) return;
      for (let k = 0; k < iters; k++) {
        for (let i = 0; i < idle.length; i++) {
          for (let j = i + 1; j < idle.length; j++) {
            separateIdleItems(idle[i], idle[j], rest, stiff, maxStep);
          }
        }
      }
      for (const { it } of idle) clampItemToPoolBounds(it);
    },
  };
}
