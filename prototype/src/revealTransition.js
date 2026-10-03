// 终幕：记忆塌散 → 尘屑过渡 → 交棒 onReveal（Marble）
import * as THREE from 'three';
import { CONFIG } from './config.js';

/**
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.Camera,
 *   world: THREE.Object3D,
 *   onHandoff?: () => void,
 *   onComplete?: () => void,
 * }} opts
 * @returns {{ update: (dt: number) => void, dispose: () => void }}
 */
export function createRevealDustTransition(opts) {
  const { scene, camera, world, onHandoff, onComplete } = opts;
  const tc = CONFIG.reveal?.transition ?? {};
  const duration = tc.duration ?? 2.35;
  const handoffAt = tc.handoffAt ?? 0.38;
  const count = tc.count ?? 1200;

  const box = new THREE.Box3().setFromObject(world);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const spread = new THREE.Vector3(
    Math.max(size.x * 0.45, 0.35),
    Math.max(size.y * 0.35, 0.25),
    Math.max(size.z * 0.45, 0.35),
  );

  const positions = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = center.x + (Math.random() - 0.5) * spread.x;
    positions[i * 3 + 1] = center.y + Math.random() * spread.y * 0.6;
    positions[i * 3 + 2] = center.z + (Math.random() - 0.5) * spread.z;
    vel[i * 3] = (Math.random() - 0.5) * 0.65;
    vel[i * 3 + 1] = 0.35 + Math.random() * 1.1;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.65;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: tc.color ?? 0x9a9086,
    size: tc.pointSize ?? 0.032,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  const camPos = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  let elapsed = 0;
  let handoffDone = false;
  let finished = false;

  const dispose = () => {
    scene.remove(points);
    geo.dispose();
    mat.dispose();
  };

  const update = (dt) => {
    if (finished) return;
    elapsed += dt;
    const t = Math.min(elapsed / duration, 1);

    if (!handoffDone && t >= handoffAt) {
      handoffDone = true;
      onHandoff?.();
    }

    camera.getWorldPosition(camPos);
    const pos = geo.attributes.position.array;
    const rush = 1 + t * 2.8;
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      toCam.set(camPos.x - pos[ix], camPos.y - pos[ix + 1], camPos.z - pos[ix + 2]);
      toCam.multiplyScalar(0.15 * dt * (0.4 + t));
      pos[ix] += vel[ix] * dt * rush + toCam.x;
      pos[ix + 1] += vel[ix + 1] * dt * rush + toCam.y;
      pos[ix + 2] += vel[ix + 2] * dt * rush + toCam.z;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 0.82 * (1 - t ** 1.65);
    mat.size = (tc.pointSize ?? 0.032) * (1 + t * 0.35);

    if (t >= 1) {
      finished = true;
      dispose();
      onComplete?.();
    }
  };

  return { update, dispose };
}
