// ============================================================
// 终幕 Marble 沉浸式：collider GLB（边界）+ SPZ（写实层）
// 与 tools/world.html 一致：整场景绕 X 翻 180°（父节点 rotation.x = π），
// SPZ 不再单独传 [1,0,0,0]，避免与 GLB 边界坐标系不一致。
// ============================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DropInViewer } from '../vendor/addons/gaussian-splats-3d.js';

const loader = new GLTFLoader();

export function computeWorldBounds(object3d) {
  object3d.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object3d);
}

export function collectColliderMeshes(root) {
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry) meshes.push(o);
  });
  return meshes;
}

/**
 * @param {THREE.Object3D} parent 已带 Marble 翻转的父节点
 */
export async function loadMarbleCollider(url, parent) {
  const gltf = await loader.loadAsync(url);
  const group = gltf.scene;
  parent.add(group);
  parent.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  group.position.y -= box.min.y;
  group.visible = false;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) {
      if (mat) mat.side = THREE.DoubleSide;
    }
  });
  return { group };
}

/**
 * @returns {Promise<{ frame: THREE.Group, bounds: THREE.Box3, dispose: () => void }>}
 */
export async function mountMarbleImmersive(root, { colliderUrl, spzUrl, showBoundsHelper = false }) {
  const frame = new THREE.Group();
  frame.name = 'marbleImmersive';
  frame.rotation.x = Math.PI;
  root.add(frame);

  const { group } = await loadMarbleCollider(colliderUrl, frame);

  const dropIn = new DropInViewer({ sharedMemoryForWorkers: false });
  frame.add(dropIn);
  await dropIn.addSplatScene(spzUrl, {
    progressiveLoad: false,
    showLoadingUI: false,
    rotation: [0, 0, 0, 0],
  });

  const bounds = computeWorldBounds(frame);
  const colliderMeshes = collectColliderMeshes(group);

  if (showBoundsHelper) {
    try { frame.add(new THREE.Box3Helper(bounds, 0x3a4a5a)); } catch { /* ignore */ }
  }

  return {
    frame,
    bounds,
    colliderMeshes,
    dropIn,
    dispose() {
      try { dropIn.viewer?.dispose(); } catch { /* ignore */ }
      root.remove(frame);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    },
  };
}
