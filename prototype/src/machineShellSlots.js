// 机柜分件槽位（游戏 machineShellTripo + Hub 预览共用，单位：米）
import * as THREE from 'three';

export const MACHINE_SHELL_SLOTS = {
  machine_base: { size: [3.3, 0.3, 2.3], position: [0, -0.15, 0] },
  machine_frame: { size: [3.16, 2.1, 2.16], position: [0, 1.05, 0] },
  machine_top: { size: [3.3, 0.32, 2.3], position: [0, 2.2, 0] },
  machine_back: { size: [3.3, 2.4, 0.08], position: [0, 1.05, -1.12] },
  machine_panel: { size: [0.5, 0.18, 0.08], position: [0.9, 0.05, 1.14] },
};

const QUARTER_TURNS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

/** 在缩放前把网格转到和槽位最接近的朝向，避免宽面被拉到深度上。 */
function bakeBestAxisRotation(object3d, slotSize) {
  const [tx, ty, tz] = slotSize;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  let best = null;
  for (const x of QUARTER_TURNS) {
    for (const y of QUARTER_TURNS) {
      for (const z of QUARTER_TURNS) {
        object3d.rotation.set(x, y, z);
        object3d.updateMatrixWorld(true);
        box.setFromObject(object3d);
        box.getSize(size);
        const sx = tx / Math.max(size.x, 1e-6);
        const sy = ty / Math.max(size.y, 1e-6);
        const sz = tz / Math.max(size.z, 1e-6);
        const stretch = Math.max(sx, sy, sz) / Math.min(sx, sy, sz);
        if (!best || stretch < best.stretch) best = { stretch, x, y, z };
      }
    }
  }
  object3d.rotation.set(best.x, best.y, best.z);
  object3d.updateMatrixWorld(true);
  const meshes = [];
  object3d.traverse((child) => {
    if (child.isMesh) meshes.push(child);
  });
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    mesh.geometry = geometry;
  }
  object3d.traverse((child) => {
    child.position.set(0, 0, 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(1, 1, 1);
  });
  object3d.updateMatrixWorld(true);
}

/** 先对齐轴向，再非等比缩放到 slot.size，包围盒中心对齐 slot.position */
export function fitMeshToSlot(object3d, slot) {
  object3d.scale.set(1, 1, 1);
  object3d.position.set(0, 0, 0);
  object3d.rotation.set(0, 0, 0);
  object3d.updateMatrixWorld(true);
  bakeBestAxisRotation(object3d, slot.size);

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

export function guessMachinePartId(fileName) {
  const n = String(fileName || '').toLowerCase();
  for (const id of Object.keys(MACHINE_SHELL_SLOTS)) {
    if (n.includes(id)) return id;
  }
  return null;
}
