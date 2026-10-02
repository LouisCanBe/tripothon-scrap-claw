#!/usr/bin/env node
import * as THREE from '../prototype/vendor/three.module.js';
import { GLTFLoader } from '../prototype/vendor/three180/addons/loaders/GLTFLoader.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prototype/assets/machine');
const loader = new GLTFLoader();

const MACHINE_SHELL_SLOTS = {
  machine_base: { size: [3.3, 0.3, 2.3], position: [0, -0.15, 0] },
  machine_frame: { size: [3.16, 2.1, 2.16], position: [0, 1.05, 0] },
  machine_top: { size: [3.3, 0.32, 2.3], position: [0, 2.2, 0] },
  machine_back: { size: [3.3, 2.4, 0.08], position: [0, 1.05, -1.12] },
  machine_panel: { size: [0.5, 0.18, 0.08], position: [0.9, 0.05, 1.14] },
};

function fitMeshToSlot(object3d, slot) {
  object3d.scale.set(1, 1, 1);
  object3d.position.set(0, 0, 0);
  object3d.rotation.set(0, 0, 0);
  object3d.updateMatrixWorld(true);
  const [tx, ty, tz] = slot.size;
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  object3d.scale.set(
    tx / Math.max(size.x, 1e-6),
    ty / Math.max(size.y, 1e-6),
    tz / Math.max(size.z, 1e-6),
  );
  object3d.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(object3d);
  const center = box2.getCenter(new THREE.Vector3());
  object3d.position.set(
    slot.position[0] - center.x,
    slot.position[1] - center.y,
    slot.position[2] - center.z,
  );
}

async function check(dir) {
  const out = {};
  for (const [id, slot] of Object.entries(MACHINE_SHELL_SLOTS)) {
    const url = path.join(dir, `${id}.glb`);
    try {
      const gltf = await loader.loadAsync(url);
      const root = gltf.scene;
      fitMeshToSlot(root, slot);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const err = [
        Math.abs(size.x - slot.size[0]),
        Math.abs(size.y - slot.size[1]),
        Math.abs(size.z - slot.size[2]),
      ].map((v) => +v.toFixed(4));
      const posErr = [
        Math.abs(center.x - slot.position[0]),
        Math.abs(center.y - slot.position[1]),
        Math.abs(center.z - slot.position[2]),
      ].map((v) => +v.toFixed(4));
      out[id] = {
        size, center: [center.x, center.y, center.z].map((v) => +v.toFixed(4)),
        sizeErr: err, posErr,
      };
    } catch (e) {
      out[id] = { error: e.message };
    }
  }
  return out;
}

const current = await check(ROOT);
const restoredDir = path.join(ROOT, 'archive/pre-cursor-mv-all-20261001-1712');
const restored = await check(restoredDir);
const baseOnly = await check(path.join(ROOT, 'archive/pre-img-pipeline-20261001-1554'));

console.log('CURRENT (可能被 Blender 二次套槽污染):');
for (const [id, v] of Object.entries(current)) {
  if (v.error) console.log(id, v.error);
  else console.log(id, 'sizeErr', v.sizeErr, 'posErr', v.posErr, 'center', v.center);
}
console.log('\nARCHIVE Tripo 原始 (pre-cursor + pre-img base):');
for (const id of Object.keys(MACHINE_SHELL_SLOTS)) {
  const v = id === 'machine_base' ? baseOnly.machine_base : restored[id];
  if (!v || v.error) console.log(id, v?.error || 'missing');
  else console.log(id, 'sizeErr', v.sizeErr, 'posErr', v.posErr, 'center', v.center);
}
