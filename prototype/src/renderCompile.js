// 串行 compileAsync + 材质兜底：并行编译同一 WebGLRenderer 会触发 program.isReady 未定义崩溃。
import * as THREE from 'three';

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMPILE_TIMEOUT_MS = 12000;

let _compileQueue = Promise.resolve();

/** @param {THREE.Object3D} root */
export function sanitizeMeshMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) {
      o.material = o.material.map(
        (m) => m ?? new THREE.MeshStandardMaterial({ color: 0x808080 }),
      );
    } else if (o.material == null) {
      o.material = new THREE.MeshStandardMaterial({ color: 0x808080 });
    }
  });
}

async function runCompile(renderer, camera, sceneRoot) {
  if (!renderer || !camera || !sceneRoot) return;
  sanitizeMeshMaterials(sceneRoot);
  try {
    await Promise.race([
      renderer.compileAsync(sceneRoot, camera),
      _sleep(COMPILE_TIMEOUT_MS).then(() => {
        console.warn('[renderCompile] compileAsync 超时，继续显示');
      }),
    ]);
  } catch (e) {
    console.warn('[renderCompile] compileAsync 失败，尝试同步 compile', e);
    try {
      renderer.compile(sceneRoot, camera);
    } catch {
      /* noop */
    }
  }
}

/**
 * 同一 renderer 上 compileAsync 必须排队，避免与外壳/爪子并行。
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Camera} camera
 * @param {THREE.Object3D} sceneRoot 仅包含待编译子树
 */
export function enqueueRendererCompile(renderer, camera, sceneRoot) {
  const job = _compileQueue.then(() => runCompile(renderer, camera, sceneRoot));
  _compileQueue = job.catch(() => {});
  return job;
}
